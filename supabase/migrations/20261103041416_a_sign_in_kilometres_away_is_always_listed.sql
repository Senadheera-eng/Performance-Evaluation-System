-- A sign-in kilometres from the lecture is always listed for review.
--
-- The first real sign-in scored, made 16.2 km from its lecture with nothing
-- else unusual, came out exactly at the model's threshold: an Isolation
-- Forest ranks one far-off signal about as unusual as two mild ones together.
-- No hall is that big and indoor GPS errs by a few hundred metres at most, so
-- a sign-in at least far_limit_m (1,000 m, a parameter of the model) from the
-- lecture is now flagged whatever its score. ml/attendance_anomaly.py
-- evaluates the two together; on the simulated test lectures the rule adds
-- catches and no false alarms.

-- Score a lecture's sign-ins with the active model and say, in the lecturer's
-- words, what was unusual about each.
create or replace function public.ml_checkin_review(p_session uuid)
 returns table(checkin_id uuid, student_id uuid, score double precision, flagged boolean, reasons jsonb)
 language sql
 stable
 security definer
 set search_path to 'public'
as $$
  with m as (select id, (params->>'threshold')::double precision as threshold,
                    coalesce((params->>'far_limit_m')::integer, 1000) as far_limit_m
               from public.ml_models where name = 'attendance-anomaly-forest' and is_active
              order by trained_at desc limit 1)
  select f.checkin_id, f.student_id, sc.score,
         sc.score >= m.threshold or coalesce(f.distance_m >= m.far_limit_m, false),
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

revoke all on function public.ml_checkin_review(uuid) from public, anon, authenticated;
