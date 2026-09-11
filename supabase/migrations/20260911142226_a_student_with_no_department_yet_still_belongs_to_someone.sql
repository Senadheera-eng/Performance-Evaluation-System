/*
  First-year students are admitted to the faculty, not to a department. They
  are divided into departments partway through, and until that happens
  students.department is null. Three things went wrong with that.

  1. Nobody could give one a mentor. assign_student_mentor compares the
     mentor's department to the student's, and `is distinct from` against null
     is true, so the check fired for everyone — including the super admin, who
     is precisely the person responsible for a student with no department. The
     message it produced read "Sanuri Liyanaarachchi teaches in Computer
     Engineering, not ." Even had it passed, mentor_assignments.department is
     NOT NULL and the insert would have failed.

  2. clear_student_mentor read the student's department and treated null as
     "no such student", so a first-year's mentor could not be removed either,
     and the error blamed the wrong thing.

  3. The handover did not happen. mentor_assignments stored a copy of the
     department the student was in when the mentor was assigned, and the read
     policy compared the head's department to that copy. Move a student from
     Civil to Computer Engineering and the Computer Engineering head sees the
     student on their roster — that read uses the live value — but cannot read
     the assignment row behind it, because the copy still says Civil. Measured:
     roster shows "Dr. Praween Madusanka", underlying row returns 0 rows.

  The copy is the bug. A mentor assignment belongs to whichever department the
  student is in now, so read it from the student and store it nowhere. Then the
  transfer is not an event anyone has to perform: setting students.department
  is the whole of it.

  What does not change: a student with no department is visible to the super
  admin and to no department admin or head. That was already true, and is what
  "the Super Admin holds them until they are divided" means.
*/

create or replace function public.student_department(p_student_id uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select s.department from public.students s where s.id = p_student_id
$$;

comment on function public.student_department(uuid) is
  'The department a student is in right now. Null until a first-year is '
  'divided into one. Read this rather than storing a copy: a copy is what '
  'stops responsibility moving with the student.';

grant execute on function public.student_department(uuid) to authenticated;


-- ---------------------------------------------------------------- the policy

drop policy if exists mentor_assignments_head_read on public.mentor_assignments;
create policy mentor_assignments_head_read on public.mentor_assignments
  for select
  using (
    coalesce(public.get_my_role(), '') = 'super_admin'
    -- Null on either side compares to null, which is not true: a lecturer
    -- with no appointment reads nothing, and a student with no department
    -- yet is read by the super admin alone.
    or public.my_hod_department() = public.student_department(student_id)
  );

alter table public.mentor_assignments drop column department;


-- ------------------------------------------------------------- the two writes

create or replace function public.assign_student_mentor(
  p_student_id uuid,
  p_mentor_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_role     text    := coalesce(public.get_my_role(), '');
  v_is_super boolean := v_role = 'super_admin';
  v_hod      text    := public.my_hod_department();
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

  if not v_is_super then
    if v_student.department is null then
      raise exception
        '% has not been divided into a department yet. Until they are, the Super Admin assigns their mentor.',
        v_student.name;
    end if;
    if v_hod is null or v_hod is distinct from v_student.department then
      raise exception 'Only this department''s head can assign its mentors';
    end if;
  end if;

  select l.id, l.name, l.title, l.department, l.status into v_mentor
    from public.lecturers l where l.id = p_mentor_id;
  if v_mentor.id is null or v_mentor.status <> 'active' then
    raise exception 'That lecturer is not on the active staff list';
  end if;

  -- A mentor belongs to the student's own department: mentoring is a
  -- departmental duty, and the head assigning it only heads one department.
  -- A student with no department yet has no such department to match, so any
  -- active lecturer may take them on until the division is made.
  if v_student.department is not null
     and v_mentor.department is distinct from v_student.department then
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
    (student_id, mentor_id, assigned_by, notes)
  values (p_student_id, p_mentor_id, auth.uid(), p_note);

  return jsonb_build_object('ok', true, 'changed', true,
    'message', case when v_previous.id is null
      then format('%s is now mentored by %s.', v_student.name, v_mentor.name)
      else format('%s moved to %s.', v_student.name, v_mentor.name) end);
end;
$$;

create or replace function public.clear_student_mentor(
  p_student_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_role     text    := coalesce(public.get_my_role(), '');
  v_is_super boolean := v_role = 'super_admin';
  v_hod      text    := public.my_hod_department();
  v_student  record;
  v_n        int;
begin
  -- Existence is the id, not the department. Reading null as "no such
  -- student" told a first-year's Super Admin that the student did not exist.
  select s.id, s.name, s.department into v_student
    from public.students s where s.id = p_student_id;
  if v_student.id is null then
    raise exception 'No such student';
  end if;

  if not v_is_super then
    if v_student.department is null then
      raise exception
        '% has not been divided into a department yet. Until they are, the Super Admin manages their mentor.',
        v_student.name;
    end if;
    if v_hod is null or v_hod is distinct from v_student.department then
      raise exception 'Only this department''s head can change its mentors';
    end if;
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


-- -------------------------------------------------------------- the handover

/*
  When a student moves into a department, their existing mentor comes with
  them — and that mentor may teach somewhere else. The new head inherits the
  pairing and should be able to see that, so the roster now says which
  department the mentor is in rather than leaving the head to guess from a
  name.
*/
drop function if exists public.get_department_mentor_roster();
create function public.get_department_mentor_roster()
returns table(
  student_id uuid,
  name text,
  index_number text,
  reg_number text,
  email text,
  department text,
  batch_year integer,
  cgpa numeric,
  mentor_id uuid,
  mentor_name text,
  mentor_department text,
  assigned_at timestamp with time zone
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_is_super boolean := coalesce(public.get_my_role(), '') = 'super_admin';
  v_dept     text    := public.my_hod_department();
begin
  if not v_is_super and v_dept is null then
    raise exception 'Mentor allocation is the head of department''s to see';
  end if;

  return query
  with graded as (
    select r.student_id,
           sum(c.credits * r.gpv) filter (where c.contributes_to_gpa and r.gpv is not null) as weighted,
           sum(c.credits)         filter (where c.contributes_to_gpa and r.gpv is not null) as credits
      from public.results r
      join public.courses c on c.id = r.course_id
     where r.is_published
     group by r.student_id
  )
  select s.id, s.name, s.index_number, s.reg_number, s.email,
         s.department, s.batch_year,
         case when g.credits > 0 then round((g.weighted / g.credits)::numeric, 2) end,
         l.id, coalesce(l.title || ' ', '') || l.name, l.department, ma.assigned_at
    from public.students s
    left join graded g on g.student_id = s.id
    left join public.mentor_assignments ma
      on ma.student_id = s.id and ma.ended_at is null
    left join public.lecturers l on l.id = ma.mentor_id
   where s.role = 'student' and s.status = 'active'
     and (v_is_super or s.department = v_dept)
   order by s.batch_year desc, s.index_number;
end;
$$;

grant execute on function public.get_department_mentor_roster() to authenticated;


-- ------------------------------------------------------------------- hygiene

/*
  A migration-era copy of the feedback tables, holding 57 answers and 2
  submissions from students who were told their feedback was anonymous. It has
  no grants to anon or authenticated, so nothing reaches it through the API
  today — but that is safety by omission, and one blanket grant would undo it.
  Row security costs nothing and makes it safe by construction.
*/
alter table public.feedback_backup_20260829 enable row level security;
