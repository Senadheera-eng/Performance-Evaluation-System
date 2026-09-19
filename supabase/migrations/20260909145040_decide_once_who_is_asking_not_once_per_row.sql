-- decide_once_who_is_asking_not_once_per_row
-- Applied 20260909145040
-- Exported from the live project; do not edit by hand.

-- Decide once who is asking, not once per row.
--
-- A department admin counting results took just over a second and touched
-- 96,768 buffers to return 1,228 rows. The policy was doing this for each of
-- the 7,392 rows it examined: call get_my_role(), which reads two tables;
-- call get_my_department(); and run a correlated index scan into courses to
-- find that row's department. Around thirty thousand lookups for one count.
--
-- Two changes, and neither alters who can see what.
--
-- Wrapping a caller-scoped STABLE function in a scalar subselect lets the
-- planner hoist it into an InitPlan and run it once for the statement rather
-- than once per row. Which role I am does not depend on the row being
-- examined, so it has no business being asked about the row.
--
-- And "this row's course is in my department" becomes a single hashed set of
-- the department's course ids, probed per row, instead of a correlated index
-- scan per row. Same rows, one scan instead of thousands.

/* ---------------- results ---------------- */

drop policy if exists results_super_admin_all on public.results;
create policy results_super_admin_all on public.results
  for all to authenticated
  using ((select public.get_my_role()) = 'super_admin')
  with check ((select public.get_my_role()) = 'super_admin');

drop policy if exists results_dept_admin_own_courses on public.results;
create policy results_dept_admin_own_courses on public.results
  for all to authenticated
  using (
    (select public.get_my_role()) = 'dept_admin'
    and course_id in (select c.id from public.courses c
                       where c.department = (select public.get_my_department())))
  with check (
    (select public.get_my_role()) = 'dept_admin'
    and course_id in (select c.id from public.courses c
                       where c.department = (select public.get_my_department())));

/* ---------------- enrollments ---------------- */

drop policy if exists enrollments_super_admin_all on public.enrollments;
create policy enrollments_super_admin_all on public.enrollments
  for all to authenticated
  using ((select public.get_my_role()) = 'super_admin')
  with check ((select public.get_my_role()) = 'super_admin');

drop policy if exists enrollments_dept_admin_own_courses on public.enrollments;
create policy enrollments_dept_admin_own_courses on public.enrollments
  for all to authenticated
  using (
    (select public.get_my_role()) = 'dept_admin'
    and course_id in (select c.id from public.courses c
                       where c.department = (select public.get_my_department())))
  with check (
    (select public.get_my_role()) = 'dept_admin'
    and course_id in (select c.id from public.courses c
                       where c.department = (select public.get_my_department())));

drop policy if exists enrollments_student_read on public.enrollments;
create policy enrollments_student_read on public.enrollments
  for select to authenticated
  using (student_id = (select auth.uid()));

/* ---------------- attendance ---------------- */

drop policy if exists attendance_super_admin_all on public.attendance;
create policy attendance_super_admin_all on public.attendance
  for all to authenticated
  using ((select public.get_my_role()) = 'super_admin')
  with check ((select public.get_my_role()) = 'super_admin');

drop policy if exists attendance_dept_admin_own_courses on public.attendance;
create policy attendance_dept_admin_own_courses on public.attendance
  for all to authenticated
  using (
    (select public.get_my_role()) = 'dept_admin'
    and course_id in (select c.id from public.courses c
                       where c.department = (select public.get_my_department())))
  with check (
    (select public.get_my_role()) = 'dept_admin'
    and course_id in (select c.id from public.courses c
                       where c.department = (select public.get_my_department())));

drop policy if exists attendance_student_read on public.attendance;
create policy attendance_student_read on public.attendance
  for select to authenticated
  using (student_id = (select auth.uid()));

/* ---------------- indexes ---------------- */

-- attendance carried the same three columns indexed twice. One of the two
-- backs the unique constraint and has to stay; the other is a free-standing
-- copy that only ever cost writes.
drop index if exists public.attendance_student_course_date_key;

-- Every course-scoped read -- a roster, a feedback report, the analytics --
-- filters these two by course, and neither had an index to do it with.
create index if not exists results_course_idx on public.results (course_id);
create index if not exists enrollments_course_idx on public.enrollments (course_id);

analyze public.results;
analyze public.enrollments;
analyze public.attendance;
