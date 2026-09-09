-- pin_the_search_path_and_bar_the_results_view
-- Applied 20260909143444
-- Exported from the live project; do not edit by hand.

-- Pin the search path, and bar the results view.
--
-- Two small hardenings that change no behaviour.
--
-- The three attendance helpers run as the caller rather than as the owner, so
-- a hijacked search_path could not escalate anything -- but they are called
-- from inside functions that DO run as the owner, and a helper that resolves
-- its own operators differently depending on who called it is a latent
-- correctness problem as much as a security one. Pinning costs nothing.
--
-- my_published_results stays security definer on purpose: an earlier
-- migration dropped students' direct read of results so that ese_mark could
-- be withheld, and this view is the controlled window they read through
-- instead. Making it security invoker would apply that same RLS and show a
-- student nothing. What it lacked was security_barrier -- without it the
-- planner may run a cheap caller-supplied predicate before the view's own
-- student_id filter, which is the classic way a view leaks the rows it was
-- meant to hide.

alter function public.metres_between(double precision, double precision,
                                     double precision, double precision)
  set search_path to 'public';
alter function public.attendance_window_signature(uuid, bytea, bigint)
  set search_path to 'public';
alter function public.attendance_window_code(uuid, bytea, bigint)
  set search_path to 'public';

alter view public.my_published_results set (security_barrier = true);
