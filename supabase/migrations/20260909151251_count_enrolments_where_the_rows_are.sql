-- Count enrolments where the rows are.
--
-- The course management page downloaded every enrolled row it was allowed to
-- see and tallied them in the browser, to end up with one number per course.
-- That is a few thousand rows over the wire to produce about forty-five
-- integers.
--
-- The slowness is the lesser problem. PostgREST caps how many rows a request
-- returns, so a department that crosses that cap would have had its counts
-- quietly truncated -- not an error, just numbers that are too low, on a page
-- whose whole purpose is to report them.
--
-- SECURITY INVOKER on purpose: the counts must be exactly what the caller is
-- allowed to see, so the existing row policies on enrollments do the scoping
-- rather than this function reimplementing it.

create or replace function public.get_course_enrolment_counts()
returns table(course_id uuid, enrolled integer)
language sql
stable
security invoker
set search_path to 'public'
as $$
  select e.course_id, count(*)::int
    from public.enrollments e
   where e.status = 'enrolled'
   group by e.course_id;
$$;

grant execute on function public.get_course_enrolment_counts() to authenticated;
