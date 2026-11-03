-- Two students signed in from one phone.
--
-- The trick: a student signs themselves in, then logs in as an absent friend
-- on the same phone and scans again. In the same browser the database already
-- refuses it (one device, one student per lecture), so it is done in a
-- private window or another browser, which gets a new device id. What it
-- cannot hide: the friend's account was logged in seconds before, and the
-- sign-in came from the same network address and browser as the one just
-- before it.
--
-- - attendance_checkins.login_age_s: seconds between the student's login to
--   PES and this sign-in, read from their auth session. An honest student is
--   almost always still logged in from before.
-- - attendance_checkins.net_hash: the network address and browser string of
--   the request, kept only as an md5 salted with this register's secret. It
--   can say "the same phone as the sign-in a minute ago" within one lecture,
--   cannot be matched across lectures, and no address is stored.
-- - attendance_device_refusals: a browser that signed in one student and then
--   tried to sign in another. The register refused it before; now the
--   lecturer is also told, because the attempt is the evidence.
-- - ml_checkin_features gains two signals (fresh_login, same_phone_recent);
--   the retrained model uses all eight.
-- - ml_checkin_review explains them, and always lists a sign-in whose phone
--   tried to sign in someone else.

alter table public.attendance_checkins
  add column if not exists login_age_s integer,
  add column if not exists net_hash text;

comment on column public.attendance_checkins.login_age_s is
  'Seconds between the student''s login to PES and this sign-in.';
comment on column public.attendance_checkins.net_hash is
  'md5 of the request''s network address and browser string, salted with the register''s secret: comparable within one lecture only.';

