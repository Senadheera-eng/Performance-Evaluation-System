-- notify_students_of_repeat_enrolment
-- Applied 20260822130322
-- Exported from the live project; do not edit by hand.

-- A repeat student had no way to learn that the window carrying their module
-- had opened: it belongs to another batch, so nothing on their own pages
-- referred to it. The sidebar now carries the count, the same way an
-- unanswered feedback form does.
--
-- Counted only while it can still be acted on — an outstanding module that is
-- open for enrolment and not yet taken. Once enrolled, or once the window
-- closes, it clears.
create or replace function public.get_my_notification_counts()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_role       text := coalesce(public.get_my_role(), '');
  v_lecturer   uuid := public.my_lecturer_id();
  v_department text := public.get_my_department();
  v_feedback   int  := 0;
  v_results    int  := 0;
  v_medical    int  := 0;
  v_enrolment  int  := 0;
begin
  if exists (select 1 from public.students s where s.id = auth.uid()) then
    select count(*)::int into v_feedback
      from public.get_student_feedback_catalogue()
     where submission_status <> 'submitted';

    select count(*)::int into v_enrolment
      from public.get_my_enrolment_options()
     where kind <> 'regular' and not already_enrolled;

    return jsonb_build_object('feedback', v_feedback, 'results', 0,
                              'medical', 0, 'enrolment', v_enrolment);
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
                              'medical', 0, 'enrolment', 0);
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
                              'medical', v_medical, 'enrolment', 0);
  end if;

  return jsonb_build_object('feedback', 0, 'results', 0, 'medical', 0, 'enrolment', 0);
end;
$$;

revoke execute on function public.get_my_notification_counts() from public, anon;
grant  execute on function public.get_my_notification_counts() to authenticated;
