-- students_check_themselves_in_with_a_rotating_code
-- Applied 20260823085152
-- Exported from the live project; do not edit by hand.

-- A lecture register the students sign themselves.
--
-- Marking forty names by hand is the department's whole complaint, and the
-- obvious fix -- a code on the projector -- fails the moment one student
-- photographs it and sends it on. So the code is not a code: it is an HMAC
-- over the session and a ten-second window, recomputed rather than stored,
-- and it stops being valid before a screenshot is worth sending.
--
-- That still only proves a phone was in range of the screen, never that its
-- owner was. The rule that does the most work is the plainest one: within a
-- session, one device may sign in one student. A phone cannot carry a row of
-- absent friends. Nothing here is proof of presence -- it raises the cost of
-- not attending above the cost of attending, and leaves a trail when someone
-- pays it anyway.
--
-- Marking by hand stays exactly as it was. This is another way in, not a
-- replacement, and every row records which way it came.

alter table public.attendance
  add column if not exists method text not null default 'manual';

alter table public.attendance
  drop constraint if exists attendance_method_check;
alter table public.attendance
  add constraint attendance_method_check
  check (method in ('manual', 'qr'));

comment on column public.attendance.method is
  'How the row was recorded: marked by staff, or signed by the student against a session code.';

create table if not exists public.attendance_sessions (
  id             uuid primary key default gen_random_uuid(),
  offering_id    uuid not null references public.course_offerings(id) on delete cascade,
  lecture_date   date not null default current_date,
  opened_by      uuid not null references auth.users(id),
  opens_at       timestamptz not null default now(),
  closes_at      timestamptz not null,
  status         text not null default 'open',
  -- Per session, so a leaked token is worth nothing to the next lecture.
  secret         bytea not null default extensions.gen_random_bytes(32),
  rotate_seconds int not null default 10,
  closed_at      timestamptz,
  closed_by      uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  constraint attendance_sessions_status_check check (status in ('open', 'closed')),
  constraint attendance_sessions_window_check check (closes_at > opens_at),
  constraint attendance_sessions_rotate_check check (rotate_seconds between 5 and 60)
);

-- Two open sessions on one offering would leave the student's scan ambiguous.
create unique index if not exists attendance_sessions_one_open_per_offering
  on public.attendance_sessions (offering_id) where status = 'open';

create index if not exists attendance_sessions_offering_date_idx
  on public.attendance_sessions (offering_id, lecture_date desc);

create table if not exists public.attendance_checkins (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references public.attendance_sessions(id) on delete cascade,
  student_id    uuid not null references public.students(id) on delete cascade,
  checked_in_at timestamptz not null default now(),
  -- Opaque and client-generated: enough to tell two phones apart, not enough
  -- to identify one. See the partial unique index below.
  device_hash   text,
  token_age_ms  integer,
  flags         text[] not null default '{}'
);

create unique index if not exists attendance_checkins_one_per_student
  on public.attendance_checkins (session_id, student_id);

-- The rule that does the real work: one device, one student, per session.
create unique index if not exists attendance_checkins_one_per_device
  on public.attendance_checkins (session_id, device_hash)
  where device_hash is not null;

alter table public.attendance_sessions enable row level security;
alter table public.attendance_checkins enable row level security;

-- The secret lives in this table, so nobody reads the row directly. Every
-- path in and out is a function below.
drop policy if exists attendance_sessions_no_direct_read on public.attendance_sessions;
create policy attendance_sessions_no_direct_read on public.attendance_sessions
  for select to authenticated using (false);

drop policy if exists attendance_checkins_own_read on public.attendance_checkins;
create policy attendance_checkins_own_read on public.attendance_checkins
  for select to authenticated using (student_id = auth.uid());

-- The code on the screen. Recomputed from the window, never stored, so there
-- is no table of live tokens to leak and nothing to clean up afterwards.
create or replace function public.attendance_window_signature(
  p_session_id uuid, p_secret bytea, p_window bigint)
returns text
language sql immutable
as $$
  select translate(
           encode(
             extensions.hmac(
               convert_to(p_session_id::text || ':' || p_window::text, 'utf8'),
               p_secret, 'sha256'),
             'base64'),
           '+/=', '-_')
$$;

