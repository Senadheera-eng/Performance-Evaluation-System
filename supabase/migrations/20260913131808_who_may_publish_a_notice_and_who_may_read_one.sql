/*
  The two rules the notice board turns on, each written once.

  can_publish_notice_scope answers "may I file a notice aimed here?". It is
  the only place the publishing hierarchy is spelled out, and both the INSERT
  and the UPDATE policy call it — so a notice cannot be created inside your
  scope and then edited to point outside it, which is the obvious way to get
  around a check that only runs on insert.

  notice_visible_to_me answers "may I read this one?". The frontend never
  decides this: the policy calls it, the storage policy calls it through the
  attachment, and the listing function calls it. A student who guesses a
  notice id gets nothing, and so does a lecturer in the wrong department.
*/

create or replace function public.can_publish_notice_scope(
  p_department text,
  p_batch_year integer,
  p_offering_id uuid,
  p_category text
)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_role      text := coalesce(public.get_my_role(), '');
  v_hod       text := public.my_hod_department();
  v_lecturer  uuid := public.my_lecturer_id();
  v_required  text;
  v_off_dept  text;
begin
  -- A student is a reader here and nothing else.
  if v_role = 'student' then
    return false;
  end if;

  /* Some categories are only meaningful from certain desks. A lecturer may
     post a lab schedule for their own class but not a faculty examination
     timetable, whatever scope they claim for it. */
  select min_publisher into v_required
    from public.notice_categories where slug = p_category and is_active;
  if not found then
    return false;
  end if;

  if p_offering_id is not null then
    v_off_dept := public.offering_department(p_offering_id);
  end if;

  -- Super admin: the whole faculty, every category.
  if v_role = 'super_admin' then
    return true;
  end if;

  -- Department admin: their own department, and nothing faculty-wide.
  if v_role = 'dept_admin' then
    if v_required = 'super_admin' then
      return false;
    end if;
    if p_offering_id is not null then
      return v_off_dept = public.get_my_department();
    end if;
    return p_department is not null
       and p_department = public.get_my_department();
  end if;

  -- Head of department: the department they hold the appointment for.
  if v_hod is not null then
    if v_required in ('super_admin', 'dept_admin') then
      return false;
    end if;
    if p_offering_id is not null then
      return v_off_dept = v_hod;
    end if;
    return p_department is not null and p_department = v_hod;
  end if;

  /* Lecturer: only a course they actually teach, and the notice must name
     that offering. Without it there is nothing tying the notice to their
     authority, so a department-wide or faculty-wide notice is refused even
     if they set the department to their own. */
  if v_lecturer is not null then
    if v_required in ('super_admin', 'dept_admin', 'hod') then
      return false;
    end if;
    return p_offering_id is not null
       and public.is_assigned_lecturer(p_offering_id);
  end if;

  return false;
end;
$$;

comment on function public.can_publish_notice_scope(text, integer, uuid, text) is
  'The publishing hierarchy, in one place. Called by both the INSERT and the '
  'UPDATE policy on notices so a notice cannot be edited out of the scope it '
  'was allowed to be created in.';

grant execute on function public.can_publish_notice_scope(text, integer, uuid, text)
  to authenticated;


/**
 * May the caller read this notice?
 *
 * Deliberately generous about time and strict about scope. A student sees
 * anything ever aimed at their department and batch, expired or not, because
 * last year's examination timetable is exactly the sort of thing people come
 * back for. What they do not see is another department's post, another
 * batch's post, a course they never took, or anybody's draft.
 */
