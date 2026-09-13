/*
  The Notices item in the sidebar never showed a count, because nothing was
  counting notices. get_my_notification_counts predates the notice board and
  returns six keys; the navigation maps counts to routes by href and had no
  case for /notices, so a student could have a new examination timetable
  waiting and the only sign of it was the bell.

  Every other badge here is a piece of STATE — work outstanding, which clears
  when the work is done. A notice has no such state: there is nothing for a
  student to do to a timetable, so "unfinished notices" is not a thing that
  exists to count.

  What does exist is whether they have seen it. So this one badge is derived
  from the notification the publication already raised, and it clears the way
  reading clears anything else — opening the notice marks its notification
  read, and the count goes down. That is a deliberate exception to the
  state-not-events rule the notifications table is documented with, and it is
  the exception because for this module the event IS the state.
*/

create or replace function public.get_my_notification_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_role       text := coalesce(public.get_my_role(), '');
  v_lecturer   uuid := public.my_lecturer_id();
  v_department text := public.get_my_department();
  v_feedback   int  := 0;
  v_results    int  := 0;
  v_medical    int  := 0;
  v_enrolment  int  := 0;
  v_attendance int  := 0;
  v_mentoring  int  := 0;
  v_notices    int  := 0;
  v_plan       jsonb;
begin
  v_mentoring := public.my_unread_mentor_messages();

  /* Unread notice notifications, for whoever is asking. Counted once here
     rather than per branch, because a notice can be addressed to anybody. */
  select count(*)::int into v_notices
    from public.notifications n
   where n.recipient_id = auth.uid()
     and n.source = 'notices'
     and n.read_at is null;

  if exists (select 1 from public.students s where s.id = auth.uid()) then
    select count(*)::int into v_feedback
      from public.get_student_feedback_catalogue()
     where submission_status <> 'submitted';

    select count(*)::int into v_enrolment
      from public.get_my_enrolment_options()
     where kind <> 'regular' and not already_enrolled;

    v_plan := public.get_my_enrolment_plan();
    if coalesce((v_plan -> 'window' ->> 'is_open')::boolean, false) then
      select v_enrolment + coalesce(sum(outstanding), 0)::int into v_enrolment
        from (
          select case
            when b ->> 'basket' = 'Compulsory' then (
              select count(*)
                from jsonb_array_elements(b -> 'courses') c
               where not (c ->> 'selected')::boolean
                 and not (c ->> 'already_passed')::boolean
                 and (c ->> 'enrollable')::boolean)
            when (b ->> 'required_credits') is not null
             and coalesce((b ->> 'selected_credits')::int, 0)
               + coalesce((b ->> 'earned_credits')::int, 0)
                 < (b ->> 'required_credits')::int
             and (b ->> 'offered_now')::boolean
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
                              'attendance', v_attendance,
                              'mentoring', v_mentoring,
                              'notices', v_notices);
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

    select v_feedback + count(*)::int into v_feedback
      from public.get_my_coordinated_feedback()
     where period_status = 'draft';

    select count(*)::int into v_attendance from public.my_unclosed_registers();

    return jsonb_build_object('feedback', v_feedback, 'results', v_results,
                              'medical', 0, 'enrolment', 0,
                              'attendance', v_attendance,
                              'mentoring', v_mentoring,
                              'notices', v_notices);
  end if;

  if v_role in ('dept_admin', 'super_admin') then
    select count(*)::int into v_feedback
      from public.feedback_periods p
     where p.approval_status = 'pending'
       and (v_role = 'super_admin' or p.department = v_department);

    select count(distinct r.offering_id)::int into v_results
      from public.results r
      join public.course_offerings o on o.id = r.offering_id
     where r.status = 'submitted'
       and (v_role = 'super_admin' or o.department = v_department);

    select count(*)::int into v_medical
      from public.medical_submission_courses mc
     where mc.review_status = 'pending'
       and (v_role = 'super_admin' or mc.department = v_department);

    /* An admin's Notices screen is for publishing, not for reading a board,
       so a count of unread notices on it would be an interruption with
       nothing behind it. Drafts they left unfinished are the useful signal. */
    select count(*)::int into v_notices
      from public.notices n
     where n.created_by = auth.uid() and n.status = 'draft';

    return jsonb_build_object('feedback', v_feedback, 'results', v_results,
                              'medical', v_medical, 'enrolment', 0,
                              'attendance', 0, 'mentoring', 0,
                              'notices', v_notices);
  end if;

  return jsonb_build_object('feedback', 0, 'results', 0, 'medical', 0,
                            'enrolment', 0, 'attendance', 0,
                            'mentoring', v_mentoring,
                            'notices', v_notices);
end;
$function$;