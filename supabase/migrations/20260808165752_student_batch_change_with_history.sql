-- student_batch_change_with_history
-- Applied 20260808165752
-- Exported from the live project; do not edit by hand.

-- Moving a student between batches — normally because a year GPA below 2.00
-- means repeating an academic year, sometimes at the student's own request.
--
-- The batch is not just a label: academic_year on results and enrollments is
-- derived from batch_year + the course's study year, and course offerings are
-- keyed on it. So this is a real academic action with consequences, and
-- overwriting the column with no trace of who changed it, when, or on whose
-- authority is not acceptable for a record students' degrees depend on.

create table if not exists public.student_batch_changes (
  id              uuid primary key default gen_random_uuid(),
  student_id      uuid not null references public.students(id) on delete cascade,
  from_batch_year integer not null,
  to_batch_year   integer not null,
  reason          text,
  /** Faculty Board / Senate decision reference, where one exists. */
  reference       text,
  changed_by      uuid references auth.users(id) on delete set null,
  changed_at      timestamptz not null default now(),
  constraint student_batch_changes_actually_changed
    check (from_batch_year <> to_batch_year)
);

create index if not exists student_batch_changes_student_idx
  on public.student_batch_changes (student_id, changed_at desc);

alter table public.student_batch_changes enable row level security;

-- Readable by whoever may administer the student, and by the student
-- themselves: it is their own record and they are entitled to see that it
-- was changed, by whom and why.
drop policy if exists student_batch_changes_read on public.student_batch_changes;
create policy student_batch_changes_read on public.student_batch_changes
  for select to authenticated
  using (student_id = auth.uid() or can_view_student_record(student_id));

-- No direct writes at all: the history row and the batch_year update have to
-- happen together, which is what change_student_batch() guarantees.
-- SECURITY DEFINER there bypasses this, by design.

-- ---------------------------------------------------------------------
-- The batch column cannot be changed except through that function
-- ---------------------------------------------------------------------
-- Without this, a department admin could simply UPDATE students SET
-- batch_year — their RLS policy on `students` is ALL — and no history row
-- would exist. The audit trail is only worth having if it cannot be skipped.
create or replace function public.enforce_batch_change_through_rpc()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.batch_year is distinct from old.batch_year
     and coalesce(current_setting('pes.batch_change', true), '') <> 'on' then
    raise exception
      'A student''s batch must be changed through change_student_batch(), which records who changed it and why';
  end if;
  return new;
end;
$$;

drop trigger if exists students_batch_change_guard on public.students;
create trigger students_batch_change_guard
  before update on public.students
  for each row execute function public.enforce_batch_change_through_rpc();

revoke execute on function public.enforce_batch_change_through_rpc() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- The one supported way to move a student
-- ---------------------------------------------------------------------
create or replace function public.change_student_batch(
  p_student_id uuid,
  p_to_batch_year integer,
  p_reason text default null,
  p_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_from    integer;
  v_name    text;
  v_role    text;
  v_dept    text;
  v_results int;
begin
  v_role := coalesce(public.get_my_role(), '');

  -- Super admin faculty-wide; department admin within their own department.
  -- Deliberately not the HOD: moving a student between batches is a
  -- registry action, not an academic-oversight one.
  if v_role = 'super_admin' then
    null;
  elsif v_role = 'dept_admin' then
    v_dept := public.get_my_department();
    if not public.department_owns_student(v_dept, p_student_id) then
      raise exception 'That student is not in your department';
    end if;
  else
    raise exception 'Only a department admin or super admin can change a student''s batch';
  end if;

  select batch_year, name into v_from, v_name
    from public.students where id = p_student_id;

  if v_from is null then
    raise exception 'Student not found, or has no batch recorded';
  end if;
  if v_from = p_to_batch_year then
    return jsonb_build_object('ok', false,
      'message', format('%s is already in the %s intake.', v_name, v_from));
  end if;
  if p_to_batch_year < 2015 or p_to_batch_year > extract(year from now())::int + 1 then
    raise exception 'Intake year % is outside the plausible range', p_to_batch_year;
  end if;

  insert into public.student_batch_changes
    (student_id, from_batch_year, to_batch_year, reason, reference, changed_by)
  values (p_student_id, v_from, p_to_batch_year, p_reason, p_reference, auth.uid());

  perform set_config('pes.batch_change', 'on', true);
  update public.students set batch_year = p_to_batch_year where id = p_student_id;
  perform set_config('pes.batch_change', 'off', true);

  -- Existing results keep the offering they were earned under: the student
  -- genuinely sat those examinations with their old cohort, and rewriting
  -- that would falsify the record. They will simply appear as a repeat
  -- candidate on those offerings from now on, which is what they are.
  select count(*) into v_results from public.results where student_id = p_student_id;

  return jsonb_build_object(
    'ok', true,
    'from_batch_year', v_from,
    'to_batch_year', p_to_batch_year,
    'historical_results_kept', v_results,
    'message', format(
      '%s moved from the %s intake to %s. %s existing result(s) stay under the %s cohort, where they were earned.',
      v_name, v_from, p_to_batch_year, v_results, v_from));
end;
$$;

/** A student's batch history, most recent first, with who made each change. */
create or replace function public.get_student_batch_history(p_student_id uuid)
returns table (
  id              uuid,
  from_batch_year integer,
  to_batch_year   integer,
  reason          text,
  reference       text,
  changed_at      timestamptz,
  changed_by_name text
)
language plpgsql
stable security definer
set search_path to 'public'
as $$
begin
  if not (p_student_id = auth.uid() or public.can_view_student_record(p_student_id)) then
    raise exception 'Not authorised to view this student''s batch history';
  end if;

  return query
  select b.id, b.from_batch_year, b.to_batch_year, b.reason, b.reference, b.changed_at,
         coalesce(a.name, l.name, 'Unknown')
    from public.student_batch_changes b
    left join public.admins    a on a.id = b.changed_by
    left join public.lecturers l on l.auth_user_id = b.changed_by
   where b.student_id = p_student_id
   order by b.changed_at desc;
end;
$$;

revoke execute on function public.change_student_batch(uuid, integer, text, text) from public, anon;
revoke execute on function public.get_student_batch_history(uuid)                 from public, anon;
grant  execute on function public.change_student_batch(uuid, integer, text, text) to authenticated;
grant  execute on function public.get_student_batch_history(uuid)                 to authenticated;
