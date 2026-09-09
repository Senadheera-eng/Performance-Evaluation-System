-- ask_whether_i_am_a_lecturer_before_asking_about_every_row
-- Applied 20260909145158
-- Exported from the live project; do not edit by hand.

-- Ask whether I am a lecturer before asking about every row.
--
-- is_assigned_lecturer and is_active_hod_of both begin by giving up if the
-- caller is not a lecturer, which is the right instinct and, inside a policy,
-- happens too late: the give-up runs per row, and each one costs a lookup to
-- discover the same thing it discovered on the row before. Worse,
-- offering_department() is evaluated to build the argument for a call that
-- was always going to return false, so a department admin paid a read of
-- course_offerings for every result row in the table.
--
-- Whether I am a lecturer is a fact about me. Hoisting it into a scalar
-- subselect makes it an InitPlan, decided once, and when the answer is no the
-- row-dependent half is never reached at all.

drop policy if exists results_lecturer_read on public.results;
create policy results_lecturer_read on public.results
  for select to authenticated
  using (
    (select public.my_lecturer_id()) is not null
    and public.is_assigned_lecturer(offering_id));

drop policy if exists results_hod_read on public.results;
create policy results_hod_read on public.results
  for select to authenticated
  using (
    (select public.my_lecturer_id()) is not null
    and public.is_active_hod_of(public.offering_department(offering_id)));

drop policy if exists results_lecturer_insert on public.results;
create policy results_lecturer_insert on public.results
  for insert to authenticated
  with check (
    (select public.my_lecturer_id()) is not null
    and public.is_assigned_lecturer(offering_id)
    and status = 'draft');

drop policy if exists results_lecturer_update on public.results;
create policy results_lecturer_update on public.results
  for update to authenticated
  using (
    (select public.my_lecturer_id()) is not null
    and public.is_assigned_lecturer(offering_id)
    and status = 'draft')
  with check (
    (select public.my_lecturer_id()) is not null
    and public.is_assigned_lecturer(offering_id)
    and status = 'draft');
