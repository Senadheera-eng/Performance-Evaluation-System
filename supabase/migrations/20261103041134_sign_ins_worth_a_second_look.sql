-- Attendance anomaly detection: sign-ins worth a second look.
--
-- ml/attendance_anomaly.py trains an Isolation Forest on how live sign-ins
-- normally look and loads its trees here. The database scores every sign-in
-- of a lecture with them, so a lecturer sees which sign-ins are unusual, and
-- why, as soon as the lecture is over. A flag is a reason to look, never a
-- mark: nothing here changes attendance.
--
-- - ml_isolation_trees: the forest, one row per tree, as parallel arrays
--   (feature, threshold, children, samples per node), under a row in
--   ml_models that holds the threshold and how the model was evaluated.
-- - ml_checkin_features(session): six numbers per sign-in, computed exactly as
--   the training script computes them: the age of the code, the distance from
--   the hall, location withheld by a phone that usually sends it, a student's
--   first sign-in from a device, other students the device signed in before,
--   and presence checks missed.
-- - ml_isolation_score(model, x): the forest's anomaly score, as scikit-learn
--   computes it (the loader checks this on sample sign-ins).
-- - get_checkin_review(offering, date): the flagged sign-ins of a lecture,
--   with their reasons, for the staff who may read its register.
-- - ml_load_anomaly_model(token, payload): the loader, guarded by the same
--   single-use tokens as the grade predictions.

create table public.ml_isolation_trees (
  model_id     uuid not null references public.ml_models(id) on delete cascade,
  tree_no      integer not null,
  feature      smallint[] not null,
  threshold    double precision[] not null,
  left_child   integer[] not null,
  right_child  integer[] not null,
  n_samples    integer[] not null,
  primary key (model_id, tree_no)
);
alter table public.ml_isolation_trees enable row level security;
revoke all on public.ml_isolation_trees from anon, authenticated;

-- The average path length of an unsuccessful search in a binary tree of n
-- points: the normaliser in an Isolation Forest's score.
create or replace function public.ml_avg_path_length(n integer)
 returns double precision
 language sql
 immutable
 set search_path to 'public'
as $$
  select case when n <= 1 then 0
              when n = 2 then 1
              else 2.0 * (ln(n - 1) + 0.5772156649015329) - 2.0 * (n - 1) / n end;
$$;

-- Walk every tree of the model to a leaf; the shorter the average path, the
-- easier the point was to isolate, and the higher the score (0 to 1).
create or replace function public.ml_isolation_score(p_model uuid, p_x real[])
 returns double precision
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $$
declare
  t       record;
  node    integer;
  depth   integer;
  total   double precision := 0;
  trees   integer := 0;
  v_c     double precision;
begin
  select (params->>'c_norm')::double precision into v_c from public.ml_models where id = p_model;
  for t in select * from public.ml_isolation_trees where model_id = p_model order by tree_no loop
    node := 1;  -- arrays are 1-based; the exported node numbers are 0-based
    depth := 0;
    while t.left_child[node] <> -1 loop
      if p_x[t.feature[node] + 1]::double precision <= t.threshold[node] then
        node := t.left_child[node] + 1;
      else
        node := t.right_child[node] + 1;
      end if;
      depth := depth + 1;
    end loop;
    total := total + depth + public.ml_avg_path_length(t.n_samples[node]);
    trees := trees + 1;
  end loop;
  if trees = 0 or v_c is null then
    return null;
  end if;
  return power(2::double precision, -(total / trees) / v_c);
end;
$$;

-- The features of every sign-in to one lecture. "Earlier" means lectures that
-- opened before this one, so scoring a past lecture again gives the same answer.
create or replace function public.ml_checkin_features(p_session uuid)
 returns table(checkin_id uuid, student_id uuid, x real[], code_age_s real, rotate_s integer,
               distance_m integer, radius_m integer, withheld boolean, usually_sends real,
               first_use boolean, shared_with integer, checks_after integer, checks_missed integer)
 language sql
 stable
 security definer
 set search_path to 'public'
