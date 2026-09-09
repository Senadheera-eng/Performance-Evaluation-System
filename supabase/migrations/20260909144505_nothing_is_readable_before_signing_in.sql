-- nothing_is_readable_before_signing_in
-- Applied 20260909144505
-- Exported from the live project; do not edit by hand.

-- Nothing is readable before signing in.
--
-- Supabase grants every table to anon and authenticated and leaves RLS as the
-- only gate, so a policy written `TO public USING (true)` is a policy that
-- publishes the table. Three were: the course catalogue, and the course and
-- question lists of every feedback round. A stranger with the API key out of
-- the frontend bundle could read all three.
--
-- Most other tables currently refuse anon only because their policies call
-- get_my_role(), and anon lost EXECUTE on that in the previous migration. That
-- is a real refusal but an accidental one -- it fails closed by erroring
-- rather than by deciding. Saying `TO authenticated` makes the intent the
-- mechanism.
--
-- Nothing here changes what a signed-in user can see.

alter policy courses_public_read on public.courses to authenticated;
alter policy fpc_read on public.feedback_period_courses to authenticated;
alter policy fpq_read on public.feedback_period_questions to authenticated;

-- Two policies saying the same thing, both published. One is enough, and it
-- should not be public either.
drop policy if exists "Anyone can view timetables" on public.timetables;
alter policy timetables_public_read on public.timetables to authenticated;

/* ------------------------------------------------------------------ */
/* A row about a student should name that student                      */
/* ------------------------------------------------------------------ */

-- The legacy table's insert policy read:
--   (is_anonymous = false AND student_id = auth.uid()) OR is_anonymous = true
-- The second branch has no condition at all, so anybody signed in could write
-- a row carrying any student_id, any lecturer_id and any rating, as long as
-- they set the anonymous flag. Anonymity is about who is shown the author,
-- not about who may claim to be one.
drop policy if exists feedback_student_insert on public.feedback;
create policy feedback_student_insert on public.feedback
  for insert to authenticated
  with check (student_id = auth.uid());

drop policy if exists "Students submit feedback" on public.feedback;

/* ------------------------------------------------------------------ */
/* Two policies for one rule                                           */
/* ------------------------------------------------------------------ */

-- attendance and enrollments each carried a second, older student-read policy
-- that resolved the student by email:
--   student_id = (select id from students where email = auth.email())
-- Every student's id is already their auth user id -- checked across all 167
-- rows -- so this selects exactly the same rows as the auth.uid() policy
-- beside it, having first run a correlated lookup into students to do it.
-- Policies are OR'd, so the pair also meant the cheap one could never be the
-- only thing evaluated.
drop policy if exists "Students view own attendance" on public.attendance;
drop policy if exists "Students view own enrollments" on public.enrollments;

/* ------------------------------------------------------------------ */
/* anon writes nothing, anywhere                                       */
/* ------------------------------------------------------------------ */

-- Self-registration was removed long ago and every write path in the system
-- runs either as a signed-in user or inside a security definer function. An
-- anonymous caller has no legitimate write, so it should not hold the grant
-- and depend on a policy to stop it.
revoke insert, update, delete, truncate on all tables in schema public from anon;
alter default privileges in schema public
  revoke insert, update, delete on tables from anon;
