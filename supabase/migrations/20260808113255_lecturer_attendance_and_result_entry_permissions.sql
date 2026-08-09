-- lecturer_attendance_and_result_entry_permissions
-- Applied 20260808113255
-- Exported from the live project; do not edit by hand.

-- Attendance gains the offering link for the same reason results did: a
-- lecturer's authority comes from their assignment to an offering, and
-- course_id alone cannot say which batch's delivery a row belongs to.
alter table public.attendance
  add column if not exists offering_id uuid references public.course_offerings(id) on delete set null,
  add column if not exists recorded_by uuid references auth.users(id) on delete set null;

update public.attendance a
   set offering_id = o.id
  from public.course_offerings o, public.students s
 where s.id = a.student_id
   and o.course_id  = a.course_id
   and o.batch_year = s.batch_year
   and a.offering_id is null
   -- A batch can in principle have the same course in two academic years
   -- (a repeat). Only backfill where the match is unambiguous; anything
   -- else is left null and re-marked through the UI, which knows the offering.
   and (select count(*) from public.course_offerings o2
         where o2.course_id = a.course_id and o2.batch_year = s.batch_year) = 1;

create index if not exists attendance_offering_idx on public.attendance (offering_id);

-- ---------------------------------------------------------------------
-- Combined staff predicate
-- ---------------------------------------------------------------------
/** Anyone entitled to act on an offering: the lecturers teaching it, the HOD
 *  of the owning department, that department's admin, or a super admin.
 *  Kept in one place so the roster, attendance, marks and feedback paths
 *  cannot drift apart on who counts as staff for an offering. */
create or replace function public.is_offering_staff(p_offering_id uuid)
returns boolean
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_department text;
begin
  if p_offering_id is null then
    return false;
  end if;
  if public.get_my_role() = 'super_admin' then
    return true;
  end if;
  v_department := public.offering_department(p_offering_id);
  if v_department is null then
    return false;
  end if;
  return public.is_assigned_lecturer(p_offering_id)
      or public.is_active_hod_of(v_department)
      or (public.get_my_role() = 'dept_admin' and public.get_my_department() = v_department);
end;
$$;