-- The same idea for a phone whose camera will not focus: six digits, derived
-- from three bytes of a separate HMAC so it can never leak the scan token.
create or replace function public.attendance_window_code(
  p_session_id uuid, p_secret bytea, p_window bigint)
returns text
language sql immutable
as $$
  select lpad(
    ((get_byte(t.h, 0)::bigint * 65536
      + get_byte(t.h, 1) * 256
      + get_byte(t.h, 2)) % 1000000)::text, 6, '0')
  from (select extensions.hmac(
          convert_to(p_session_id::text || ':code:' || p_window::text, 'utf8'),
          p_secret, 'sha256') as h) t
$$;

create or replace function public.start_attendance_session(
  p_offering_id uuid,
  p_minutes     integer default 5,
  p_lecture_date date default current_date)
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

  -- A forgotten session from an earlier lecture must not swallow today's scans.
  update public.attendance_sessions
     set status = 'closed', closed_at = now(), closed_by = auth.uid()
   where offering_id = p_offering_id and status = 'open' and closes_at < now();

  insert into public.attendance_sessions
    (offering_id, lecture_date, opened_by, closes_at)
  values
    (p_offering_id, p_lecture_date, auth.uid(), now() + make_interval(mins => p_minutes))
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.extend_attendance_session(
  p_session_id uuid, p_minutes integer default 2)
returns timestamptz
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_offering uuid;
  v_closes   timestamptz;
begin
  select offering_id into v_offering
    from public.attendance_sessions where id = p_session_id and status = 'open';
  if v_offering is null then
    raise exception 'That register is not open';
  end if;
  if not public.is_offering_staff(v_offering) then
    raise exception 'Only the lecturers assigned to this course can extend a register';
  end if;

  update public.attendance_sessions
     set closes_at = greatest(closes_at, now()) + make_interval(mins => p_minutes)
   where id = p_session_id
  returning closes_at into v_closes;

  return v_closes;
end;
$$;

