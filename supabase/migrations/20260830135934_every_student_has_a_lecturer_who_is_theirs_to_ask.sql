-- every_student_has_a_lecturer_who_is_theirs_to_ask
-- Applied 20260830135934
-- Exported from the live project; do not edit by hand.

-- Every student has a lecturer who is theirs to ask.
--
-- A department assigns each student an academic mentor: a lecturer who
-- watches that student's progress across the whole degree rather than one
-- course of it. The head of department decides who mentors whom.
--
-- Modelled on hod_appointments, which this system already treats as a
-- succession of appointments rather than a column that gets overwritten.
-- Reassigning a student ends one row and opens another, so the history the
-- department needs is a consequence of the shape rather than a feature
-- bolted on beside it. "Who mentors this student" is then a question about
-- which row has not ended, and a partial unique index makes it impossible
-- for two to be open at once.

create table if not exists public.mentor_assignments (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.students(id)  on delete cascade,
  mentor_id   uuid not null references public.lecturers(id) on delete restrict,
  -- Copied at assignment time: a student's department is what the pairing
  -- was made under, and the department owns the allocation.
  department  text not null,
  assigned_by uuid,
  assigned_at timestamptz not null default now(),
  ended_by    uuid,
  ended_at    timestamptz,
  end_reason  text,
  notes       text,
  constraint mentor_assignments_end_after_start
    check (ended_at is null or ended_at >= assigned_at)
);

-- One open assignment per student. Past ones may pile up freely.
create unique index if not exists mentor_assignments_one_current
  on public.mentor_assignments (student_id) where ended_at is null;

create index if not exists mentor_assignments_by_mentor
  on public.mentor_assignments (mentor_id) where ended_at is null;

comment on table public.mentor_assignments is
  'Academic mentor allocations. The row with ended_at null is the current one; the rest are the student''s mentoring history.';

/* ------------------------------------------------------------------ */
/* Who is whose                                                        */
/* ------------------------------------------------------------------ */

-- Answers "is this student currently mine to mentor", which is the question
-- behind every permission in the feature.
create or replace function public.is_my_mentee(p_student_id uuid)
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1
      from public.mentor_assignments ma
      join public.lecturers l on l.id = ma.mentor_id
     where ma.student_id = p_student_id
       and ma.ended_at is null
       and l.auth_user_id = auth.uid()
       and l.status = 'active');
$$;

grant execute on function public.is_my_mentee(uuid) to authenticated;

/* ------------------------------------------------------------------ */
/* Row level security                                                  */
/* ------------------------------------------------------------------ */

alter table public.mentor_assignments enable row level security;

-- A student may see who their mentor is, and who it used to be.
create policy mentor_assignments_student_read on public.mentor_assignments
  for select using (student_id = auth.uid());

-- A mentor may see the students assigned to them, past and present.
create policy mentor_assignments_mentor_read on public.mentor_assignments
  for select using (exists (
    select 1 from public.lecturers l
     where l.id = mentor_assignments.mentor_id
       and l.auth_user_id = auth.uid()));

-- The head of department sees the whole allocation for their department;
-- a super admin sees every department's.
create policy mentor_assignments_head_read on public.mentor_assignments
  for select using (
    coalesce(public.get_my_role(), '') = 'super_admin'
    or public.my_hod_department() = department);

-- Writing goes through assign_student_mentor, which is where the rules live.
-- No write policy: the function is security definer and the only way in.

/* ------------------------------------------------------------------ */
/* A mentor may read their mentees' records                            */
/* ------------------------------------------------------------------ */

-- Mentoring is watching a whole degree, not one course, so a mentor needs
-- the transcript a lecturer is otherwise not shown. Scoped to current
-- mentees: the moment a student is reassigned, their new mentor can read
-- the record and the old one cannot.
create or replace function public.can_view_student_record(p_student_id uuid)
returns boolean
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_role           text;
  v_hod_department text;
