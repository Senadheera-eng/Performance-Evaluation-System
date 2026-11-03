-- Real sign-ins, as the attendance anomaly model sees them, for retraining.
--
-- Run in the Supabase SQL editor once a semester of live registers exists,
-- and save the single cell as ml/data/checkins.csv (ml/data is git-ignored).
-- Each line is one sign-in to a closed register: the six numbers
-- ml_checkin_features computes, and nothing else (no student, course, device
-- or place). Then:
--
--     python ml/attendance_anomaly.py --real ml/data/checkins.csv
--
-- adds them to the simulated sign-ins the model learns from.
select string_agg(array_to_string(f.x, ','), E'\n' order by s.opens_at, f.checkin_id) as content
  from public.attendance_sessions s
  cross join lateral public.ml_checkin_features(s.id) f
 where s.status = 'closed';
