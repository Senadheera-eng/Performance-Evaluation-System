-- Early-warning levels in the faculty's own terms, and a student's forecast
-- without the chance of an R or F.
--
-- Two adjustments after loading the first model's predictions:
--
-- 1. Thresholds from the faculty's own record. In past results 5% of course
--    grades were an R or F, and 22% of students got at least one in a
--    semester. A course now goes on a mentee's watch list at twice the usual
--    rate, a 10% chance (it was 15%, which left the courses of even the
--    likeliest mentee unlisted). Each forecast also carries a level: "high"
--    from a 40% chance of at least one R or F (about the top tenth of
--    students), "watch" from 25% (above the usual rate), otherwise "low".
--    ml_forecast_for sets both, so the mentor's list and a mentee's own page
--    agree.
--
-- 2. A student's own forecast leaves the R or F chance out in every form. The
--    band probabilities went too, because the other four add up to the fifth.
--    Each course says its likeliest band and how likely that is; a course
--    whose likeliest band is R/F says it needs attention instead.

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

create or replace function public.get_my_grade_forecast()
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $$
declare
  v jsonb;
begin
  if not exists (select 1 from public.students where id = auth.uid() and role = 'student') then
    return null;
  end if;
  v := public.ml_forecast_for(auth.uid());
  if v is null then return null; end if;
  return (v - 'risk' - 'level') || jsonb_build_object('courses',
    (select jsonb_agg(jsonb_build_object(
              'course_id', c->'course_id', 'course_code', c->'course_code', 'title', c->'title',
              'credits', c->'credits', 'counts_this_semester', c->'counts_this_semester',
              'needs_attention', c->>'band' = 'R/F',
              'band', case when c->>'band' = 'R/F' then null else c->'band' end,
              'chance', case when c->>'band' = 'R/F' then null else c->'probabilities'->(c->>'band') end)
            order by o)
       from jsonb_array_elements(v->'courses') with ordinality as x(c, o)));
end;
$$;
revoke all on function public.get_my_grade_forecast() from public, anon;
grant execute on function public.get_my_grade_forecast() to authenticated;

-- A new column, so the function is dropped and made again (and re-granted).
drop function public.get_mentee_early_warnings();
create function public.get_mentee_early_warnings()
 returns table(student_id uuid, name text, index_number text, department text, batch_year integer,
               semester integer, forecast_sgpa numeric, risk numeric, level text,
               watch_courses jsonb, reasons jsonb, basis text)
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $$
declare
  v_lecturer uuid := public.my_lecturer_id();
begin
  if v_lecturer is null then
    raise exception 'Access denied: lecturers only';
  end if;
  return query
  with f as (
    select s.id, s.name, s.index_number, s.department, s.batch_year, public.ml_forecast_for(s.id) as fc
      from public.mentor_assignments ma
      join public.students s on s.id = ma.student_id
     where ma.mentor_id = v_lecturer and ma.ended_at is null)
  select f.id, f.name, f.index_number, f.department, f.batch_year,
         (f.fc->>'semester')::int, (f.fc->>'forecast_sgpa')::numeric, (f.fc->>'risk')::numeric,
         f.fc->>'level',
         (select coalesce(jsonb_agg(jsonb_build_object('course_code', c->>'course_code', 'title', c->>'title',
                                                       'band', c->>'band', 'at_risk', (c->>'at_risk')::numeric)
                                    order by (c->>'at_risk')::numeric desc), '[]'::jsonb)
            from jsonb_array_elements(f.fc->'courses') c
           where (c->>'watch')::boolean),
         f.fc->'reasons', f.fc->>'basis'
    from f
   where f.fc is not null
   order by (f.fc->>'risk')::numeric desc, f.name;
end;
$$;
revoke all on function public.get_mentee_early_warnings() from public, anon;
grant execute on function public.get_mentee_early_warnings() to authenticated;
