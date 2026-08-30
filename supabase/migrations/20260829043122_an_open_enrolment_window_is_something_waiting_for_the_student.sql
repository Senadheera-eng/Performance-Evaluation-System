-- an_open_enrolment_window_is_something_waiting_for_the_student
-- Applied 20260829043122
-- Exported from the live project; do not edit by hand.

-- An open enrolment window is something waiting for the student.
--
-- The sidebar badge counted outstanding R and L modules and nothing else, so
-- a department could open enrolment for a whole semester and the only student
-- who saw a badge was one carrying a repeat. Everybody else found out by
-- opening the page on a hunch, or by missing the deadline.
--
-- What the badge counts is work still to do, not courses on offer: a student
-- never enrols in all fifteen, and a badge reading 15 would be noise. So it
-- counts the same things the page itself warns about before you confirm --
-- each compulsory course not yet selected, and each elective basket still
-- short of the credits it asks for. A student who has enrolled properly has
-- nothing outstanding and no badge, which is how a badge is supposed to
-- clear: you went to the page and did the thing.
--
-- A basket a student deliberately under-fills keeps its badge. That is the
-- honest reading -- the page says an unmet basket is a note and not a block,
-- and the badge says the same thing in the sidebar.

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
  v_plan       jsonb;
begin
  if exists (select 1 from public.students s where s.id = auth.uid()) then
    select count(*)::int into v_feedback
      from public.get_student_feedback_catalogue()
     where submission_status <> 'submitted';

    -- Modules owed from an earlier year, offered again right now.
    select count(*)::int into v_enrolment
      from public.get_my_enrolment_options()
     where kind <> 'regular' and not already_enrolled;

    -- This semester's own window, while it is open.
    v_plan := public.get_my_enrolment_plan();
    if coalesce((v_plan -> 'window' ->> 'is_open')::boolean, false) then
      select v_enrolment + coalesce(sum(outstanding), 0)::int into v_enrolment
        from (
          select case
            -- Every compulsory course is required, so each one still
            -- unticked is its own piece of work. A course already passed
            -- is not owed again.
            when b ->> 'basket' = 'Compulsory' then (
              select count(*)
                from jsonb_array_elements(b -> 'courses') c
               where not (c ->> 'selected')::boolean
                 and not (c ->> 'already_passed')::boolean)
            -- An elective basket is one decision however many courses sit
            -- in it, so a basket short of its credits counts once.
            when (b ->> 'required_credits') is not null
             and coalesce((b ->> 'selected_credits')::int, 0)
                 < (b ->> 'required_credits')::int
              then 1
            else 0
          end as outstanding
            from jsonb_array_elements(v_plan -> 'baskets') b
        ) work;
    end if;

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

grant execute on function public.get_my_notification_counts() to authenticated;