revoke execute on function public.is_offering_staff(uuid) from public, anon;
grant  execute on function public.is_offering_staff(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Lecturer access to attendance
-- ---------------------------------------------------------------------
-- Scoped strictly to offerings the lecturer is assigned to. A null
-- offering_id fails is_assigned_lecturer, so the marking UI is obliged to
-- record which delivery it is marking rather than leaving it implicit.
drop policy if exists attendance_lecturer_manage on public.attendance;
create policy attendance_lecturer_manage on public.attendance
  for all to authenticated
  using      (is_assigned_lecturer(offering_id))
  with check (is_assigned_lecturer(offering_id));

drop policy if exists attendance_hod_read on public.attendance;
create policy attendance_hod_read on public.attendance
  for select to authenticated
  using (is_active_hod_of(offering_department(offering_id)));

-- ---------------------------------------------------------------------
-- Lecturer access to results
-- ---------------------------------------------------------------------
-- Read covers every state, so a lecturer can see what was eventually
-- published, including the ESE mark they entered.
drop policy if exists results_lecturer_read on public.results;
create policy results_lecturer_read on public.results
  for select to authenticated
  using (is_assigned_lecturer(offering_id));

-- Writes stop at 'draft'. Once submitted the sheet belongs to the department
-- admin's review, and a published result is not a lecturer's to amend — that
-- is the whole point of separating entry from publication.
drop policy if exists results_lecturer_insert on public.results;
create policy results_lecturer_insert on public.results
  for insert to authenticated
  with check (is_assigned_lecturer(offering_id) and status = 'draft');

drop policy if exists results_lecturer_update on public.results;
create policy results_lecturer_update on public.results
  for update to authenticated
  using      (is_assigned_lecturer(offering_id) and status = 'draft')
  with check (is_assigned_lecturer(offering_id) and status = 'draft');

drop policy if exists results_hod_read on public.results;
create policy results_hod_read on public.results
  for select to authenticated
  using (is_active_hod_of(offering_department(offering_id)));

-- ---------------------------------------------------------------------
-- Roster for an offering
-- ---------------------------------------------------------------------
-- Students' own RLS scopes a department admin to their own department's
-- students, and gives a lecturer nothing at all — but an offering is taken
-- by students from every department (every shared first-year course is).
-- Resolved server-side, gated on is_offering_staff.
create or replace function public.get_offering_roster(p_offering_id uuid)
returns table (
  student_id    uuid,
  name          text,
  index_number  text,
  reg_number    text,
  department    text,
  batch_year    integer,
  is_repeat     boolean
)
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_batch integer;
begin
  if not public.is_offering_staff(p_offering_id) then
    raise exception 'Not authorised for this course offering';
  end if;

  select o.batch_year into v_batch
    from public.course_offerings o where o.id = p_offering_id;

  return query
  select s.id, s.name, s.index_number, s.reg_number, s.department, s.batch_year,
         (s.batch_year is distinct from v_batch) as is_repeat
    from public.students s
   where s.role = 'student'
     and (
       exists (select 1 from public.enrollments e
                where e.student_id = s.id
                  and e.course_id = (select course_id from public.course_offerings where id = p_offering_id)
                  and e.academic_year = (select academic_year from public.course_offerings where id = p_offering_id))
       or exists (select 1 from public.results r
                   where r.student_id = s.id and r.offering_id = p_offering_id)
     )
   order by s.index_number;
end;
$$;

revoke execute on function public.get_offering_roster(uuid) from public, anon;
grant  execute on function public.get_offering_roster(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Workflow transitions
-- ---------------------------------------------------------------------
-- Whole-sheet operations rather than per-row updates: a result sheet is
-- reviewed and published as one document, and doing it row by row from the
-- client is how half-submitted sheets happen.

/** Lecturer hands a completed sheet to the department admin. */
create or replace function public.submit_offering_results(p_offering_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_incomplete int;
  v_moved int;
begin
  if not (public.is_assigned_lecturer(p_offering_id)
          or public.get_my_role() in ('dept_admin', 'super_admin')) then
    raise exception 'Only an assigned lecturer or department admin can submit this sheet';
  end if;

  select count(*) into v_incomplete
    from public.results
   where offering_id = p_offering_id and status = 'draft' and grade is null;

  if v_incomplete > 0 then
    return jsonb_build_object(
      'ok', false,
      'incomplete', v_incomplete,
      'message', format('%s row(s) have no grade yet. Complete every mark before submitting.', v_incomplete));
  end if;

  update public.results
     set status = 'submitted', submitted_by = auth.uid(), submitted_at = now(),
         returned_by = null, returned_at = null, return_notes = null
   where offering_id = p_offering_id and status = 'draft';

  get diagnostics v_moved = row_count;
  return jsonb_build_object('ok', true, 'submitted', v_moved,
    'message', format('%s result(s) submitted for review.', v_moved));
end;
$$;

/** Department admin (or HOD) sends a sheet back to the lecturer. */
create or replace function public.return_offering_results(p_offering_id uuid, p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_department text;
  v_moved int;
begin
  v_department := public.offering_department(p_offering_id);
  if not (public.get_my_role() = 'super_admin'
          or (public.get_my_role() = 'dept_admin' and public.get_my_department() = v_department)
          or public.is_active_hod_of(v_department)) then
    raise exception 'Only the department admin or HOD can return this sheet';
  end if;

  update public.results
     set status = 'draft', returned_by = auth.uid(), returned_at = now(),
         return_notes = p_notes
   where offering_id = p_offering_id and status = 'submitted';

  get diagnostics v_moved = row_count;
  return jsonb_build_object('ok', true, 'returned', v_moved,
    'message', format('%s result(s) returned to the lecturer.', v_moved));
end;
$$;

/** Department admin publishes. Deliberately NOT available to lecturers or
 *  HODs: publication is the department's administrative act. */
create or replace function public.publish_offering_results(p_offering_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_department text;
  v_skipped int;
  v_moved int;
begin
  v_department := public.offering_department(p_offering_id);
  if not (public.get_my_role() = 'super_admin'
          or (public.get_my_role() = 'dept_admin' and public.get_my_department() = v_department)) then
    raise exception 'Only the department admin can publish results';
  end if;

  select count(*) into v_skipped
    from public.results
   where offering_id = p_offering_id and status <> 'published' and grade is null;

  update public.results
     set status = 'published'
   where offering_id = p_offering_id
     and status in ('draft', 'submitted')
     and grade is not null;

  get diagnostics v_moved = row_count;
  return jsonb_build_object('ok', true, 'published', v_moved, 'skipped', v_skipped,
    'message', case when v_skipped > 0
      then format('%s result(s) published; %s skipped for having no grade.', v_moved, v_skipped)
      else format('%s result(s) published.', v_moved) end);
end;
$$;

revoke execute on function public.submit_offering_results(uuid)        from public, anon;
revoke execute on function public.return_offering_results(uuid, text)  from public, anon;
revoke execute on function public.publish_offering_results(uuid)       from public, anon;
grant  execute on function public.submit_offering_results(uuid)        to authenticated;
grant  execute on function public.return_offering_results(uuid, text)  to authenticated;
grant  execute on function public.publish_offering_results(uuid)       to authenticated;
