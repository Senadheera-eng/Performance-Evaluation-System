-- A register closed too soon can be reopened, until its attendance is saved.
--
-- Closing a register writes its marks at once; the lecturer then reads the
-- sheet, and the sign-ins the anomaly model lists, before saving it. A student
-- who arrived a minute late, or whose phone failed, could only be marked by
-- hand, or a second register opened that told every student to sign again.
-- Now the same register can be reopened: everyone already signed in stays
-- signed in, the class is told it is open again (notify_register_reopened,
-- which was waiting for exactly this), and closing it again adds the
-- newcomers. Closing only ever turns an absence into a presence.
--
-- Saving the sheet settles the lecture. From then on its register stays
-- closed, so a mark changed by hand (a flagged sign-in marked absent, say)
-- cannot be undone by the register's check-ins being written again. The
-- sheet's save calls note_attendance_saved to say so.
--
-- - attendance_sessions.saved_at / saved_by: when the lecture's sheet was
--   saved after its register closed, and by whom.
-- - attendance_reopen_blocker(session): why a register cannot be reopened,
--   or null when it can. Internal; the two functions below share it.
-- - get_lecture_register(offering, date): the latest register of a lecture,
--   for the page to offer Reopen or say why not.
-- - reopen_attendance_session(session, minutes): reopens it.
-- - note_attendance_saved(offering, date): settles the lecture's registers.

alter table public.attendance_sessions
  add column if not exists saved_at timestamptz,
  add column if not exists saved_by uuid references auth.users(id) on delete set null;

comment on column public.attendance_sessions.saved_at is
  'When the lecture''s attendance sheet was saved after this register closed. A saved register cannot be reopened.';

create or replace function public.attendance_reopen_blocker(p_session_id uuid)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  s record;
begin
  select * into s from public.attendance_sessions where id = p_session_id;
  if s.id is null then
    return 'Register not found';
  end if;
  if s.status = 'open' then
    return 'That register is already open';
  end if;
  if s.saved_at is not null then
    return 'The attendance for this lecture has been saved, so its register stays closed. Mark anyone who missed it by hand.';
  end if;
  if exists (select 1 from public.attendance_sessions o
              where o.offering_id = s.offering_id
                and o.lecture_date = s.lecture_date
                and o.opens_at > s.opens_at) then
    return 'A later register was opened for this lecture; reopen that one instead.';
  end if;
  if exists (select 1 from public.attendance_sessions o
              where o.offering_id = s.offering_id
                and o.status = 'open'
                and o.id <> s.id) then
    return 'Another register is open on this course. Close it first.';
  end if;
  -- Reopening is for the lecture that has just ended, not one from last week.
  if (coalesce(s.closed_at, s.closes_at) at time zone 'Asia/Colombo')::date
       <> (now() at time zone 'Asia/Colombo')::date then
    return 'A register can be reopened only on the day it closed.';
  end if;
  return null;
end;
$$;

create or replace function public.get_lecture_register(p_offering_id uuid, p_lecture_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  s          record;
  v_signed   integer;
  v_enrolled integer;
begin
  if not public.is_offering_staff(p_offering_id) then
    raise exception 'Only the lecturers assigned to this course can read its register';
  end if;

  select * into s
    from public.attendance_sessions
   where offering_id = p_offering_id and lecture_date = p_lecture_date
   order by opens_at desc
   limit 1;
  if s.id is null then
    return null;
  end if;

  select count(*)::int into v_signed
    from public.attendance_checkins where session_id = s.id;
  select count(*)::int into v_enrolled
    from public.course_offerings o
    join public.enrollments e on e.course_id = o.course_id and e.status = 'enrolled'
   where o.id = p_offering_id;

  return jsonb_build_object(
    'session_id',     s.id,
    'status',         s.status,
    'closed_at',      s.closed_at,
    'saved_at',       s.saved_at,
    'signed_in',      v_signed,
    'enrolled',       v_enrolled,
    'reopen_blocked', public.attendance_reopen_blocker(s.id));
end;
$$;

create or replace function public.reopen_attendance_session(p_session_id uuid, p_minutes integer default 5)
returns timestamptz
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  s        record;
  v_why    text;
  v_closes timestamptz;
begin
  -- Locked, so two lecturers pressing Reopen at once cannot both succeed.
  select * into s from public.attendance_sessions where id = p_session_id for update;
  if s.id is null then
    raise exception 'Register not found';
  end if;
  if not public.is_offering_staff(s.offering_id) then
    raise exception 'Only the lecturers assigned to this course can reopen this register';
  end if;
  if p_minutes is null or p_minutes < 1 or p_minutes > 60 then
    raise exception 'A scanning window runs between 1 and 60 minutes';
  end if;

  v_why := public.attendance_reopen_blocker(s.id);
  if v_why is not null then
    raise exception '%', v_why;
  end if;

  update public.attendance_sessions
     set status    = 'open',
         closes_at = now() + make_interval(mins => p_minutes),
         closed_at = null,
         closed_by = null
   where id = s.id
  returning closes_at into v_closes;

  return v_closes;
end;
$$;

create or replace function public.note_attendance_saved(p_offering_id uuid, p_lecture_date date)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_n integer;
begin
  if not public.is_offering_staff(p_offering_id) then
    raise exception 'Only the staff of this course can save its attendance';
  end if;

  update public.attendance_sessions
     set saved_at = now(), saved_by = auth.uid()
   where offering_id = p_offering_id
     and lecture_date = p_lecture_date
     and status = 'closed'
     and saved_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.attendance_reopen_blocker(uuid) from public, anon, authenticated;
revoke all on function public.get_lecture_register(uuid, date) from public, anon;
revoke all on function public.reopen_attendance_session(uuid, integer) from public, anon;
revoke all on function public.note_attendance_saved(uuid, date) from public, anon;
grant execute on function public.get_lecture_register(uuid, date) to authenticated;
grant execute on function public.reopen_attendance_session(uuid, integer) to authenticated;
grant execute on function public.note_attendance_saved(uuid, date) to authenticated;
