-- a_register_outlives_the_browser_tab_that_opened_it
-- Applied 20260823101252
-- Exported from the live project; do not edit by hand.

-- A register lived in one browser tab and nowhere else.
--
-- The session id was React state. Log out, close the laptop, or open the page
-- on the podium machine instead of your own, and the register was still open
-- in the database with students signing into it -- but no screen anywhere
-- could show it, extend it, or close it. The check-ins simply never became
-- attendance.
--
-- Three things follow from that, and they are all the same mistake: the
-- server knows a register is open and nothing asked it.

-- Which register, if any, is already open on this course. The lecturer's
-- screen asks this before offering to open a new one.
create or replace function public.open_register_for_offering(p_offering_id uuid)
returns uuid
language sql stable security definer set search_path to 'public'
as $$
  select s.id
    from public.attendance_sessions s
   where s.offering_id = p_offering_id
     and s.status = 'open'
     and public.is_offering_staff(s.offering_id)
   order by s.opens_at desc
   limit 1;
$$;

-- Registers left open on any course this person teaches. A forgotten one is
-- not harmless: its check-ins are sitting there as evidence of a lecture that
-- was never recorded.
create or replace function public.my_unclosed_registers()
returns table(session_id uuid, offering_id uuid, course_code text,
              lecture_date date, closes_at timestamptz,
              checked_in integer, window_passed boolean)
language sql stable security definer set search_path to 'public'
as $$
  select s.id, s.offering_id, c.course_code, s.lecture_date, s.closes_at,
         (select count(*)::int from public.attendance_checkins ck
           where ck.session_id = s.id),
         (now() > s.closes_at)
    from public.attendance_sessions s
    join public.course_offerings o on o.id = s.offering_id
    join public.courses c on c.id = o.course_id
   where s.status = 'open'
     and public.is_offering_staff(s.offering_id)
   order by s.opens_at;
$$;

-- Opening one is now idempotent, and refuses rather than discarding.
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
  v_open    record;
  v_signed  int;
  v_id      uuid;
begin
  if not public.is_offering_staff(p_offering_id) then
    raise exception 'Only the lecturers assigned to this course can open a register';
  end if;
  if p_minutes < 1 or p_minutes > 60 then
    raise exception 'A scanning window runs between 1 and 60 minutes';
  end if;

  select * into v_open
    from public.attendance_sessions
   where offering_id = p_offering_id and status = 'open'
   order by opens_at desc limit 1;

  if v_open.id is not null then
    select count(*)::int into v_signed
      from public.attendance_checkins where session_id = v_open.id;

    -- Still running, or students have already signed it: hand back the one
    -- that exists rather than opening a second or throwing it away.
    if now() <= v_open.closes_at or v_signed > 0 then
      return v_open.id;
    end if;

    -- Expired and nobody signed it, so there is nothing to lose.
    update public.attendance_sessions
       set status = 'closed', closed_at = now(), closed_by = auth.uid()
     where id = v_open.id;
  end if;

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

-- Closing no longer walks past a student who was already marked.
--
-- attendance is unique on (student, course, date), so the old insert simply
-- skipped anyone the lecturer had marked by hand -- their scan was thrown
-- away, and a register closed over a saved sheet reported writing nothing at
-- all. A scan now updates that row.
--
-- Two things it will not do: overwrite an excused student, because a medical
-- certificate outranks a lecture register, and mark absent over an existing
-- row, because the lecturer had a reason for whatever is there.
create or replace function public.close_attendance_session(p_session_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  s         record;
  v_present int := 0;
  v_absent  int := 0;
  v_written int := 0;
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
    on conflict (student_id, course_id, lecture_date) do update
       set status      = excluded.status,
           offering_id = excluded.offering_id,
           recorded_by = excluded.recorded_by,
           method      = excluded.method,
           recorded_at = now()
     where excluded.status = 'present'
       and public.attendance.status is distinct from 'excused'
    returning status
  )
  select count(*) filter (where status = 'present')::int,
         count(*) filter (where status = 'absent')::int,
         count(*)::int
    into v_present, v_absent, v_written
    from written;

  update public.attendance_sessions
     set status = 'closed', closed_at = now(), closed_by = auth.uid()
   where id = p_session_id;

  return jsonb_build_object('ok', true, 'rows_written', v_written,
                            'present', v_present, 'absent', v_absent);
end;
$$;

-- A presence check has ninety seconds on it, so the badge that carries a
-- student to the page has to count it too.
create or replace function public.get_my_notification_counts()
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_role       text := coalesce(public.get_my_role(), '');
  v_lecturer   uuid := public.my_lecturer_id();
  v_department text := public.get_my_department();
  v_feedback   int  := 0;
  v_results    int  := 0;
  v_medical    int  := 0;
  v_enrolment  int  := 0;
  v_attendance int  := 0;
begin
  if exists (select 1 from public.students s where s.id = auth.uid()) then
    select count(*)::int into v_feedback
      from public.get_student_feedback_catalogue()
     where submission_status <> 'submitted';

    select count(*)::int into v_enrolment
      from public.get_my_enrolment_options()
     where kind <> 'regular' and not already_enrolled;

    select count(*)::int into v_attendance
      from public.my_open_attendance_sessions()
     where not already_checked_in;

    if (public.my_pending_presence_check() ->> 'pending')::boolean then
      v_attendance := v_attendance + 1;
    end if;

    return jsonb_build_object('feedback', v_feedback, 'results', 0,
                              'medical', 0, 'enrolment', v_enrolment,
                              'attendance', v_attendance);
  end if;

  if v_lecturer is not null then
    select count(distinct r.offering_id)::int into v_results
      from public.results r
      join public.course_lecturers cl
        on cl.offering_id = r.offering_id and cl.is_active
       and cl.lecturer_id = v_lecturer
     where r.status = 'draft' and coalesce(btrim(r.return_notes), '') <> '';

    select count(*)::int into v_feedback
      from public.feedback_periods p
     where p.created_by_lecturer_id = v_lecturer
       and p.approval_status = 'rejected';

    -- A register left open is the lecturer's to close, and nothing else was
    -- ever going to remind them.
    select count(*)::int into v_attendance from public.my_unclosed_registers();

    return jsonb_build_object('feedback', v_feedback, 'results', v_results,
                              'medical', 0, 'enrolment', 0,
                              'attendance', v_attendance);
  end if;

  if v_role in ('dept_admin', 'super_admin') then
    select count(*)::int into v_feedback
      from public.feedback_periods p
     where p.approval_status = 'pending'
       and (v_role = 'super_admin' or p.department = v_department);

    select v_feedback + count(*)::int into v_feedback
      from public.get_releasable_feedback() g
     where not g.is_released;

    select count(distinct r.offering_id)::int into v_results
      from public.results r
      join public.course_offerings o on o.id = r.offering_id
     where r.status = 'submitted'
       and (v_role = 'super_admin' or o.department = v_department);

    select count(*)::int into v_medical
      from public.medical_submission_courses mc
     where mc.review_status = 'pending'
       and (v_role = 'super_admin' or mc.department = v_department);

    return jsonb_build_object('feedback', v_feedback, 'results', v_results,
                              'medical', v_medical, 'enrolment', 0,
                              'attendance', 0);
  end if;

  return jsonb_build_object('feedback', 0, 'results', 0, 'medical', 0,
                            'enrolment', 0, 'attendance', 0);
end;
$$;

grant execute on function public.open_register_for_offering(uuid) to authenticated;
grant execute on function public.my_unclosed_registers() to authenticated;
