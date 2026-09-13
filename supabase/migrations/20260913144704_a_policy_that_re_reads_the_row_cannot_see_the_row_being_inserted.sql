/*
  Publishing a notice failed for everyone, including the super admin, with
  "new row violates row-level security policy".

  The insert was never the problem. INSERT ... RETURNING applies the SELECT
  policy as well as the INSERT one, and the SELECT policy called
  notice_visible_to_me(id) — which answers by running its own
  "select * from notices where id = ...". That re-read runs in the same
  command as the insert and cannot see the row the insert is still writing,
  so it found nothing, returned false, and the RETURNING was refused. The row
  itself passed every check: dropping .select() from the client made the same
  insert succeed, which is what pinned it down.

  So the rule is expressed over the row's own values instead of over its id.
  Nothing re-reads anything, which makes it correct during an insert and
  cheaper everywhere else.

  There is still exactly one rule. notice_visible_to_me keeps its signature —
  storage policies and get_notice look a notice up by id and have no columns
  to hand — but it now fetches the row once and hands the values to
  notice_row_readable, which is the only place the logic lives.
*/

create or replace function public.notice_row_readable(
  p_created_by uuid,
  p_status text,
  p_published_at timestamptz,
  p_department text,
  p_batch_year integer,
  p_offering_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_role     text := coalesce(public.get_my_role(), '');
  v_hod      text := public.my_hod_department();
  v_lecturer uuid := public.my_lecturer_id();
  v_student  record;
  v_off_dept text;
begin
  -- Your own work is yours to see, draft or not.
  if p_created_by = auth.uid() then
    return true;
  end if;

  if v_role = 'super_admin' then
    return true;
  end if;

  if p_offering_id is not null then
    v_off_dept := public.offering_department(p_offering_id);
  end if;

  if v_role = 'dept_admin' then
    return p_department is null
        or p_department = public.get_my_department()
        or v_off_dept = public.get_my_department();
  end if;

  -- Nobody below a department admin sees unpublished or future-dated work.
  if p_status <> 'published'
     or p_published_at is null
     or p_published_at > now() then
    return false;
  end if;

  if v_hod is not null then
    if p_department is null or p_department = v_hod or v_off_dept = v_hod then
      return true;
    end if;
  end if;

  if v_lecturer is not null then
    if p_department is null
       or p_department = (select l.department from public.lecturers l
                           where l.id = v_lecturer) then
      return true;
    end if;
    return p_offering_id is not null
       and public.is_assigned_lecturer(p_offering_id);
  end if;

  select s.department, s.batch_year into v_student
    from public.students s where s.id = auth.uid() and s.role = 'student';
  if not found then
    return false;
  end if;

  /* A course notice goes to whoever sat that offering, whatever department
     they are in — a shared Interdisciplinary module has students from all
     five. */
  if p_offering_id is not null then
    return exists (
      select 1 from public.course_offerings o
       where o.id = p_offering_id
         and exists (select 1 from public.enrollments e
                      where e.student_id = auth.uid()
                        and e.course_id = o.course_id
                        and e.academic_year = o.academic_year));
  end if;

  /* A first-year has no department yet, so only faculty-wide notices reach
     them — the same rule the enrolment windows follow. */
  if p_department is not null
     and p_department is distinct from v_student.department then
    return false;
  end if;
  if p_batch_year is not null
     and p_batch_year is distinct from v_student.batch_year then
    return false;
  end if;

  return true;
end;
$$;

grant execute on function public.notice_row_readable(
  uuid, text, timestamptz, text, integer, uuid) to authenticated;

/* Same question, asked by id, for callers that only have one. */
create or replace function public.notice_visible_to_me(p_notice_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare n record;
begin
  select created_by, status, published_at, department, batch_year, offering_id
    into n from public.notices where id = p_notice_id;
  if not found then
    return false;
  end if;
  return public.notice_row_readable(
    n.created_by, n.status, n.published_at,
    n.department, n.batch_year, n.offering_id);
end;
$$;

/* The policy now reads the row in front of it rather than going back for it. */
drop policy if exists notices_read on public.notices;
create policy notices_read on public.notices
  for select to authenticated
  using (public.notice_row_readable(
           created_by, status, published_at, department, batch_year, offering_id));