-- Grade predictions, and the model behind them.
--
-- ml/train.py trains a model on the faculty's past results and predicts, for
-- each student, the grade band they are likely to get in each course of the
-- coming semester (A+/A, A-/B+, B/B-, C+/C, R/F), with the chance of each band.
-- This migration gives those predictions a home and decides who sees them:
--
-- - ml_models: one row per trained model, with how it was evaluated. Only one
--   model of a name is active at a time; a new load replaces it.
-- - ml_grade_predictions: one row per student and course, for the active
--   model's semester.
-- - ml_load_tokens: single-use, hour-long tokens that let the training machine
--   load predictions without a service key. A token is made in the SQL editor
--   (see ml/README.md); only its hash is stored.
--
-- Nobody reads the tables directly (RLS on, no policies). Students read their
-- own forecast, mentors their mentees' early warnings, and staff who may see a
-- student's record that student's forecast, all through the functions below.
-- A student is shown likely bands and a forecast SGPA, not a "risk" figure;
-- the chance of an R or F is for their mentor.

create table public.ml_models (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  algorithm   text not null,
  trained_at  timestamptz not null,
  params      jsonb not null default '{}'::jsonb,
  features    jsonb not null default '[]'::jsonb,
  train_rows  integer not null,
  metrics     jsonb not null default '{}'::jsonb,
  is_active   boolean not null default false,
  created_at  timestamptz not null default now()
);
create unique index ml_models_one_active_per_name on public.ml_models (name) where is_active;

create table public.ml_grade_predictions (
  id                   uuid primary key default gen_random_uuid(),
  model_id             uuid not null references public.ml_models(id) on delete cascade,
  student_id           uuid not null references public.students(id) on delete cascade,
  course_id            uuid not null references public.courses(id) on delete cascade,
  semester             integer not null,
  predicted_band       text not null check (predicted_band in ('A+/A', 'A-/B+', 'B/B-', 'C+/C', 'R/F')),
  band_probabilities   jsonb not null,
  expected_gpv         numeric(4,2) not null,
  at_risk_probability  numeric(4,3) not null,
  reasons              jsonb not null default '[]'::jsonb,
  created_at           timestamptz not null default now(),
  unique (model_id, student_id, course_id)
);
create index ml_grade_predictions_student on public.ml_grade_predictions (student_id);

create table public.ml_load_tokens (
  token_hash  text primary key,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '1 hour',
  used_at     timestamptz
);

alter table public.ml_models enable row level security;
alter table public.ml_grade_predictions enable row level security;
alter table public.ml_load_tokens enable row level security;
revoke all on public.ml_models, public.ml_grade_predictions, public.ml_load_tokens from anon, authenticated;

-- ---------------------------------------------------------------- loading

