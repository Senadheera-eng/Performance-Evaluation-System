-- complete_ese_hiding_drop_student_policies_on_results
-- Applied 20260808162644
-- Exported from the live project; do not edit by hand.

-- Final step of hiding the End-Semester Examination mark from students.
--
-- The view alone was not enough: while these policies existed, a student
-- could still query `results` directly through the REST API and read
-- ese_mark, whatever the UI showed them. Removing them leaves students with
-- no policy on the table at all — RLS denies by default — so
-- `my_published_results` becomes their only path to their own results, and
-- that view does not expose ese_mark or oa_mark.
--
-- Deliberately sequenced after the frontend shipped: every student page now
-- reads the view (commit 1f0aa90c, live in production), so nothing loses
-- access as these go.
--
-- Unaffected: the SECURITY DEFINER RPCs the AI assistant and dashboards use
-- (get_student_results, get_student_course_result, get_academic_standing,
-- calculate_gpa_target) bypass RLS by definition, and each already returns
-- grade/GPV only. Staff and admin policies are untouched.

-- The auth.uid() policy added when the schema moved off email matching.
drop policy if exists results_student_read on public.results;

-- Its predecessor, which matched on auth.email(). Left in place through
-- several migrations; it grants the same access and has to go too.
drop policy if exists "Students view own published results" on public.results;

-- Attendance keeps both of its student policies: attendance rows carry no
-- column a student may not see, so there is nothing to hide there and the
-- direct table read stays the simplest correct path.

comment on view public.my_published_results is
  'The calling student''s own published results, without ese_mark or oa_mark. '
  'Runs as owner and self-scopes on auth.uid(). Since the student SELECT '
  'policies were dropped from `results`, this is the ONLY way a student can '
  'read their results — which is what makes the ESE rule enforceable rather '
  'than merely a UI convention.';
