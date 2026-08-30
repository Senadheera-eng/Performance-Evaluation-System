-- the_overview_names_the_course_the_report_asks_for
-- Applied 20260829173806
-- Exported from the live project; do not edit by hand.

-- The overview names the course the report asks for.
--
-- The lecturer's list of courses identified each row by its offering, which
-- is right for counting students but is not what the report is keyed on: a
-- report is about a course in a round, and the offering is how the lecturer
-- happens to be attached to it. The page had the offering and needed the
-- course, so it either guessed or went back to the database for a lookup it
-- had already done. The list carries both now.

drop function if exists public.get_my_feedback_overview();

create function public.get_my_feedback_overview()
returns table(
  period_id uuid, period_title text, period_status text, feedback_type text,
  offering_id uuid, course_id uuid, course_code text, course_title text,
  semester integer, batch_year integer,
  eligible_count integer, response_count integer, response_rate numeric,
  results_visible boolean, below_threshold boolean, avg_rating numeric)
language plpgsql stable security definer set search_path to 'public'
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
    select p.id as period_id, p.title, p.status, p.feedback_type, m.*
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
  select c.period_id, c.title, c.status, c.feedback_type, c.offering_id,
         c.course_id, c.course_code, c.course_title, c.semester, c.batch_year,
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
   order by c.batch_year desc, c.semester desc, c.course_code;
end;
$$;

grant execute on function public.get_my_feedback_overview() to authenticated;

-- The old per-offering detail is replaced by the report.
drop function if exists public.get_my_feedback_detail(uuid, uuid);