begin
  v_role := coalesce(public.get_my_role(), '');
  if v_role = 'super_admin' then
    return true;
  end if;
  if v_role = 'dept_admin' then
    return public.department_owns_student(public.get_my_department(), p_student_id);
  end if;
  v_hod_department := public.my_hod_department();
  if v_hod_department is not null then
    return public.department_owns_student(v_hod_department, p_student_id);
  end if;
  if public.is_my_mentee(p_student_id) then
    return true;
  end if;
  return false;
end;
$$;

grant execute on function public.can_view_student_record(uuid) to authenticated;

/* ------------------------------------------------------------------ */
/* Assigning                                                           */
/* ------------------------------------------------------------------ */

-- The head of department, or a super admin, sets a student's mentor. Ending
-- the previous assignment and opening the new one is one transaction, so a
-- student is never briefly without a mentor and never briefly has two.
create or replace function public.assign_student_mentor(
  p_student_id uuid,
  p_mentor_id  uuid,
  p_note       text default null)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_role     text := coalesce(public.get_my_role(), '');
  v_hod      text := public.my_hod_department();
  v_student  record;
  v_mentor   record;
  v_previous record;
begin
  select s.id, s.name, s.department, s.batch_year into v_student
    from public.students s
   where s.id = p_student_id and s.role = 'student' and s.status = 'active';
  if v_student.id is null then
    raise exception 'No such active student';
  end if;

  if v_role <> 'super_admin'
     and (v_hod is null or v_hod is distinct from v_student.department) then
    raise exception 'Only this department''s head can assign its mentors';
  end if;

  select l.id, l.name, l.title, l.department, l.status into v_mentor
    from public.lecturers l where l.id = p_mentor_id;
  if v_mentor.id is null or v_mentor.status <> 'active' then
    raise exception 'That lecturer is not on the active staff list';
  end if;
  -- A mentor belongs to the student's own department: mentoring is a
  -- departmental duty, and the head assigning it only heads one department.
  if v_mentor.department is distinct from v_student.department then
    raise exception '% teaches in %, not %',
      v_mentor.name, v_mentor.department, v_student.department;
  end if;

  select ma.id, ma.mentor_id into v_previous
    from public.mentor_assignments ma
   where ma.student_id = p_student_id and ma.ended_at is null;

  if v_previous.mentor_id = p_mentor_id then
    return jsonb_build_object('ok', true, 'changed', false,
      'message', format('%s already mentors %s.', v_mentor.name, v_student.name));
  end if;

  if v_previous.id is not null then
    update public.mentor_assignments
       set ended_at = now(), ended_by = auth.uid(), end_reason = 'reassigned'
     where id = v_previous.id;
  end if;

  insert into public.mentor_assignments
    (student_id, mentor_id, department, assigned_by, notes)
  values (p_student_id, p_mentor_id, v_student.department, auth.uid(), p_note);

  return jsonb_build_object('ok', true, 'changed', true,
    'message', case when v_previous.id is null
      then format('%s is now mentored by %s.', v_student.name, v_mentor.name)
      else format('%s moved to %s.', v_student.name, v_mentor.name) end);
end;
$$;

grant execute on function public.assign_student_mentor(uuid, uuid, text) to authenticated;

-- Removing a mentor without naming a replacement, for a student who is
-- leaving or whose mentor has.
create or replace function public.clear_student_mentor(
  p_student_id uuid, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_role text := coalesce(public.get_my_role(), '');
  v_hod  text := public.my_hod_department();
  v_dept text;
  v_n    int;
begin
  select s.department into v_dept from public.students s where s.id = p_student_id;
  if v_dept is null then
    raise exception 'No such student';
  end if;
  if v_role <> 'super_admin' and (v_hod is null or v_hod is distinct from v_dept) then
    raise exception 'Only this department''s head can change its mentors';
  end if;

  update public.mentor_assignments
     set ended_at = now(), ended_by = auth.uid(),
         end_reason = coalesce(nullif(btrim(p_reason), ''), 'unassigned')
   where student_id = p_student_id and ended_at is null;
  get diagnostics v_n = row_count;

  return jsonb_build_object('ok', true, 'changed', v_n > 0,
    'message', case when v_n > 0 then 'Mentor removed.'
                    else 'That student had no mentor.' end);
end;
$$;

grant execute on function public.clear_student_mentor(uuid, text) to authenticated;