create table if not exists public.attendance_device_refusals (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.attendance_sessions(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  device_hash text not null,
  refused_at  timestamptz not null default now(),
  unique (session_id, student_id, device_hash)
);
comment on table public.attendance_device_refusals is
  'A browser that had already signed in one student tried to sign in another in the same lecture. Read only through get_checkin_review.';
alter table public.attendance_device_refusals enable row level security;
revoke all on public.attendance_device_refusals from anon, authenticated;

create or replace function public.check_in_to_lecture(p_token text, p_device_hash text DEFAULT NULL::text, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_parts    text[];
  v_session  uuid;
  v_window   bigint;
  v_sig      text;
  s          record;
  v_now_win  bigint;
  v_student  record;
  v_enrolled boolean;
  v_age_ms   integer;
  v_distance double precision;
  v_flags    text[] := '{}';
  v_login    integer;
  v_headers  json;
  v_ip       text;
  v_ua       text;
  v_net      text;
begin
  select st.id, st.name into v_student
    from public.students st where st.id = auth.uid();
  if v_student.id is null then
    raise exception 'Only a student can sign a register';
  end if;

  v_parts := string_to_array(coalesce(p_token, ''), '.');
  if array_length(v_parts, 1) <> 3 then
    return jsonb_build_object('ok', false, 'reason', 'unreadable',
      'message', 'That code was not readable. Point the camera at the screen again.');
  end if;

  begin
    v_session := v_parts[1]::uuid;
    v_window  := v_parts[2]::bigint;
  exception when others then
    return jsonb_build_object('ok', false, 'reason', 'unreadable',
      'message', 'That code was not readable. Point the camera at the screen again.');
  end;
  v_sig := v_parts[3];

  select * into s from public.attendance_sessions where id = v_session;
  if s.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_session',
      'message', 'That code does not belong to any register.');
  end if;
  if s.status <> 'open' or now() > s.closes_at then
    return jsonb_build_object('ok', false, 'reason', 'closed',
      'message', 'This register has closed. Ask your lecturer to mark you.');
  end if;

  v_now_win := floor(extract(epoch from now()) / s.rotate_seconds)::bigint;
  if v_window > v_now_win or v_window < v_now_win - 1 then
    return jsonb_build_object('ok', false, 'reason', 'expired',
      'message', 'That code has expired. Scan the one on the screen now.');
  end if;
  if left(public.attendance_window_signature(s.id, s.secret, v_window), 16) <> v_sig then
    return jsonb_build_object('ok', false, 'reason', 'bad_signature',
      'message', 'That code is not valid.');
  end if;

  select exists (
    select 1
      from public.enrollments e
      join public.course_offerings o on o.id = s.offering_id
     where e.student_id = v_student.id
       and e.course_id  = o.course_id
       and e.status     = 'enrolled'
  ) into v_enrolled;
  if not v_enrolled then
    return jsonb_build_object('ok', false, 'reason', 'not_enrolled',
      'message', 'You are not enrolled in this course.');
  end if;

  v_age_ms := ((extract(epoch from now()) - (v_window * s.rotate_seconds)) * 1000)::int;

  if s.lat is not null and p_lat is not null then
    v_distance := public.metres_between(s.lat, s.lng, p_lat, p_lng);
    if v_distance > s.radius_m then
      v_flags := array_append(v_flags, 'far_from_lecture');
    end if;
  elsif s.lat is not null then
    v_flags := array_append(v_flags, 'no_location');
  end if;

  -- How long ago this student logged in. A friend switching to an absent
  -- student's account on their own phone logs in seconds before scanning.
  begin
    select greatest(0, extract(epoch from now() - se.created_at))::int into v_login
      from auth.sessions se
     where se.id = nullif(auth.jwt() ->> 'session_id', '')::uuid
       and se.user_id = v_student.id;
  exception when others then
    v_login := null;
  end;

  -- Where the request came from, kept only as a hash salted with this
  -- register's secret: enough to see two sign-ins from one phone within this
  -- lecture, and nothing else.
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    v_headers := null;
  end;
  v_ip := coalesce(nullif(trim(split_part(v_headers ->> 'x-forwarded-for', ',', 1)), ''),
                   nullif(v_headers ->> 'cf-connecting-ip', ''),
                   nullif(v_headers ->> 'x-real-ip', ''));
  v_ua := nullif(v_headers ->> 'user-agent', '');
  if v_ip is not null and v_ua is not null then
    v_net := md5(encode(s.secret, 'hex') || '|' || v_ip || '|' || v_ua);
  end if;

  begin
    insert into public.attendance_checkins
      (session_id, student_id, device_hash, token_age_ms, lat, lng, distance_m, flags,
       login_age_s, net_hash)
    values (s.id, v_student.id, p_device_hash, v_age_ms, p_lat, p_lng,
            v_distance::int, v_flags, v_login, v_net);
  exception
    when unique_violation then
      if exists (select 1 from public.attendance_checkins
                  where session_id = s.id and student_id = v_student.id) then
        return jsonb_build_object('ok', true, 'already', true,
          'message', 'You are already signed in for this lecture.');
      end if;
      -- This browser has signed in someone else. The attempt is the evidence,
      -- so the lecturer is told as well as the student refused.
      insert into public.attendance_device_refusals (session_id, student_id, device_hash)
      values (s.id, v_student.id, p_device_hash)
      on conflict do nothing;
      return jsonb_build_object('ok', false, 'reason', 'device_reused',
        'message', 'This device has already signed in another student for this lecture. Ask your lecturer to mark you.');
  end;

  return jsonb_build_object('ok', true, 'already', false,
    'message', 'Signed in.', 'at', now());
end;
$function$;

-- The features gain two columns, so the function is replaced, not altered.
drop function if exists public.ml_checkin_features(uuid);

create function public.ml_checkin_features(p_session uuid)
 returns table(checkin_id uuid, student_id uuid, x real[], code_age_s real, rotate_s integer,
               distance_m integer, radius_m integer, withheld boolean, usually_sends real,
               first_use boolean, shared_with integer, checks_after integer, checks_missed integer,
               login_age_s integer, same_phone_as uuid, same_phone_gap_s integer)
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
               and now() > pc.triggered_at + make_interval(secs => pc.window_seconds))::int as answered,
           -- Another student signed in from the same network and browser in
           -- the three minutes before: the friend whose phone this is.
           sp.student_id as same_as,
           sp.gap_s as same_gap
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
      left join lateral (
        select o.student_id,
               extract(epoch from c.checked_in_at - o.checked_in_at)::int as gap_s
          from public.attendance_checkins o
         where o.session_id = c.session_id
           and o.student_id <> c.student_id
           and c.net_hash is not null
           and o.net_hash = c.net_hash
           and o.checked_in_at >= c.checked_in_at - interval '180 seconds'
           and o.checked_in_at < c.checked_in_at
         order by o.checked_in_at desc
         limit 1) sp on true
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
           (case when c.after > 0 then (c.after - c.answered)::double precision / c.after else 0 end)::real,
           -- logged in within ten minutes before signing (FRESH_LOGIN_S in the script)
           (case when c.login_age_s is not null and c.login_age_s <= 600 then 1 else 0 end)::real,
           (case when c.same_as is not null then 1 else 0 end)::real
         ],
         (c.token_age_ms / 1000.0)::real, s.rotate_seconds, c.distance_m, s.radius_m,
         (s.lat is not null and c.lat is null),
         (case when c.n_loc > 0 then c.n_sent::real / c.n_loc else null end),
         (nullif(c.device_hash, '') is not null and c.n_prev >= 2 and c.n_same = 0),
         c.shared, c.after, c.after - c.answered,
         c.login_age_s, c.same_as, c.same_gap
    from c cross join s;
$$;

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
         sc.score >= m.threshold
           or coalesce(f.distance_m >= m.far_limit_m, false)
           or rf.names is not null,
         to_jsonb(array_remove(array[
           case when rf.names is not null then
             format('After this sign-in, the same browser tried to sign in %s too; the register refused it', rf.names) end,
           case when f.same_phone_as is not null then
             format('Signed in %s seconds after %s, from the same network and browser', f.same_phone_gap_s,
                    coalesce((select st.name from public.students st where st.id = f.same_phone_as), 'another student')) end,
           case when f.x[7] >= 1 then
             format('Logged in to PES %s before signing in',
                    case when f.login_age_s < 90 then f.login_age_s || ' seconds'
                         else round(f.login_age_s / 60.0) || ' minutes' end) end,
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
    cross join lateral (select public.ml_isolation_score(m.id, f.x) as score) sc
    left join lateral (
      select string_agg(st.name || coalesce(' (' || st.index_number || ')', ''), ', ' order by r.refused_at) as names
        from public.attendance_checkins c
        join public.attendance_device_refusals r
          on r.session_id = c.session_id and r.device_hash = c.device_hash and r.student_id <> c.student_id
        join public.students st on st.id = r.student_id
       where c.id = f.checkin_id) rf on true;
$$;

revoke all on function public.ml_checkin_features(uuid) from public, anon, authenticated;
revoke all on function public.ml_checkin_review(uuid) from public, anon, authenticated;