-- What to put on the screen right now. Only the lecturers running the
-- session may ask, and the answer is stale within rotate_seconds.
create or replace function public.attendance_session_token(p_session_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  s        record;
  v_window bigint;
begin
  select * into s from public.attendance_sessions where id = p_session_id;
  if s.id is null then
    raise exception 'Register not found';
  end if;
  if not public.is_offering_staff(s.offering_id) then
    raise exception 'Only the lecturers assigned to this course can display the code';
  end if;
  if s.status <> 'open' or now() > s.closes_at then
    return jsonb_build_object('open', false, 'closes_at', s.closes_at);
  end if;

  v_window := floor(extract(epoch from now()) / s.rotate_seconds)::bigint;

  return jsonb_build_object(
    'open', true,
    'token', s.id::text || '.' || v_window::text || '.'
             || left(public.attendance_window_signature(s.id, s.secret, v_window), 16),
    -- Slower to type, so it turns over more slowly too.
    'code', public.attendance_window_code(
              s.id, s.secret, floor(extract(epoch from now()) / 30)::bigint),
    'rotate_seconds', s.rotate_seconds,
    'expires_in', s.rotate_seconds - (extract(epoch from now())::bigint % s.rotate_seconds),
    'closes_at', s.closes_at);
end;
$$;

-- The student's side. Everything it decides, it decides from server time.
create or replace function public.check_in_to_lecture(
  p_token       text,
  p_device_hash text default null)
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

  -- The window is the expiry. One window of grace covers the second between
  -- the camera reading the screen and the request arriving.
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

  begin
    insert into public.attendance_checkins
      (session_id, student_id, device_hash, token_age_ms)
    values (s.id, v_student.id, p_device_hash, v_age_ms);
  exception
    when unique_violation then
      if exists (select 1 from public.attendance_checkins
                  where session_id = s.id and student_id = v_student.id) then
        return jsonb_build_object('ok', true, 'already', true,
          'message', 'You are already signed in for this lecture.');
      end if;
      -- The other unique index: this phone has already signed someone in.
      return jsonb_build_object('ok', false, 'reason', 'device_reused',
        'message', 'This device has already signed in another student for this lecture. Ask your lecturer to mark you.');
  end;

  return jsonb_build_object('ok', true, 'already', false,
    'message', 'Signed in.', 'at', now());
end;
$$;

-- The live roster behind the lecturer's screen.
create or replace function public.attendance_session_state(p_session_id uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  s      record;
  v_rows jsonb;
begin
  select * into s from public.attendance_sessions where id = p_session_id;
  if s.id is null then
    raise exception 'Register not found';
  end if;
  if not public.is_offering_staff(s.offering_id) then
    raise exception 'Only the lecturers assigned to this course can read this register';
  end if;

  select coalesce(jsonb_agg(t.r order by t.checked_in_at nulls last, t.index_number), '[]'::jsonb)
    into v_rows
    from (
      select c.checked_in_at, st.index_number,
             jsonb_build_object(
               'student_id',    st.id,
               'name',          st.name,
               'index_number',  st.index_number,
               'checked_in_at', c.checked_in_at) as r
        from public.course_offerings o
        join public.enrollments e
          on e.course_id = o.course_id and e.status = 'enrolled'
        join public.students st on st.id = e.student_id
        left join public.attendance_checkins c
          on c.session_id = s.id and c.student_id = st.id
       where o.id = s.offering_id
    ) t;

  return jsonb_build_object(
    'session_id',   s.id,
    'status',       s.status,
    'opens_at',     s.opens_at,
    'closes_at',    s.closes_at,
    'lecture_date', s.lecture_date,
    'students',     v_rows);
end;
$$;

-- Closing writes the register. Nothing is written to attendance before this:
-- a check-in is evidence, and the row staff and students read is derived from
-- it once, at the end, so a half-finished lecture never looks like a fact.
create or replace function public.close_attendance_session(p_session_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  s       record;
  v_marked int := 0;
begin
  select * into s from public.attendance_sessions where id = p_session_id;
  if s.id is null then
    raise exception 'Register not found';
  end if;
  if not public.is_offering_staff(s.offering_id) then
    raise exception 'Only the lecturers assigned to this course can close this register';
  end if;

  with roster as (
    select st.id as student_id, o.course_id,
           (c.id is not null) as present
      from public.course_offerings o
      join public.enrollments e
        on e.course_id = o.course_id and e.status = 'enrolled'
      join public.students st on st.id = e.student_id
      left join public.attendance_checkins c
        on c.session_id = s.id and c.student_id = st.id
     where o.id = s.offering_id
  ), written as (
    insert into public.attendance
      (student_id, course_id, offering_id, lecture_date, status, recorded_by, method)
    select r.student_id, r.course_id, s.offering_id, s.lecture_date,
           case when r.present then 'present' else 'absent' end,
           auth.uid(), 'qr'
      from roster r
    on conflict do nothing
    returning 1
  )
  select count(*)::int into v_marked from written;

  update public.attendance_sessions
     set status = 'closed', closed_at = now(), closed_by = auth.uid()
   where id = p_session_id;

  return jsonb_build_object('ok', true, 'rows_written', v_marked);
end;
$$;

-- Which register, if any, is open for me to sign right now.
create or replace function public.my_open_attendance_sessions()
returns table(session_id uuid, course_code text, course_title text,
              closes_at timestamptz, already_checked_in boolean)
language sql stable security definer set search_path to 'public'
as $$
  select s.id, c.course_code, c.title, s.closes_at,
         exists (select 1 from public.attendance_checkins ck
                  where ck.session_id = s.id and ck.student_id = auth.uid())
    from public.attendance_sessions s
    join public.course_offerings o on o.id = s.offering_id
    join public.courses c on c.id = o.course_id
   where s.status = 'open'
     and now() between s.opens_at and s.closes_at
     and exists (select 1 from public.enrollments e
                  where e.student_id = auth.uid()
                    and e.course_id = o.course_id
                    and e.status = 'enrolled')
   order by s.closes_at;
$$;

grant execute on function public.start_attendance_session(uuid, integer, date) to authenticated;
grant execute on function public.extend_attendance_session(uuid, integer) to authenticated;
grant execute on function public.attendance_session_token(uuid) to authenticated;
grant execute on function public.check_in_to_lecture(text, text) to authenticated;
grant execute on function public.attendance_session_state(uuid) to authenticated;
grant execute on function public.close_attendance_session(uuid) to authenticated;
grant execute on function public.my_open_attendance_sessions() to authenticated;
