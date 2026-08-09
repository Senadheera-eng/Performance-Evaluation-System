-- lecturer_created_feedback_periods_with_approval
-- Applied 20260808204634
-- Exported from the live project; do not edit by hand.

-- Lecturers may raise their own feedback form for a course they teach, but
-- it does not go live on their say-so: a department admin approves it first.
-- Otherwise a lecturer could put questions in front of students that the
-- department never saw, on a course it is accountable for.

-- created_by pointed at `admins`, which a lecturer is not in. It has always
-- held an auth user id (admins.id is itself an auth.users FK), so repointing
-- it loses nothing and lets a lecturer own a row.
alter table public.feedback_periods drop constraint if exists feedback_periods_created_by_fkey;
alter table public.feedback_periods
  add constraint feedback_periods_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;
alter table public.feedback_periods alter column created_by drop not null;

alter table public.feedback_periods
  add column if not exists created_by_lecturer_id uuid references public.lecturers(id) on delete set null,
  add column if not exists approval_status text not null default 'not_required',
  add column if not exists approved_by     uuid references auth.users(id) on delete set null,
  add column if not exists approved_at     timestamptz,
  add column if not exists approval_notes  text;

alter table public.feedback_periods drop constraint if exists feedback_periods_approval_status_check;
alter table public.feedback_periods
  add constraint feedback_periods_approval_status_check
  check (approval_status in ('not_required', 'pending', 'approved', 'rejected'));

create index if not exists feedback_periods_approval_idx
  on public.feedback_periods (approval_status) where approval_status = 'pending';

-- The gate itself. Enforced on the row rather than in the approve/open RPCs
-- so there is no path — policy, RPC or direct update — that opens an
-- unapproved period to students.
create or replace function public.enforce_feedback_period_approval()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status in ('scheduled', 'open')
     and new.approval_status not in ('not_required', 'approved') then
    raise exception
      'This feedback period was created by a lecturer and needs department approval before it can open';
  end if;
  return new;
end;
$$;

drop trigger if exists feedback_periods_approval_guard on public.feedback_periods;
create trigger feedback_periods_approval_guard
  before insert or update on public.feedback_periods
  for each row execute function public.enforce_feedback_period_approval();

revoke execute on function public.enforce_feedback_period_approval() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- What a lecturer may do with periods
-- ---------------------------------------------------------------------
-- Create a draft for their own department, owned by them and marked pending.
drop policy if exists fp_lecturer_create on public.feedback_periods;
create policy fp_lecturer_create on public.feedback_periods
  for insert to authenticated
  with check (
    created_by_lecturer_id is not null
    and created_by_lecturer_id = my_lecturer_id()
    and approval_status = 'pending'
    and status = 'draft'
    and department = (select l.department from public.lecturers l where l.id = my_lecturer_id())
  );

-- Read and edit their own, while it is still theirs to edit.
drop policy if exists fp_lecturer_read_own on public.feedback_periods;
create policy fp_lecturer_read_own on public.feedback_periods
  for select to authenticated
  using (created_by_lecturer_id is not null and created_by_lecturer_id = my_lecturer_id());

drop policy if exists fp_lecturer_update_own on public.feedback_periods;
create policy fp_lecturer_update_own on public.feedback_periods
  for update to authenticated
  using      (created_by_lecturer_id = my_lecturer_id()
              and approval_status in ('pending', 'rejected') and status = 'draft')
  with check (created_by_lecturer_id = my_lecturer_id()
              and approval_status in ('pending', 'rejected') and status = 'draft');

-- Attach courses — but only ones they actually teach. This is the scoping
-- the requirement calls for: teaching CO4204 does not entitle anyone to
-- raise a form about CO4203.
drop policy if exists fpc_lecturer_manage on public.feedback_period_courses;
create policy fpc_lecturer_manage on public.feedback_period_courses
  for all to authenticated
  using (
    exists (
      select 1 from public.feedback_periods p
       where p.id = feedback_period_courses.feedback_period_id
         and p.created_by_lecturer_id = my_lecturer_id()
         and p.status = 'draft'
    )
    and exists (
      select 1 from public.course_lecturers cl
        join public.course_offerings o on o.id = cl.offering_id
       where cl.lecturer_id = my_lecturer_id() and cl.is_active
         and o.course_id = feedback_period_courses.course_id
    )
  )
  with check (
    exists (
      select 1 from public.feedback_periods p
       where p.id = feedback_period_courses.feedback_period_id
         and p.created_by_lecturer_id = my_lecturer_id()
         and p.status = 'draft'
    )
    and exists (
      select 1 from public.course_lecturers cl
        join public.course_offerings o on o.id = cl.offering_id
       where cl.lecturer_id = my_lecturer_id() and cl.is_active
         and o.course_id = feedback_period_courses.course_id
    )
  );

