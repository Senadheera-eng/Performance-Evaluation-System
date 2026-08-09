-- rebuild_course_lecturers_offering_scoped
-- Applied 20260808104506
-- Exported from the live project; do not edit by hand.

-- course_lecturers moves from (course_id, lecturer_id, academic_year) to an
-- offering-scoped assignment. The old shape keyed teaching to the catalogue
-- course plus a free-text year, which could not express "this batch's
-- delivery" and had no coordinator, audit trail or end date.
--
-- The table was empty and referenced by nothing in the application, so this
-- is a clean replacement rather than a migration of live data.
drop table if exists public.course_lecturers;

create table public.course_lecturers (
  id              uuid primary key default gen_random_uuid(),
  offering_id     uuid not null references public.course_offerings(id) on delete cascade,
  lecturer_id     uuid not null references public.lecturers(id) on delete cascade,
  assignment_role text not null default 'lecturer'
                  check (assignment_role in ('lecturer', 'coordinator')),
  is_active       boolean not null default true,
  assigned_by     uuid references auth.users(id) on delete set null,
  assigned_at     timestamptz not null default now(),
  ended_by        uuid references auth.users(id) on delete set null,
  ended_at        timestamptz,
  constraint course_lecturers_active_consistency check (
    (is_active and ended_at is null) or (not is_active)
  )
);

-- A lecturer appears at most once on an offering while the assignment is
-- live; ended assignments accumulate as history.
create unique index course_lecturers_one_active_per_pair
  on public.course_lecturers (offering_id, lecturer_id) where is_active;

-- At most one course coordinator per offering.
create unique index course_lecturers_one_active_coordinator
  on public.course_lecturers (offering_id)
  where is_active and assignment_role = 'coordinator';

create index course_lecturers_lecturer_idx on public.course_lecturers (lecturer_id) where is_active;
create index course_lecturers_offering_idx on public.course_lecturers (offering_id) where is_active;

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------

/** Owning department of an offering. SECURITY DEFINER so policies that call
 *  it are not themselves filtered by the policies on course_offerings. */
create or replace function public.offering_department(p_offering_id uuid)
returns text
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_department text;
begin
  select department into v_department
    from public.course_offerings where id = p_offering_id;
  return v_department;
end;
$$;

/** True when the caller is a lecturer with a live assignment to this
 *  offering. The single gate for every lecturer-scoped capability —
 *  roster, attendance, marks and feedback all resolve through this. */
create or replace function public.is_assigned_lecturer(p_offering_id uuid)
returns boolean
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_lecturer uuid;
begin
  v_lecturer := public.my_lecturer_id();
  if v_lecturer is null or p_offering_id is null then
    return false;
  end if;
  return exists (
    select 1 from public.course_lecturers
     where offering_id = p_offering_id
       and lecturer_id = v_lecturer
       and is_active
  );
end;
$$;

/** Every offering the caller currently teaches. Used by dashboards and by
 *  policies that need set membership rather than a single-offering check. */
create or replace function public.my_offering_ids()
returns setof uuid
language sql
stable security definer
set search_path to 'public'
as $$
  select cl.offering_id
    from public.course_lecturers cl
   where cl.lecturer_id = public.my_lecturer_id()
     and cl.is_active;
$$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.course_lecturers enable row level security;

-- Who teaches an offering is public within the faculty: the student feedback
-- form renders one section per assigned lecturer and has to read this.
drop policy if exists course_lecturers_read on public.course_lecturers;
create policy course_lecturers_read on public.course_lecturers
  for select to authenticated using (true);

-- Assigning teaching staff is the HOD's job, per the target role model.
drop policy if exists course_lecturers_hod_write on public.course_lecturers;
create policy course_lecturers_hod_write on public.course_lecturers
  for all to authenticated
  using      (is_active_hod_of(offering_department(offering_id)))
  with check (is_active_hod_of(offering_department(offering_id)));

-- Department admins retain it too, so a department is never blocked while
-- its headship is vacant or being handed over.
drop policy if exists course_lecturers_dept_admin_write on public.course_lecturers;
create policy course_lecturers_dept_admin_write on public.course_lecturers
  for all to authenticated
  using      (get_my_role() = 'dept_admin'
              and get_my_department() = offering_department(offering_id))
  with check (get_my_role() = 'dept_admin'
              and get_my_department() = offering_department(offering_id));

drop policy if exists course_lecturers_super_admin_write on public.course_lecturers;
create policy course_lecturers_super_admin_write on public.course_lecturers
  for all to authenticated
  using      (get_my_role() = 'super_admin')
  with check (get_my_role() = 'super_admin');

revoke execute on function public.offering_department(uuid) from public;
revoke execute on function public.is_assigned_lecturer(uuid) from public;
revoke execute on function public.my_offering_ids()          from public;
grant  execute on function public.offering_department(uuid)  to authenticated;
grant  execute on function public.is_assigned_lecturer(uuid) to authenticated;
grant  execute on function public.my_offering_ids()          to authenticated;