as $$
  with s as (select * from public.attendance_sessions where id = p_session),
  c as (
    select c.*, h.n_prev, h.n_loc, h.n_sent, h.n_same,
           (select count(distinct c3.student_id)
              from public.attendance_checkins c3
              join public.attendance_sessions s3 on s3.id = c3.session_id
             where nullif(c.device_hash, '') is not null
               and c3.device_hash = c.device_hash
               and c3.student_id <> c.student_id
               and s3.opens_at < (select opens_at from s))::int as shared,
           (select count(*) from public.attendance_presence_checks pc
             where pc.session_id = c.session_id and pc.triggered_at > c.checked_in_at
               and now() > pc.triggered_at + make_interval(secs => pc.window_seconds))::int as after,
           (select count(*) from public.attendance_presence_checks pc
              join public.attendance_presence_responses pr on pr.check_id = pc.id and pr.student_id = c.student_id
             where pc.session_id = c.session_id and pc.triggered_at > c.checked_in_at
               and now() > pc.triggered_at + make_interval(secs => pc.window_seconds))::int as answered
      from public.attendance_checkins c
      cross join lateral (
        select count(*)::int as n_prev,
               count(*) filter (where e.had_loc)::int as n_loc,
               count(*) filter (where e.had_loc and e.sent)::int as n_sent,
               count(*) filter (where nullif(c.device_hash, '') is not null and e.device_hash = c.device_hash)::int as n_same
          from (select c2.device_hash, (c2.lat is not null) as sent, (s2.lat is not null) as had_loc
                  from public.attendance_checkins c2
                  join public.attendance_sessions s2 on s2.id = c2.session_id
                 where c2.student_id = c.student_id
                   and s2.opens_at < (select opens_at from s)
                 order by s2.opens_at desc
                 limit 20) e) h
     where c.session_id = p_session)
  select c.id, c.student_id,
         array[
           (c.token_age_ms / (s.rotate_seconds * 1000.0))::real,
           (case when s.lat is not null and c.lat is not null and c.distance_m is not null
                 then least(ln(1 + c.distance_m::double precision / greatest(s.radius_m, 1)), 6) else 0 end)::real,
           (case when s.lat is not null and c.lat is null
                 then case when c.n_loc > 0 then c.n_sent::double precision / c.n_loc else 0.5 end
                 else 0 end)::real,
           (case when nullif(c.device_hash, '') is not null and c.n_prev >= 2 and c.n_same = 0 then 1 else 0 end)::real,
           least(c.shared, 3)::real,
           (case when c.after > 0 then (c.after - c.answered)::double precision / c.after else 0 end)::real
         ],
         (c.token_age_ms / 1000.0)::real, s.rotate_seconds, c.distance_m, s.radius_m,
         (s.lat is not null and c.lat is null),
         (case when c.n_loc > 0 then c.n_sent::real / c.n_loc else null end),
         (nullif(c.device_hash, '') is not null and c.n_prev >= 2 and c.n_same = 0),
         c.shared, c.after, c.after - c.answered
    from c cross join s;
$$;

-- Score a lecture's sign-ins with the active model and say, in the lecturer's
-- words, what was unusual about each.
create or replace function public.ml_checkin_review(p_session uuid)
 returns table(checkin_id uuid, student_id uuid, score double precision, flagged boolean, reasons jsonb)
 language sql
 stable
 security definer
 set search_path to 'public'
as $$
  with m as (select id, (params->>'threshold')::double precision as threshold
               from public.ml_models where name = 'attendance-anomaly-forest' and is_active
              order by trained_at desc limit 1)
  select f.checkin_id, f.student_id, sc.score, sc.score >= m.threshold,
         to_jsonb(array_remove(array[
           case when f.x[1] >= 1 then
             format('Used a code %s seconds old; it changes every %s seconds', round(f.code_age_s), f.rotate_s) end,
           case when f.distance_m is not null and f.radius_m is not null and f.distance_m > f.radius_m then
             format('Signed in %s from the lecture',
                    case when f.distance_m >= 1000 then round(f.distance_m / 1000.0, 1) || ' km' else f.distance_m || ' m' end) end,
           case when f.withheld then
             case when coalesce(f.usually_sends, 0) >= 0.5 then 'Sent no location, though their phone usually does'
                  else 'Sent no location' end end,
           case when f.first_use then 'First sign-in from this device; their earlier sign-ins used another' end,
           case when f.shared_with > 0 then
             format('This device has signed in %s other student%s before', f.shared_with,
                    case when f.shared_with = 1 then '' else 's' end) end,
           case when f.checks_missed > 0 then
             format('Missed %s of %s presence check%s after signing in', f.checks_missed, f.checks_after,
                    case when f.checks_after = 1 then '' else 's' end) end
         ], null))
    from public.ml_checkin_features(p_session) f
    cross join m
    cross join lateral (select public.ml_isolation_score(m.id, f.x) as score) sc;
$$;

-- For the staff who may read a course's register: the sign-ins of that
-- lecture date that look unusual, most unusual first, with the reasons.
create or replace function public.get_checkin_review(p_offering_id uuid, p_lecture_date date)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $$
declare
  v_model jsonb;
  v_rows  jsonb;
  v_signed integer;
