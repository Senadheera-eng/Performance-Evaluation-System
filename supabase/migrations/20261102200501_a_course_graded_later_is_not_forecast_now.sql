-- A course graded in a later semester is not forecast in this one.
--
-- A course taught over two semesters is graded once, with its later part
-- (courses.graded_with points at that part): the Engineering Project's
-- Semester 7 part, CO4002, has no result of its own; its grade is given in
-- Semester 8. The first model still predicted that part for Semester 7. The
-- training script no longer does (ml/train.py skips a course graded with
-- another), and ml_forecast_for now leaves such a course out as well, so no
-- forecast shows a grade that is not given that semester.

create or replace function public.ml_forecast_for(p_student uuid)
 returns jsonb
 language sql
 stable
 security definer
 set search_path to 'public'
as $$
  with m as (
    select * from public.ml_models where is_active order by trained_at desc limit 1),
  p as (
    select gp.*, c.course_code, c.title, c.credits, c.category, c.contributes_to_gpa,
           coalesce(c.result_credits, c.credits) as gpa_credits
      from public.ml_grade_predictions gp
      join m on m.id = gp.model_id
      join public.courses c on c.id = gp.course_id
     where gp.student_id = p_student
       and c.graded_with is null
       and not exists (select 1 from public.results r
                        where r.student_id = p_student and r.course_id = gp.course_id)),
  enrolled as (
    select e.course_id from public.enrollments e
     where e.student_id = p_student and e.status = 'enrolled'
       and e.course_id in (select course_id from p)),
  chosen as (
    select * from p
     where case when exists (select 1 from enrolled)
                then course_id in (select course_id from enrolled)
                else category = 'Compulsory' end),
  k as (
    select round(1 - exp(sum(ln(greatest(1 - at_risk_probability, 0.0001)))), 3) as risk from chosen)
  select case when not exists (select 1 from chosen) then null else jsonb_build_object(
    'model', (select jsonb_build_object('name', name, 'algorithm', algorithm, 'trained_at', trained_at,
                                        'train_rows', train_rows, 'evaluation', metrics) from m),
    'semester', (select max(semester) from chosen),
    'basis', case when exists (select 1 from enrolled) then 'enrolled' else 'compulsory' end,
    'forecast_sgpa', (select round(sum(expected_gpv * gpa_credits) / nullif(sum(gpa_credits), 0), 2)
                        from chosen where contributes_to_gpa and gpa_credits > 0),
    'risk', (select risk from k),
    'level', (select case when risk >= 0.40 then 'high' when risk >= 0.25 then 'watch' else 'low' end from k),
    'reasons', (select reasons from chosen order by at_risk_probability desc, course_code limit 1),
    'courses', (select jsonb_agg(jsonb_build_object(
                  'course_id', course_id, 'course_code', course_code, 'title', title,
                  'credits', credits, 'counts_this_semester', contributes_to_gpa and gpa_credits > 0,
                  'band', predicted_band, 'probabilities', band_probabilities,
                  'expected_gpv', expected_gpv, 'at_risk', at_risk_probability,
                  'watch', at_risk_probability >= 0.10)
                  order by course_code) from chosen)) end;
$$;
revoke all on function public.ml_forecast_for(uuid) from public, anon, authenticated;
