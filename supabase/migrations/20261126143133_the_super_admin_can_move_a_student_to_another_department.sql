-- The Super Admin can move any student to another department.
--
-- Nothing the student has already done moves with them or is lost: results,
-- attendance, enrolments and medical submissions stay exactly as recorded,
-- under the courses they belong to. What changes is where the student
-- belongs from now on: which department's admin and head look after them,
-- and whose courses and minors they choose from.
--
-- A mentor belongs to the student's own department (assign_student_mentor
-- holds to that), so a mentor from the department they leave stops being
-- their mentor. The assignment is ended, not deleted: the history and their
-- messages stay, and the new department's head assigns a new mentor.
--
-- Every change of department is recorded in student_department_changes,
-- whichever way it is made: this function, or dividing a batch on the
-- Batches page.

create table if not exists public.student_department_changes (
  id              uuid primary key default gen_random_uuid(),
  student_id      uuid not null references public.students (id) on delete cascade,
  from_department text,
  to_department   text,
  reason          text,
  changed_by      uuid,
  changed_at      timestamptz not null default now()
);
create index if not exists student_department_changes_student_idx
  on public.student_department_changes (student_id, changed_at desc);
alter table public.student_department_changes enable row level security;
drop policy if exists student_department_changes_read on public.student_department_changes;
create policy student_department_changes_read on public.student_department_changes
  for select to authenticated
  using (student_id = (select auth.uid()) or public.can_view_student_record(student_id));

create or replace function public.record_student_department_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.student_department_changes
    (student_id, from_department, to_department, reason, changed_by)
  values
    (new.id, old.department, new.department,
     nullif(current_setting('pes.department_change_reason', true), ''), auth.uid());
  return null;
end;
$function$;
revoke all on function public.record_student_department_change() from public, anon, authenticated;

drop trigger if exists students_record_department_change on public.students;
create trigger students_record_department_change
  after update of department on public.students
  for each row
  when (old.department is distinct from new.department)
  execute function public.record_student_department_change();

/* What the Super Admin needs to see before moving a student. */
create or replace function public.admin_student_department_preview(p_student_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_student record;
  v_mentor  record;
  v_minor   record;
begin
  if not public.is_super_admin() then
    raise exception 'Only the Super Admin can move a student to another department';
  end if;

  select s.id, s.name, s.department into v_student
    from public.students s where s.id = p_student_id;
  if v_student.id is null then
    raise exception 'No such student';
  end if;

  select case when coalesce(l.title, '') <> '' then l.title || ' ' || l.name else l.name end as name,
         l.department
    into v_mentor
    from public.mentor_assignments m
    join public.lecturers l on l.id = m.mentor_id
   where m.student_id = p_student_id and m.ended_at is null
   order by m.assigned_at desc
   limit 1;

  select c.minor, c.department into v_minor
    from public.student_minor_choices c where c.student_id = p_student_id;

  return jsonb_build_object(
    'name', v_student.name,
    'department', v_student.department,
    'mentor_name', v_mentor.name,
    'mentor_department', v_mentor.department,
    'minor', v_minor.minor,
    'minor_department', v_minor.department,
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
               'from_department', h.from_department,
               'to_department', h.to_department,
               'reason', h.reason,
               'changed_at', h.changed_at,
               'changed_by_name', coalesce(a.name, l.name, 'Unknown'))
             order by h.changed_at desc)
        from public.student_department_changes h
        left join public.admins a on a.id = h.changed_by
        left join public.lecturers l on l.auth_user_id = h.changed_by
       where h.student_id = p_student_id), '[]'::jsonb));
end;
$function$;
revoke all on function public.admin_student_department_preview(uuid) from public, anon;
grant execute on function public.admin_student_department_preview(uuid) to authenticated;

create or replace function public.admin_change_student_department(
  p_student_id uuid,
  p_department text,
  p_reason     text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_student    record;
  v_department text := nullif(btrim(coalesce(p_department, '')), '');
  v_reason     text := nullif(left(btrim(coalesce(p_reason, '')), 300), '');
  v_mentor     text;
begin
  if not public.is_super_admin() then
    raise exception 'Only the Super Admin can move a student to another department';
  end if;
  if v_department is null or v_department not in (
      'Civil Engineering', 'Computer Engineering',
      'Electrical and Electronic Engineering', 'Mechanical Engineering') then
    raise exception 'Choose the department the student is moving to';
  end if;
  if v_reason is null then
    raise exception 'Give a reason. It is kept with the student''s record.';
  end if;

  select s.id, s.name, s.department into v_student
    from public.students s where s.id = p_student_id and s.role = 'student'
     for update;
  if v_student.id is null then
    raise exception 'No such student';
  end if;
  if v_student.department is not distinct from v_department then
    return jsonb_build_object('ok', false,
      'message', format('%s is already in %s.', v_student.name, v_department));
  end if;

  -- A mentor from another department stops being their mentor.
  with ended as (
    update public.mentor_assignments m
       set ended_at = now(), ended_by = auth.uid(),
           end_reason = 'Moved to ' || v_department
      from public.lecturers l
     where m.student_id = p_student_id and m.ended_at is null
       and l.id = m.mentor_id and l.department is distinct from v_department
    returning case when coalesce(l.title, '') <> '' then l.title || ' ' || l.name else l.name end as name
  )
  select string_agg(name, ', ') into v_mentor from ended;

  perform set_config('pes.department_change_reason', v_reason, true);
  update public.students set department = v_department where id = p_student_id;
  perform set_config('pes.department_change_reason', '', true);

  return jsonb_build_object(
    'ok', true,
    'from_department', v_student.department,
    'to_department', v_department,
    'mentor_ended', v_mentor,
    'message', format('%s moved %s to %s.%s',
      v_student.name,
      case when v_student.department is null then 'into' else 'from ' || v_student.department end,
      v_department,
      case when v_mentor is not null
           then format(' %s is no longer their mentor; the Head of %s can assign a new one.', v_mentor, v_department)
           else '' end));
end;
$function$;
revoke all on function public.admin_change_student_department(uuid, text, text) from public, anon;
grant execute on function public.admin_change_student_department(uuid, text, text) to authenticated;
