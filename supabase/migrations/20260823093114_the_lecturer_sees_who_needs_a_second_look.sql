-- the_lecturer_sees_who_needs_a_second_look
-- Applied 20260823093114
-- Exported from the live project; do not edit by hand.

-- Widening those three functions left their narrower selves behind, and two
-- overloads of one name is a coin toss to a client that calls by name.
drop function if exists public.start_attendance_session(uuid, integer, date);
drop function if exists public.check_in_to_lecture(text, text);
drop function if exists public.check_in_with_code(text, text);

-- The roster the lecturer watches, now carrying what the extra layers found.
--
-- A student is 'present' the moment they scan and stays that way. Missing a
-- presence check, or scanning from half a mile off, does not move them: it
-- puts a word beside their name for the person at the front of the room to
-- read. A dead battery and a walk-out look identical from here, and only one
-- of them is the student's fault.
create or replace function public.attendance_session_state(p_session_id uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  s        record;
  v_rows   jsonb;
  v_checks int;
begin
  select * into s from public.attendance_sessions where id = p_session_id;
  if s.id is null then
    raise exception 'Register not found';
  end if;
  if not public.is_offering_staff(s.offering_id) then
    raise exception 'Only the lecturers assigned to this course can read this register';
  end if;

  -- Only checks that have run their course count against anyone; one still
  -- open is a question nobody has had time to answer.
  select count(*)::int into v_checks
    from public.attendance_presence_checks pc
   where pc.session_id = s.id
     and now() > pc.triggered_at + make_interval(secs => pc.window_seconds);

  select coalesce(jsonb_agg(t.r order by t.checked_in_at nulls last, t.index_number), '[]'::jsonb)
    into v_rows
    from (
      select c.checked_in_at, st.index_number,
             jsonb_build_object(
               'student_id',    st.id,
               'name',          st.name,
               'index_number',  st.index_number,
               'checked_in_at', c.checked_in_at,
               'distance_m',    c.distance_m,
               'flags',         to_jsonb(coalesce(c.flags, '{}'::text[])),
               'presence_answered',
                 (select count(*)::int
                    from public.attendance_presence_checks pc
                    join public.attendance_presence_responses pr
                      on pr.check_id = pc.id and pr.student_id = st.id
                   where pc.session_id = s.id
                     and now() > pc.triggered_at + make_interval(secs => pc.window_seconds))
             ) as r
        from public.course_offerings o
        join public.enrollments e
          on e.course_id = o.course_id and e.status = 'enrolled'
        join public.students st on st.id = e.student_id
        left join public.attendance_checkins c
          on c.session_id = s.id and c.student_id = st.id
       where o.id = s.offering_id
    ) t;

  return jsonb_build_object(
    'session_id',      s.id,
    'status',          s.status,
    'opens_at',        s.opens_at,
    'closes_at',       s.closes_at,
    'lecture_date',    s.lecture_date,
    'presence_checks', v_checks,
    'has_location',    (s.lat is not null),
    'students',        v_rows);
end;
$$;

-- A student cannot be told to scan if nothing tells them a register is open.
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

    -- Registers open right now that this student has not yet signed.
    select count(*)::int into v_attendance
      from public.my_open_attendance_sessions()
     where not already_checked_in;

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

    return jsonb_build_object('feedback', v_feedback, 'results', v_results,
                              'medical', 0, 'enrolment', 0, 'attendance', 0);
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
