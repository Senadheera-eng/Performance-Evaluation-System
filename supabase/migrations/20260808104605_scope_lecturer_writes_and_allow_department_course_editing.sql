-- scope_lecturer_writes_and_allow_department_course_editing
-- Applied 20260808104605
-- Exported from the live project; do not edit by hand.

-- ---------------------------------------------------------------------
-- 1. Scope writes on `lecturers` to the owning department
-- ---------------------------------------------------------------------
-- The previous policy was `get_my_role() = 'dept_admin'` with no department
-- predicate at all, so any department admin could edit — or retire — a
-- lecturer in any other department. With only placeholder rows that was
-- invisible; with the full 40-strong staff list it is a real hole.

drop policy if exists "Anyone can view lecturers" on public.lecturers;
drop policy if exists lecturers_public_read       on public.lecturers;
drop policy if exists lecturers_admin_all         on public.lecturers;

-- The staff directory is published in the Faculty Handbook, and the student
-- feedback form has to name the lecturer being rated.
create policy lecturers_read on public.lecturers
  for select to authenticated using (true);

create policy lecturers_dept_admin_write on public.lecturers
  for all to authenticated
  using      (get_my_role() = 'dept_admin' and get_my_department() = department)
  with check (get_my_role() = 'dept_admin' and get_my_department() = department);

create policy lecturers_hod_write on public.lecturers
  for all to authenticated
  using      (is_active_hod_of(department))
  with check (is_active_hod_of(department));

create policy lecturers_super_admin_write on public.lecturers
  for all to authenticated
  using      (get_my_role() = 'super_admin')
  with check (get_my_role() = 'super_admin');

-- A lecturer must not be able to grant themselves a department move or
-- reactivate their own retired record — the same protection `admins`
-- already has via prevent_self_privilege_escalation.
create or replace function public.prevent_lecturer_self_escalation()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if old.auth_user_id is not null and old.auth_user_id = auth.uid() then
    new.department  := old.department;
    new.status      := old.status;
    new.auth_user_id := old.auth_user_id;
    new.email       := old.email;
  end if;
  return new;
end;
$$;

drop trigger if exists lecturers_no_self_escalation on public.lecturers;
create trigger lecturers_no_self_escalation
  before update on public.lecturers
  for each row execute function public.prevent_lecturer_self_escalation();

-- ---------------------------------------------------------------------
-- 2. Let departments edit their own courses again
-- ---------------------------------------------------------------------
-- `courses` was deliberately made read-only for everyone (only
-- courses_public_read remained). Department admins and HODs now need to
-- correct course metadata for their own courses, so writes come back — but
-- narrowly, and with the identity columns pinned.

create policy courses_dept_admin_write on public.courses
  for all to authenticated
  using      (get_my_role() = 'dept_admin' and get_my_department() = department)
  with check (get_my_role() = 'dept_admin' and get_my_department() = department);

create policy courses_hod_write on public.courses
  for all to authenticated
  using      (is_active_hod_of(department))
  with check (is_active_hod_of(department));

create policy courses_super_admin_write on public.courses
  for all to authenticated
  using      (get_my_role() = 'super_admin')
  with check (get_my_role() = 'super_admin');

-- RLS is row-level; "which columns may be edited" is not something a policy
-- can express. `course_code` and `department` are the course's identity —
-- results, offerings, enrollments and every department-scoped policy in the
-- schema resolve through them. A department admin editing a course must not
-- be able to rename its code or hand it to another department (which would
-- also move it straight out of their own scope). Super admin may.
create or replace function public.pin_course_identity_columns()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if get_my_role() = 'super_admin' then
    return new;
  end if;
  if new.course_code <> old.course_code then
    raise exception 'Course code cannot be changed (% -> %). Ask a Super Admin.',
      old.course_code, new.course_code;
  end if;
  if new.department <> old.department then
    raise exception 'A course cannot be moved between departments. Ask a Super Admin.';
  end if;
  return new;
end;
$$;

drop trigger if exists courses_pin_identity on public.courses;
create trigger courses_pin_identity
  before update on public.courses
  for each row execute function public.pin_course_identity_columns();

-- Deleting a course would orphan real results and enrollments. Nobody below
-- super_admin gets that, and even they should be going through the catalogue
-- rather than a DELETE, so this is a hard stop with a clear message.
create or replace function public.block_course_delete_with_history()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if exists (select 1 from public.results     where course_id = old.id)
  or exists (select 1 from public.enrollments where course_id = old.id) then
    raise exception 'Course % has results or enrollments and cannot be deleted; archive it instead.',
      old.course_code;
  end if;
  return old;
end;
$$;

drop trigger if exists courses_block_delete on public.courses;
create trigger courses_block_delete
  before delete on public.courses
  for each row execute function public.block_course_delete_with_history();
