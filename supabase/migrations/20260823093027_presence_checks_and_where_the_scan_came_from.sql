-- presence_checks_and_where_the_scan_came_from
-- Applied 20260823093027
-- Exported from the live project; do not edit by hand.

-- Two layers on top of the scan, and a badge so a student knows to scan at all.
--
-- The rotating code proves a phone saw the screen at the start of the lecture.
-- It says nothing about the fifty minutes after, which is exactly when someone
-- who signed in and walked out is absent. A presence check is the lecturer
-- asking, at a moment nobody could predict, for a tap within the minute.
--
-- Location is the weakest of the three and is treated as such. A lecture hall
-- is concrete, indoor GPS is tens of metres out at best, and a phone can lie
-- about it outright. So it never refuses a check-in. It flags one, and the
-- flag is for the lecturer to read, not for the system to act on.
--
-- Nothing here marks anyone absent by itself. A student whose battery died
-- looks exactly like a student who left, and the difference is a question for
-- the person at the front of the room.

alter table public.attendance_sessions
  add column if not exists lat       double precision,
  add column if not exists lng       double precision,
  add column if not exists radius_m  integer not null default 250;

alter table public.attendance_checkins
  add column if not exists lat        double precision,
  add column if not exists lng        double precision,
  add column if not exists distance_m integer;

create table if not exists public.attendance_presence_checks (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references public.attendance_sessions(id) on delete cascade,
  triggered_by   uuid not null references auth.users(id),
  triggered_at   timestamptz not null default now(),
  window_seconds integer not null default 90,
  constraint attendance_presence_window_check check (window_seconds between 30 and 300)
);

create index if not exists attendance_presence_checks_session_idx
  on public.attendance_presence_checks (session_id, triggered_at desc);

create table if not exists public.attendance_presence_responses (
  check_id     uuid not null references public.attendance_presence_checks(id) on delete cascade,
  student_id   uuid not null references public.students(id) on delete cascade,
  responded_at timestamptz not null default now(),
  device_hash  text,
  primary key (check_id, student_id)
);

alter table public.attendance_presence_checks enable row level security;
alter table public.attendance_presence_responses enable row level security;

drop policy if exists attendance_presence_checks_no_direct_read on public.attendance_presence_checks;
create policy attendance_presence_checks_no_direct_read on public.attendance_presence_checks
  for select to authenticated using (false);

drop policy if exists attendance_presence_responses_own_read on public.attendance_presence_responses;
create policy attendance_presence_responses_own_read on public.attendance_presence_responses
  for select to authenticated using (student_id = auth.uid());

-- Metres between two points on the earth. Good to well under the radius that
-- matters here, and cheaper than reaching for an extension.
create or replace function public.metres_between(
  p_lat1 double precision, p_lng1 double precision,
  p_lat2 double precision, p_lng2 double precision)
returns double precision
language sql immutable
as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(p_lat2 - p_lat1) / 2), 2)
    + cos(radians(p_lat1)) * cos(radians(p_lat2))
      * power(sin(radians(p_lng2 - p_lng1) / 2), 2)))
$$;

-- Opening a register may now say where the lecture is. Passing nothing keeps
-- the old behaviour exactly: no location recorded, nothing flagged.
create or replace function public.start_attendance_session(
  p_offering_id  uuid,
  p_minutes      integer default 5,
  p_lecture_date date default current_date,
  p_lat          double precision default null,
  p_lng          double precision default null,
  p_radius_m     integer default 250)
returns uuid
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_id uuid;
begin
  if not public.is_offering_staff(p_offering_id) then
    raise exception 'Only the lecturers assigned to this course can open a register';
  end if;
  if p_minutes < 1 or p_minutes > 60 then
    raise exception 'A scanning window runs between 1 and 60 minutes';
  end if;

  update public.attendance_sessions
     set status = 'closed', closed_at = now(), closed_by = auth.uid()
   where offering_id = p_offering_id and status = 'open' and closes_at < now();

  insert into public.attendance_sessions
    (offering_id, lecture_date, opened_by, closes_at, lat, lng, radius_m)
  values
    (p_offering_id, p_lecture_date, auth.uid(),
     now() + make_interval(mins => p_minutes),
     p_lat, p_lng, greatest(coalesce(p_radius_m, 250), 50))
  returning id into v_id;

  return v_id;
end;
$$;

-- The scan, now able to carry where it happened. Out of range is a flag on
-- the row, never a refusal -- see the header.
create or replace function public.check_in_to_lecture(
  p_token       text,
  p_device_hash text default null,
  p_lat         double precision default null,
  p_lng         double precision default null)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
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

  begin
    insert into public.attendance_checkins
      (session_id, student_id, device_hash, token_age_ms, lat, lng, distance_m, flags)
    values (s.id, v_student.id, p_device_hash, v_age_ms, p_lat, p_lng,
            v_distance::int, v_flags);
  exception
    when unique_violation then
      if exists (select 1 from public.attendance_checkins
                  where session_id = s.id and student_id = v_student.id) then
        return jsonb_build_object('ok', true, 'already', true,
          'message', 'You are already signed in for this lecture.');
      end if;
      return jsonb_build_object('ok', false, 'reason', 'device_reused',
        'message', 'This device has already signed in another student for this lecture. Ask your lecturer to mark you.');
  end;

  return jsonb_build_object('ok', true, 'already', false,
    'message', 'Signed in.', 'at', now());
end;
$$;

create or replace function public.check_in_with_code(
  p_code        text,
  p_device_hash text default null,
  p_lat         double precision default null,
  p_lng         double precision default null)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  s       record;
  v_win   bigint;
  v_code  text := regexp_replace(coalesce(p_code, ''), '\D', '', 'g');
  v_found uuid;
