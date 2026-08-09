-- create_hod_appointments
-- Applied 20260808104334
-- Exported from the live project; do not edit by hand.

-- HOD as a time-bounded appointment held by a lecturer, not a separate
-- account type. When the headship changes, the appointment ends and a new
-- one begins; the person's lecturer identity, teaching assignments and
-- feedback history are untouched.

create table if not exists public.hod_appointments (
  id           uuid primary key default gen_random_uuid(),
  lecturer_id  uuid not null references public.lecturers(id) on delete cascade,
  department   text not null,
  valid_from   date not null default current_date,
  valid_to     date,
  is_active    boolean not null default true,
  assigned_by  uuid references auth.users(id) on delete set null,
  assigned_at  timestamptz not null default now(),
  ended_by     uuid references auth.users(id) on delete set null,
  ended_at     timestamptz,
  notes        text,
  constraint hod_appointments_valid_range check (valid_to is null or valid_to >= valid_from),
  -- An ended appointment must be inactive, and vice versa: the two can't drift.
  constraint hod_appointments_active_consistency check (
    (is_active and valid_to is null) or (not is_active)
  )
);

-- Exactly one sitting HOD per department. A partial unique index rather than
-- a plain one, so the historical record of past appointments is unbounded.
create unique index if not exists hod_appointments_one_active_per_department
  on public.hod_appointments (department) where is_active;

-- And a lecturer heads at most one department at a time.
create unique index if not exists hod_appointments_one_active_per_lecturer
  on public.hod_appointments (lecturer_id) where is_active;

create index if not exists hod_appointments_lecturer_idx on public.hod_appointments (lecturer_id);

-- The appointment's department must be the lecturer's own. Enforced in the
-- database rather than only in the assignment UI, because "HOD must not be
-- able to manage another department" is the whole point of the scope and a
-- mismatched row here would silently widen it.
create or replace function public.hod_appointment_department_matches()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_department text;
  v_status     text;
begin
  select department, status into v_department, v_status
    from public.lecturers where id = new.lecturer_id;

  if v_department is null then
    raise exception 'Lecturer % does not exist', new.lecturer_id;
  end if;
  if v_department <> new.department then
    raise exception 'Lecturer belongs to % and cannot be appointed HOD of %',
      v_department, new.department;
  end if;
  if new.is_active and v_status <> 'active' then
    raise exception 'Only an active lecturer can hold an HOD appointment';
  end if;
  return new;
end;
$$;

drop trigger if exists hod_appointment_department_check on public.hod_appointments;
create trigger hod_appointment_department_check
  before insert or update on public.hod_appointments
  for each row execute function public.hod_appointment_department_matches();

-- ---------------------------------------------------------------------
-- Staff identity helpers
-- ---------------------------------------------------------------------
-- SECURITY DEFINER throughout, matching get_my_role()/get_my_department():
-- these are read by policies on the very tables they query, so they must
-- not themselves be subject to RLS or every call would recurse.

create or replace function public.my_lecturer_id()
returns uuid
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.lecturers
   where auth_user_id = auth.uid() and status = 'active';
  return v_id;
end;
$$;

create or replace function public.is_active_hod_of(p_department text)
returns boolean
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_lecturer uuid;
begin
  v_lecturer := public.my_lecturer_id();
  if v_lecturer is null or p_department is null then
    return false;
  end if;
  return exists (
    select 1 from public.hod_appointments
     where lecturer_id = v_lecturer
       and department  = p_department
       and is_active
  );
end;
$$;

/** The department this caller heads, or NULL if they hold no appointment. */
create or replace function public.my_hod_department()
returns text
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_lecturer uuid;
  v_department text;
begin
  v_lecturer := public.my_lecturer_id();
  if v_lecturer is null then
    return null;
  end if;
  select department into v_department from public.hod_appointments
   where lecturer_id = v_lecturer and is_active;
  return v_department;
end;
$$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.hod_appointments enable row level security;

-- Who currently heads a department is not sensitive — it is printed in the
-- Faculty Handbook — and the staff UI needs it to decide what to show.
drop policy if exists hod_appointments_read on public.hod_appointments;
create policy hod_appointments_read on public.hod_appointments
  for select to authenticated using (true);

-- A department admin appoints and ends the headship of their own department
-- only; super_admin faculty-wide.
drop policy if exists hod_appointments_dept_admin_write on public.hod_appointments;
create policy hod_appointments_dept_admin_write on public.hod_appointments
  for all to authenticated
  using      (get_my_role() = 'dept_admin' and get_my_department() = department)
  with check (get_my_role() = 'dept_admin' and get_my_department() = department);

drop policy if exists hod_appointments_super_admin_write on public.hod_appointments;
create policy hod_appointments_super_admin_write on public.hod_appointments
  for all to authenticated
  using      (get_my_role() = 'super_admin')
  with check (get_my_role() = 'super_admin');

revoke execute on function public.my_lecturer_id()          from public;
revoke execute on function public.is_active_hod_of(text)    from public;
revoke execute on function public.my_hod_department()       from public;
grant  execute on function public.my_lecturer_id()          to authenticated;
grant  execute on function public.is_active_hod_of(text)    to authenticated;
grant  execute on function public.my_hod_department()       to authenticated;

-- Sitting heads as printed in the Faculty Handbook 2026. assigned_by is
-- NULL: these are seeded from the handbook, not appointed through the UI.
insert into public.hod_appointments (lecturer_id, department, notes)
select l.id, l.department, 'Seeded from Faculty Handbook 2026'
  from public.lecturers l
 where l.email in (
   'praweenmadusanka@sjp.ac.lk',  -- Civil Engineering
   'udayaw@sjp.ac.lk',            -- Computer Engineering
   'uditha@sjp.ac.lk',            -- Electrical and Electronic Engineering
   'makavita@sjp.ac.lk',          -- Mechanical Engineering
   'shyamkularathna@sjp.ac.lk'    -- Interdisciplinary Studies
 )
on conflict do nothing;
