-- A lecturer's feedback, listed by the round it belongs to.
--
-- The page this feeds is being turned round: a round first (Semester 5
-- Feedback, Batch 7, closes 19 Oct), then the courses of that round this
-- lecturer teaches, then one course's report. That needs the round's own
-- facts — when it opened, when it closes, which semester and batch it is
-- for, its academic year — which this function had no column for, so the
-- page could only ever show the course's semester and batch.
--
-- The distinction matters: a round is set by the department and may cover a
-- semester the batch has already finished (a Semester 6 round for a batch
-- now in Semester 7 is normal and correct). The round's own semester and
-- batch are therefore returned separately from the course's.
--
-- Nothing else changes: the same lecturer scope (only offerings they are
-- assigned to), the same privacy threshold before any result is shown, the
-- same rule that a rating average counts only course-wide questions and the
-- ones asked about this lecturer.
drop function if exists public.get_my_feedback_overview();
create function public.get_my_feedback_overview()
returns table (
  period_id uuid, period_title text, period_status text, feedback_type text,
  period_semester integer, period_batch_year integer, period_academic_year text,
  opens_at timestamptz, closes_at timestamptz,
  offering_id uuid, course_id uuid, course_code text, course_title text,
  semester integer, batch_year integer,
  eligible_count integer, response_count integer, response_rate numeric,
  results_visible boolean, below_threshold boolean, avg_rating numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_lecturer  uuid;
  v_threshold int;
begin
  v_lecturer := public.my_lecturer_id();
  if v_lecturer is null then
    return;
  end if;
  v_threshold := public.feedback_privacy_threshold();

  return query
  with mine as (
    select cl.offering_id, o.course_id, o.batch_year, o.department, c.course_code,
           c.title as course_title, c.semester
      from public.course_lecturers cl
      join public.course_offerings o on o.id = cl.offering_id
      join public.courses c          on c.id = o.course_id
     where cl.lecturer_id = v_lecturer and cl.is_active
  ),
  pairs as (
    select p.id as period_id, p.title, p.status, p.feedback_type,
           p.semester as period_semester, p.batch_year as period_batch_year,
           p.academic_year as period_academic_year, p.opens_at, p.closes_at,
           m.*
      from mine m
      join public.feedback_period_courses fpc on fpc.course_id = m.course_id
      join public.feedback_periods p          on p.id = fpc.feedback_period_id
     where p.batch_year is null or p.batch_year = m.batch_year
  ),
  counted as (
    select pr.*,
           (select count(*)::int from public.students s
             where s.role = 'student' and s.status = 'active'
               and s.batch_year = pr.batch_year
               and public.student_took_course(s.id, pr.course_id)) as eligible,
           (select count(*)::int from public.feedback_submissions fs
             where fs.feedback_period_id = pr.period_id
               and fs.course_id = pr.course_id
               and fs.status = 'submitted')                         as responses
      from pairs pr
  )
  select c.period_id, c.title, c.status, c.feedback_type,
         c.period_semester, c.period_batch_year, c.period_academic_year,
         c.opens_at, c.closes_at,
         c.offering_id, c.course_id, c.course_code, c.course_title,
         c.semester, c.batch_year,
         c.eligible, c.responses,
         case when c.eligible > 0
              then round((c.responses::numeric / c.eligible) * 100, 1) else 0 end,
         -- Answering has begun, and enough people have answered to hide
         -- behind each other.
         c.status in ('open', 'closed', 'archived') and c.responses >= v_threshold,
         c.responses < v_threshold,
         -- Response progress is never withheld: knowing how many people
         -- replied identifies nobody, and a lecturer watching the count come
         -- in is the whole reason to show results live.
         case
           when c.status in ('open', 'closed', 'archived')
                and c.responses >= v_threshold
           then (select round(avg(fa.rating_value)::numeric, 2)
                   from public.feedback_answers fa
                   join public.feedback_submissions fs on fs.id = fa.submission_id
                  where fs.feedback_period_id = c.period_id
                    and fs.course_id = c.course_id
                    and fs.status = 'submitted'
                    and fa.rating_value is not null
                    and (fa.lecturer_target_id is null
                         or fa.lecturer_target_id = v_lecturer))
           else null
         end
    from counted c
   order by c.closes_at desc nulls last, c.semester desc, c.course_code;
end;
$$;
revoke all on function public.get_my_feedback_overview() from public, anon;
grant execute on function public.get_my_feedback_overview() to authenticated;