create or replace function public.notice_visible_to_me(p_notice_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  n           record;
  v_role      text := coalesce(public.get_my_role(), '');
  v_student   record;
  v_hod       text := public.my_hod_department();
  v_lecturer  uuid := public.my_lecturer_id();
begin
  select * into n from public.notices where id = p_notice_id;
  if not found then
    return false;
  end if;

  -- Your own drafts are yours to see; nobody else's are.
  if n.created_by = auth.uid() then
    return true;
  end if;

  if v_role = 'super_admin' then
    return true;
  end if;

  if v_role = 'dept_admin' then
    return n.department is null
        or n.department = public.get_my_department()
        or (n.offering_id is not null
            and public.offering_department(n.offering_id) = public.get_my_department());
  end if;

  -- Unpublished work belongs to its author and the people above them.
  if n.status <> 'published' or n.published_at > now() then
    return false;
  end if;

  if v_hod is not null then
    if n.department is null or n.department = v_hod then
      return true;
    end if;
    if n.offering_id is not null
       and public.offering_department(n.offering_id) = v_hod then
      return true;
    end if;
  end if;

  if v_lecturer is not null then
    -- A lecturer reads their own department's board and their own courses.
    if n.department is null
       or n.department = (select l.department from public.lecturers l
                           where l.id = v_lecturer) then
      return true;
    end if;
    return n.offering_id is not null
       and public.is_assigned_lecturer(n.offering_id);
  end if;

  select s.department, s.batch_year into v_student
    from public.students s where s.id = auth.uid() and s.role = 'student';
  if not found then
    return false;
  end if;

  /* A course-scoped notice goes to the people who sat that offering,
     whatever department they belong to — a shared Interdisciplinary module
     has students from all five. */
  if n.offering_id is not null then
    return exists (
      select 1 from public.course_offerings o
       where o.id = n.offering_id
         and exists (select 1 from public.enrollments e
                      where e.student_id = auth.uid()
                        and e.course_id = o.course_id
                        and e.academic_year = o.academic_year));
  end if;

  /* A first-year has no department yet, so only faculty-wide notices can
     apply to them — the same rule the enrolment windows follow. */
  if n.department is not null
     and n.department is distinct from v_student.department then
    return false;
  end if;

  if n.batch_year is not null
     and n.batch_year is distinct from v_student.batch_year then
    return false;
  end if;

  return true;
end;
$$;

comment on function public.notice_visible_to_me(uuid) is
  'May the caller read this notice. Generous about time (history stays '
  'readable), strict about scope. The only authority on the question: the '
  'row policy, the storage policy and the listing function all call it.';

grant execute on function public.notice_visible_to_me(uuid) to authenticated;


/** May the caller change this notice? Its author, or anyone above them. */
create or replace function public.can_edit_notice(p_notice_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare n record;
begin
  select * into n from public.notices where id = p_notice_id;
  if not found then
    return false;
  end if;
  if n.created_by = auth.uid() then
    return true;
  end if;
  -- Someone has to be able to take down a notice whose author has left.
  return public.can_publish_notice_scope(
    n.department, n.batch_year, n.offering_id, n.category);
end;
$$;

grant execute on function public.can_edit_notice(uuid) to authenticated;


/* ---------------------------------------------------------------- policies */

alter table public.notices enable row level security;
alter table public.notice_attachments enable row level security;

drop policy if exists notices_read on public.notices;
create policy notices_read on public.notices
  for select to authenticated
  using (public.notice_visible_to_me(id));

/* created_by is pinned to the caller in the check, so a notice cannot be
   filed under somebody else's name. */
drop policy if exists notices_insert on public.notices;
create policy notices_insert on public.notices
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and public.can_publish_notice_scope(department, batch_year, offering_id, category)
  );

drop policy if exists notices_update on public.notices;
create policy notices_update on public.notices
  for update to authenticated
  using (public.can_edit_notice(id))
  with check (
    public.can_publish_notice_scope(department, batch_year, offering_id, category)
  );

drop policy if exists notices_delete on public.notices;
create policy notices_delete on public.notices
  for delete to authenticated
  using (public.can_edit_notice(id));

drop policy if exists notice_attachments_read on public.notice_attachments;
create policy notice_attachments_read on public.notice_attachments
  for select to authenticated
  using (public.notice_visible_to_me(notice_id));

drop policy if exists notice_attachments_write on public.notice_attachments;
create policy notice_attachments_write on public.notice_attachments
  for all to authenticated
  using (public.can_edit_notice(notice_id))
  with check (public.can_edit_notice(notice_id));

revoke all on public.notices from anon;
revoke all on public.notice_attachments from anon;
revoke all on public.notice_categories from anon;
grant select, insert, update, delete on public.notices to authenticated;
grant select, insert, update, delete on public.notice_attachments to authenticated;
grant select on public.notice_categories to authenticated;