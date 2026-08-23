-- a_super_admin_can_move_a_headship
-- Applied 20260823055636
-- Exported from the live project; do not edit by hand.

-- Moving a headship from one lecturer to another.
--
-- hod_appointments already carried the history and the rules: one active row
-- per department, one per lecturer, both as partial unique indexes. What it
-- had no path for was the change itself. Done from a client that is two
-- statements -- close the old, open the new -- and either order can fail
-- halfway: insert first and the unique index refuses it, close first and a
-- failed insert leaves a department with no head at all.
--
-- So the move is one function. It also reads the faculty's lecturers for the
-- screen that drives it, because a super admin choosing a head needs to see
-- who is available department by department.

create or replace function public.get_faculty_lecturers()
returns table(
  lecturer_id uuid, name text, email text, title text, staff_no text,
  department text, status text,
  is_hod boolean, hod_since date)
language plpgsql stable security definer set search_path to 'public'
as $$
begin
  if get_my_role() <> 'super_admin' then
    raise exception 'Access denied: super admin role required';
  end if;

  return query
  select l.id, l.name, l.email, l.title, l.staff_no, l.department, l.status,
         (a.id is not null), a.valid_from
    from public.lecturers l
    left join public.hod_appointments a
      on a.lecturer_id = l.id and a.is_active
   order by l.department, l.name;
end;
$$;

comment on function public.get_faculty_lecturers() is
  'Every lecturer in the faculty with their department and whether they currently head it.';

-- Who has held each headship, newest first, so a transfer can be read back.
create or replace function public.get_hod_history(p_department text)
returns table(
  lecturer_id uuid, name text, email text,
  valid_from date, valid_to date, is_active boolean, notes text)
language plpgsql stable security definer set search_path to 'public'
as $$
begin
  if get_my_role() <> 'super_admin' then
    raise exception 'Access denied: super admin role required';
  end if;

  return query
  select l.id, l.name, l.email, a.valid_from, a.valid_to, a.is_active, a.notes
    from public.hod_appointments a
    join public.lecturers l on l.id = a.lecturer_id
   where a.department = p_department
   order by a.is_active desc, a.valid_from desc;
end;
$$;

create or replace function public.set_department_hod(
  p_department  text,
  p_lecturer_id uuid,
  p_notes       text default null)
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_actor    uuid := auth.uid();
  v_lecturer record;
begin
  if get_my_role() <> 'super_admin' then
    raise exception 'Access denied: super admin role required';
  end if;

  select l.id, l.name, l.department, l.status into v_lecturer
    from public.lecturers l where l.id = p_lecturer_id;

  if v_lecturer.id is null then
    raise exception 'Lecturer not found';
  end if;

  -- A head leads the department they belong to. Without this the screen's
  -- grouping would be the only thing keeping the two in step.
  if v_lecturer.department is distinct from p_department then
    raise exception 'A head of department must be a lecturer in that department';
  end if;

  if v_lecturer.status is distinct from 'active' then
    raise exception 'A lecturer who has left cannot be made head of department';
  end if;

  -- Already in post: returning early keeps the original start date, which
  -- re-appointing would quietly reset.
  if exists (select 1 from public.hod_appointments a
              where a.is_active
                and a.department  = p_department
                and a.lecturer_id = p_lecturer_id) then
    return;
  end if;

  -- The outgoing head, and any headship this person already holds elsewhere.
  -- Both must close before the new row goes in, because one active row per
  -- department and one per lecturer are unique indexes.
  update public.hod_appointments
     set is_active = false,
         valid_to  = greatest(valid_from, current_date),
         ended_by  = v_actor,
         ended_at  = now()
   where is_active
     and (department = p_department or lecturer_id = p_lecturer_id);

  insert into public.hod_appointments
    (lecturer_id, department, valid_from, is_active, assigned_by, notes)
  values (p_lecturer_id, p_department, current_date, true, v_actor, p_notes);
end;
$$;

comment on function public.set_department_hod(text, uuid, text) is
  'Appoints a lecturer head of their department, closing the outgoing appointment in the same statement.';

-- Standing a head down without naming a successor. The row stays; the
-- department is simply left without a head until one is appointed.
create or replace function public.end_department_hod(p_department text)
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_actor uuid := auth.uid();
begin
  if get_my_role() <> 'super_admin' then
    raise exception 'Access denied: super admin role required';
  end if;

  update public.hod_appointments
     set is_active = false,
         valid_to  = greatest(valid_from, current_date),
         ended_by  = v_actor,
         ended_at  = now()
   where is_active and department = p_department;
end;
$$;

grant execute on function public.get_faculty_lecturers() to authenticated;
grant execute on function public.get_hod_history(text) to authenticated;
grant execute on function public.set_department_hod(text, uuid, text) to authenticated;
grant execute on function public.end_department_hod(text) to authenticated;