begin
  if not public.is_offering_staff(p_offering_id) then
    raise exception 'Only the staff of this course can review its sign-ins';
  end if;

  select jsonb_build_object('name', name, 'algorithm', algorithm, 'trained_at', trained_at,
                            'evaluation', metrics)
    into v_model
    from public.ml_models where name = 'attendance-anomaly-forest' and is_active
   order by trained_at desc limit 1;
  if v_model is null then
    return null;
  end if;

  select count(*)::int into v_signed
    from public.attendance_checkins c
    join public.attendance_sessions s on s.id = c.session_id
   where s.offering_id = p_offering_id and s.lecture_date = p_lecture_date;

  select coalesce(jsonb_agg(jsonb_build_object(
           'student_id', st.id, 'name', st.name, 'index_number', st.index_number,
           'checked_in_at', c.checked_in_at, 'session_status', s.status,
           'score', round(r.score::numeric, 3), 'reasons', r.reasons)
           order by r.score desc), '[]'::jsonb)
    into v_rows
    from public.attendance_sessions s
    cross join lateral public.ml_checkin_review(s.id) r
    join public.attendance_checkins c on c.id = r.checkin_id
    join public.students st on st.id = r.student_id
   where s.offering_id = p_offering_id and s.lecture_date = p_lecture_date
     and r.flagged;

  return jsonb_build_object('model', v_model, 'signed_in', v_signed, 'flagged', v_rows);
end;
$$;

-- The loader. The payload is ml/out/anomaly_model.json: the model, its trees,
-- and sample sign-ins with the scores scikit-learn gave them. The load is
-- refused, and nothing is kept, unless the database scores them the same.
create or replace function public.ml_load_anomaly_model(p_token text, p_payload jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  v_model  uuid;
  v_trees  integer;
  chk      jsonb;
  v_score  double precision;
  v_checks integer := 0;
begin
  update public.ml_load_tokens
     set used_at = now()
   where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
     and used_at is null
     and expires_at > now();
  if not found then
    raise exception 'Not authorised: the load token is missing, already used or expired';
  end if;

  update public.ml_models set is_active = false
   where name = p_payload->'model'->>'name' and is_active;

  insert into public.ml_models (name, algorithm, trained_at, params, features, train_rows, metrics, is_active)
  values (p_payload->'model'->>'name',
          p_payload->'model'->>'algorithm',
          (p_payload->'model'->>'trained_at')::timestamptz,
          (p_payload->'model'->'params') || jsonb_build_object(
            'threshold', (p_payload->'model'->>'threshold')::double precision,
            'c_norm', (p_payload->'model'->>'c_norm')::double precision),
          coalesce(p_payload->'model'->'feature_labels', '[]'::jsonb),
          (p_payload->'model'->>'train_rows')::integer,
          coalesce(p_payload->'model'->'evaluation', '{}'::jsonb),
          true)
  returning id into v_model;

  insert into public.ml_isolation_trees (model_id, tree_no, feature, threshold, left_child, right_child, n_samples)
  select v_model, (t.ord - 1)::int,
         array(select v::smallint from jsonb_array_elements_text(t.tr->'f') with ordinality e(v, i) order by i),
         array(select v::double precision from jsonb_array_elements_text(t.tr->'t') with ordinality e(v, i) order by i),
         array(select v::integer from jsonb_array_elements_text(t.tr->'l') with ordinality e(v, i) order by i),
         array(select v::integer from jsonb_array_elements_text(t.tr->'r') with ordinality e(v, i) order by i),
         array(select v::integer from jsonb_array_elements_text(t.tr->'n') with ordinality e(v, i) order by i)
    from jsonb_array_elements(p_payload->'trees') with ordinality t(tr, ord);
  get diagnostics v_trees = row_count;

  for chk in select * from jsonb_array_elements(coalesce(p_payload->'checks', '[]'::jsonb)) loop
    v_score := public.ml_isolation_score(v_model,
      array(select v::real from jsonb_array_elements_text(chk->'x') with ordinality e(v, i) order by i));
    if v_score is null or abs(v_score - (chk->>'score')::double precision) > 1e-6 then
      raise exception 'The database scores a sample sign-in % where scikit-learn gave %; nothing was loaded',
        v_score, chk->>'score';
    end if;
    v_checks := v_checks + 1;
  end loop;

  return jsonb_build_object('model_id', v_model, 'trees', v_trees, 'checks_matched', v_checks);
end;
$$;

revoke all on function public.ml_avg_path_length(integer) from public, anon, authenticated;
revoke all on function public.ml_isolation_score(uuid, real[]) from public, anon, authenticated;
revoke all on function public.ml_checkin_features(uuid) from public, anon, authenticated;
revoke all on function public.ml_checkin_review(uuid) from public, anon, authenticated;
revoke all on function public.get_checkin_review(uuid, date) from public, anon;
grant execute on function public.get_checkin_review(uuid, date) to authenticated;
-- Signed-out callers may call it only because the token is the credential.
revoke all on function public.ml_load_anomaly_model(text, jsonb) from public;
grant execute on function public.ml_load_anomaly_model(text, jsonb) to anon, authenticated, service_role;