drop policy if exists fpq_lecturer_manage on public.feedback_period_questions;
create policy fpq_lecturer_manage on public.feedback_period_questions
  for all to authenticated
  using (exists (
    select 1 from public.feedback_periods p
     where p.id = feedback_period_questions.feedback_period_id
       and p.created_by_lecturer_id = my_lecturer_id()
       and p.status = 'draft'))
  with check (exists (
    select 1 from public.feedback_periods p
     where p.id = feedback_period_questions.feedback_period_id
       and p.created_by_lecturer_id = my_lecturer_id()
       and p.status = 'draft'));

-- ---------------------------------------------------------------------
-- Approval
-- ---------------------------------------------------------------------
/** Requests pending a department admin's decision. */
create or replace function public.get_pending_feedback_approvals()
returns table (
  period_id      uuid,
  title          text,
  department     text,
  semester       integer,
  batch_year     integer,
  academic_year  text,
  feedback_type  text,
  opens_at       timestamptz,
  closes_at      timestamptz,
  requested_by   text,
  course_count   integer,
  question_count integer,
  courses        jsonb
)
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_department text;
  v_is_super   boolean;
begin
  v_is_super := coalesce(public.get_my_role(), '') = 'super_admin';
  v_department := public.get_my_department();
  if not v_is_super and coalesce(public.get_my_role(),'') <> 'dept_admin' then
    raise exception 'Only a department admin can review feedback form requests';
  end if;

  return query
  select p.id, p.title, p.department, p.semester, p.batch_year, p.academic_year,
         p.feedback_type, p.opens_at, p.closes_at,
         coalesce(l.title || ' ', '') || l.name,
         (select count(*)::int from public.feedback_period_courses fpc where fpc.feedback_period_id = p.id),
         (select count(*)::int from public.feedback_period_questions fpq where fpq.feedback_period_id = p.id),
         coalesce((select jsonb_agg(jsonb_build_object('course_code', c.course_code, 'title', c.title))
                     from public.feedback_period_courses fpc
                     join public.courses c on c.id = fpc.course_id
                    where fpc.feedback_period_id = p.id), '[]'::jsonb)
    from public.feedback_periods p
    join public.lecturers l on l.id = p.created_by_lecturer_id
   where p.approval_status = 'pending'
     and (v_is_super or p.department = v_department)
   order by p.created_at;
end;
$$;

create or replace function public.decide_feedback_period(
  p_period_id uuid,
  p_approve boolean,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_department text;
  v_courses int;
  v_questions int;
begin
  select department into v_department from public.feedback_periods where id = p_period_id;
  if v_department is null then
    raise exception 'Feedback period not found';
  end if;
  if not (coalesce(public.get_my_role(),'') = 'super_admin'
          or (coalesce(public.get_my_role(),'') = 'dept_admin'
              and public.get_my_department() = v_department)) then
    raise exception 'Only the department admin can approve feedback forms';
  end if;

  if p_approve then
    select count(*) into v_courses   from public.feedback_period_courses   where feedback_period_id = p_period_id;
    select count(*) into v_questions from public.feedback_period_questions where feedback_period_id = p_period_id;
    if v_courses = 0 or v_questions = 0 then
      raise exception 'This form has no % yet, so there is nothing to approve',
        case when v_courses = 0 then 'courses' else 'questions' end;
    end if;
  end if;

  update public.feedback_periods
     set approval_status = case when p_approve then 'approved' else 'rejected' end,
         approved_by     = auth.uid(),
         approved_at     = now(),
         approval_notes  = p_notes
   where id = p_period_id;

  return jsonb_build_object('ok', true,
    'message', case when p_approve
      then 'Approved. The lecturer can now open this feedback period.'
      else 'Rejected. The lecturer can revise it and ask again.' end);
end;
$$;

revoke execute on function public.get_pending_feedback_approvals()            from public, anon;
revoke execute on function public.decide_feedback_period(uuid, boolean, text) from public, anon;
grant  execute on function public.get_pending_feedback_approvals()            to authenticated;
grant  execute on function public.decide_feedback_period(uuid, boolean, text) to authenticated;

-- Existing periods were all made by department admins and need no approval.
update public.feedback_periods
   set approval_status = 'not_required'
 where created_by_lecturer_id is null and approval_status <> 'not_required';