begin
  if length(v_code) <> 6 then
    return jsonb_build_object('ok', false, 'reason', 'unreadable',
      'message', 'Enter the six digits shown beside the code.');
  end if;
  if not exists (select 1 from public.students st where st.id = auth.uid()) then
    raise exception 'Only a student can sign a register';
  end if;

  v_win := floor(extract(epoch from now()) / 30)::bigint;

  for s in
    select ses.id, ses.secret, ses.rotate_seconds
      from public.attendance_sessions ses
      join public.course_offerings o on o.id = ses.offering_id
     where ses.status = 'open'
       and now() between ses.opens_at and ses.closes_at
       and exists (select 1 from public.enrollments e
                    where e.student_id = auth.uid()
                      and e.course_id = o.course_id
                      and e.status = 'enrolled')
  loop
    if public.attendance_window_code(s.id, s.secret, v_win) = v_code
       or public.attendance_window_code(s.id, s.secret, v_win - 1) = v_code then
      v_found := s.id; exit;
    end if;
  end loop;

  if v_found is null then
    return jsonb_build_object('ok', false, 'reason', 'expired',
      'message', 'That code is not valid right now. Check the screen and try the current one.');
  end if;

  return public.check_in_to_lecture(
    v_found::text || '.' ||
      (floor(extract(epoch from now())
             / (select rotate_seconds from public.attendance_sessions where id = v_found)))::bigint::text
      || '.' ||
      left(public.attendance_window_signature(
        v_found,
        (select secret from public.attendance_sessions where id = v_found),
        floor(extract(epoch from now())
              / (select rotate_seconds from public.attendance_sessions where id = v_found))::bigint), 16),
    p_device_hash, p_lat, p_lng);
end;
$$;

-- The lecturer asking the room to prove it is still there.
create or replace function public.trigger_presence_check(
  p_session_id uuid, p_seconds integer default 90)
returns uuid
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_offering uuid;
  v_id       uuid;
begin
  select offering_id into v_offering
    from public.attendance_sessions where id = p_session_id;
  if v_offering is null then
    raise exception 'Register not found';
  end if;
  if not public.is_offering_staff(v_offering) then
    raise exception 'Only the lecturers assigned to this course can run a presence check';
  end if;

  insert into public.attendance_presence_checks (session_id, triggered_by, window_seconds)
  values (p_session_id, auth.uid(), greatest(least(coalesce(p_seconds, 90), 300), 30))
  returning id into v_id;

  return v_id;
end;
$$;

-- What the student's phone is being asked, if anything. Only ever asks
-- someone who actually signed in: there is nothing to confirm otherwise.
create or replace function public.my_pending_presence_check()
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  r record;
begin
  select pc.id, pc.triggered_at, pc.window_seconds, c.course_code, c.title
    into r
    from public.attendance_presence_checks pc
    join public.attendance_sessions s on s.id = pc.session_id
    join public.course_offerings o on o.id = s.offering_id
    join public.courses c on c.id = o.course_id
   where now() < pc.triggered_at + make_interval(secs => pc.window_seconds)
     and exists (select 1 from public.attendance_checkins ck
                  where ck.session_id = pc.session_id and ck.student_id = auth.uid())
     and not exists (select 1 from public.attendance_presence_responses pr
                      where pr.check_id = pc.id and pr.student_id = auth.uid())
   order by pc.triggered_at desc
   limit 1;

  if r.id is null then
    return jsonb_build_object('pending', false);
  end if;

  return jsonb_build_object(
    'pending', true,
    'check_id', r.id,
    'course_code', r.course_code,
    'course_title', r.title,
    'seconds_left',
      greatest(0, ceil(extract(epoch from
        (r.triggered_at + make_interval(secs => r.window_seconds)) - now()))::int));
end;
$$;

create or replace function public.confirm_presence(
  p_check_id    uuid,
  p_device_hash text default null)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  pc       record;
  v_device text;
begin
  select * into pc from public.attendance_presence_checks where id = p_check_id;
  if pc.id is null then
    return jsonb_build_object('ok', false, 'message', 'That check no longer exists.');
  end if;
  if now() > pc.triggered_at + make_interval(secs => pc.window_seconds) then
    return jsonb_build_object('ok', false,
      'message', 'That check has closed. Tell your lecturer if you were here.');
  end if;

  select device_hash into v_device
    from public.attendance_checkins
   where session_id = pc.session_id and student_id = auth.uid();
  if not found then
    return jsonb_build_object('ok', false,
      'message', 'You did not sign in to this lecture.');
  end if;

  -- Confirming from a different phone than the one that signed in would make
  -- the check meaningless: the point is that this device is still in the room.
  if v_device is not null and p_device_hash is distinct from v_device then
    return jsonb_build_object('ok', false,
      'message', 'Confirm from the same device you signed in with.');
  end if;

  insert into public.attendance_presence_responses (check_id, student_id, device_hash)
  values (p_check_id, auth.uid(), p_device_hash)
  on conflict do nothing;

  return jsonb_build_object('ok', true, 'message', 'Thanks — you are marked as still here.');
end;
$$;

grant execute on function public.metres_between(double precision, double precision, double precision, double precision) to authenticated;
grant execute on function public.start_attendance_session(uuid, integer, date, double precision, double precision, integer) to authenticated;
grant execute on function public.check_in_to_lecture(text, text, double precision, double precision) to authenticated;
grant execute on function public.check_in_with_code(text, text, double precision, double precision) to authenticated;
grant execute on function public.trigger_presence_check(uuid, integer) to authenticated;
grant execute on function public.my_pending_presence_check() to authenticated;
grant execute on function public.confirm_presence(uuid, text) to authenticated;