-- The training machine sends {model, semester, students_fingerprint,
-- courses_fingerprint, rows:[{s, c, band, probs, gpv, risk, reasons}]}.
-- Students and courses are numbers in the export (ml/export_dataset.sql) and
-- are mapped back to ids here, so no id leaves the database. If either list
-- has changed since the export, the numbering would shift, so the load is
-- refused.
create or replace function public.ml_load_predictions(p_token text, p_payload jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  v_model uuid;
  v_rows  integer;
begin
  update public.ml_load_tokens
     set used_at = now()
   where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
     and used_at is null
     and expires_at > now();
  if not found then
    raise exception 'Not authorised: the load token is missing, already used or expired';
  end if;

  if p_payload->>'students_fingerprint' is distinct from
       (select md5(string_agg(id::text, ',' order by id)) from public.students where role = 'student')
     or p_payload->>'courses_fingerprint' is distinct from
       (select md5(string_agg(id::text, ',' order by id)) from public.courses) then
    raise exception 'Students or courses changed since the data was exported; export and train again';
  end if;

  update public.ml_models set is_active = false
   where name = p_payload->'model'->>'name' and is_active;

  insert into public.ml_models (name, algorithm, trained_at, params, features, train_rows, metrics, is_active)
  values (p_payload->'model'->>'name',
          p_payload->'model'->>'algorithm',
          (p_payload->'model'->>'trained_at')::timestamptz,
          coalesce(p_payload->'model'->'params', '{}'::jsonb),
          coalesce(p_payload->'model'->'features', '[]'::jsonb),
          (p_payload->'model'->>'train_rows')::integer,
          coalesce(p_payload->'model'->'evaluation', '{}'::jsonb),
          true)
  returning id into v_model;

  with s as (select id, (dense_rank() over (order by id))::int si from public.students where role = 'student'),
       c as (select id, (dense_rank() over (order by id))::int ci from public.courses),
       r as (select * from jsonb_to_recordset(p_payload->'rows')
               as x(s int, c int, band text, probs jsonb, gpv numeric, risk numeric, reasons jsonb))
  insert into public.ml_grade_predictions
         (model_id, student_id, course_id, semester, predicted_band, band_probabilities,
          expected_gpv, at_risk_probability, reasons)
  select v_model, s.id, c.id, (p_payload->>'semester')::int, r.band, r.probs, r.gpv, r.risk, r.reasons
    from r join s on s.si = r.s join c on c.ci = r.c;
  get diagnostics v_rows = row_count;

  return jsonb_build_object('model_id', v_model, 'predictions', v_rows);
end;
$$;

-- Signed-out callers may call it only because the token is the credential:
-- without a valid, unused, unexpired one it changes nothing.
revoke all on function public.ml_load_predictions(text, jsonb) from public;
grant execute on function public.ml_load_predictions(text, jsonb) to anon, authenticated, service_role;

-- ---------------------------------------------------------------- reading

-- One student's forecast for the active model's semester: the courses they
-- are enrolled in (or, before they enrol, their department's compulsory
-- ones), less any already graded. The SGPA forecast weights each course by
-- the credits it carries in this semester's GPA, as the planner does, so a
-- course graded in a later semester counts there, not here. Internal: callers
-- go through the functions below, which decide who may ask.
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
                else category = 'Compulsory' end)
  select case when not exists (select 1 from chosen) then null else jsonb_build_object(
    'model', (select jsonb_build_object('name', name, 'algorithm', algorithm, 'trained_at', trained_at,
                                        'train_rows', train_rows, 'evaluation', metrics) from m),
    'semester', (select max(semester) from chosen),
    'basis', case when exists (select 1 from enrolled) then 'enrolled' else 'compulsory' end,
    'forecast_sgpa', (select round(sum(expected_gpv * gpa_credits) / nullif(sum(gpa_credits), 0), 2)
                        from chosen where contributes_to_gpa and gpa_credits > 0),
    'risk', (select round(1 - exp(sum(ln(greatest(1 - at_risk_probability, 0.0001)))), 3) from chosen),
    'reasons', (select reasons from chosen order by at_risk_probability desc, course_code limit 1),
    'courses', (select jsonb_agg(jsonb_build_object(
                  'course_id', course_id, 'course_code', course_code, 'title', title,
                  'credits', credits, 'counts_this_semester', contributes_to_gpa and gpa_credits > 0,
                  'band', predicted_band, 'probabilities', band_probabilities,
                  'expected_gpv', expected_gpv, 'at_risk', at_risk_probability)
                  order by course_code) from chosen)) end;
$$;
revoke all on function public.ml_forecast_for(uuid) from public, anon, authenticated;

-- A student's own forecast. The chance of an R or F is left out: that is for
-- their mentor to raise with them, not a number to hand a student cold.
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
  return (v - 'risk') || jsonb_build_object('courses',
    (select jsonb_agg(c - 'at_risk') from jsonb_array_elements(v->'courses') c));
end;
$$;
revoke all on function public.get_my_grade_forecast() from public, anon;
grant execute on function public.get_my_grade_forecast() to authenticated;

-- A mentor's mentees, most likely to need a word first.
create or replace function public.get_mentee_early_warnings()
 returns table(student_id uuid, name text, index_number text, department text, batch_year integer,
               semester integer, forecast_sgpa numeric, risk numeric, watch_courses jsonb,
               reasons jsonb, basis text)
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
         (select coalesce(jsonb_agg(jsonb_build_object('course_code', c->>'course_code', 'title', c->>'title',
                                                       'band', c->>'band', 'at_risk', (c->>'at_risk')::numeric)
                                    order by (c->>'at_risk')::numeric desc), '[]'::jsonb)
            from jsonb_array_elements(f.fc->'courses') c
           where (c->>'at_risk')::numeric >= 0.15),
         f.fc->'reasons', f.fc->>'basis'
    from f
   where f.fc is not null
   order by (f.fc->>'risk')::numeric desc, f.name;
end;
$$;
revoke all on function public.get_mentee_early_warnings() from public, anon;
grant execute on function public.get_mentee_early_warnings() to authenticated;

-- One student's full forecast, for their mentor or anyone who may see their
-- record (their head of department, department admin, the super admin).
create or replace function public.get_student_grade_forecast(p_student_id uuid)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $$
begin
  if not (public.is_my_mentee(p_student_id) or public.can_view_student_record(p_student_id)) then
    raise exception 'Access denied';
  end if;
  return public.ml_forecast_for(p_student_id);
end;
$$;
revoke all on function public.get_student_grade_forecast(uuid) from public, anon;
grant execute on function public.get_student_grade_forecast(uuid) to authenticated;
