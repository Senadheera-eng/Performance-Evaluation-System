/*
  Feedback analytics were withheld until five students had answered.

  The number was always configurable — feedback_privacy_threshold() reads
  feedback_min_responses_for_analytics from system_settings — so lowering it
  to 1 is the whole change, and it can be raised again for the real rollout
  without touching code.

  Except in one place, which is the reason this is a migration and not a
  single UPDATE. get_admin_question_feedback_analytics had the number written
  into it as "HAVING count(*) >= 5", so the per-question breakdown would have
  gone on hiding itself no matter what the setting said. Every other reader
  calls the function; this one now does too.

  Worth recording why the gate exists, since it is being opened: the point
  was never the statistics, it was that feedback is anonymous. With a
  threshold of one, a course with a single respondent tells whoever is
  looking exactly who wrote the comment. That is a fine trade while the
  system is being developed and tested with one or two students; it is worth
  putting back before a real cohort is asked to answer honestly.
*/

create or replace function public.get_admin_question_feedback_analytics(
  p_period_id uuid,
  p_course_id uuid default null
)
returns table(
  question_id uuid,
  question_text text,
  category text,
  response_count integer,
  avg_rating numeric,
  count_1 integer,
  count_2 integer,
  count_3 integer,
  count_4 integer,
  count_5 integer,
  pct_positive numeric,
  pct_neutral numeric,
  pct_negative numeric
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role      text := get_my_role();
  v_dept      text := get_my_department();
  v_threshold int  := public.feedback_privacy_threshold();
begin
  if v_role not in ('dept_admin','super_admin') then
    raise exception 'Access denied: admin role required';
  end if;

  /* Scoped to a single course, that course must clear the minimum response
     threshold — whatever the faculty has currently set it to. The unscoped
     period-wide view aggregates across many courses and is not subject to
     the same single-course deanonymisation risk, so it is not gated. */
  if p_course_id is not null and not exists (
    select 1 from feedback_submissions fs
      join courses c on c.id = fs.course_id
     where fs.feedback_period_id = p_period_id
       and fs.course_id = p_course_id
       and fs.status = 'submitted'
       and (v_role = 'super_admin' or c.department = v_dept)
     group by fs.course_id
    having count(*) >= v_threshold
  ) then
    return;
  end if;

  return query
  select fq.id, fq.question_text, fq.category,
    count(fa.id)::int,
    round(avg(fa.rating_value), 2),
    count(*) filter (where fa.rating_value = 1)::int,
    count(*) filter (where fa.rating_value = 2)::int,
    count(*) filter (where fa.rating_value = 3)::int,
    count(*) filter (where fa.rating_value = 4)::int,
    count(*) filter (where fa.rating_value = 5)::int,
    round(count(*) filter (where fa.rating_value >= 4)::numeric / nullif(count(fa.id), 0) * 100, 1),
    round(count(*) filter (where fa.rating_value = 3)::numeric / nullif(count(fa.id), 0) * 100, 1),
    round(count(*) filter (where fa.rating_value <= 2)::numeric / nullif(count(fa.id), 0) * 100, 1)
  from feedback_period_questions fpq
  join feedback_questions fq on fq.id = fpq.question_id and fq.question_type = 'rating'
  join feedback_answers fa on fa.question_id = fq.id
  join feedback_submissions fs on fs.id = fa.submission_id and fs.status = 'submitted'
  join courses c on c.id = fs.course_id
  where fpq.feedback_period_id = p_period_id
    and (v_role = 'super_admin' or c.department = v_dept)
    and (p_course_id is null or fs.course_id = p_course_id)
  group by fq.id, fq.question_text, fq.category, fpq.display_order
  order by fpq.display_order;
end;
$function$;

/* One response is now enough. Raise this before the faculty rollout. */
update public.system_settings
   set value = to_jsonb(1)
 where key = 'feedback_min_responses_for_analytics';