-- sidebar_notification_counts
-- Applied 20260822064701
-- Exported from the live project; do not edit by hand.

-- A student had no way to learn a feedback round had opened except by
-- visiting the page and looking. The same is true of a lecturer whose result
-- sheet was sent back, and of a department admin with forms waiting to be
-- approved.
--
-- One call, because the sidebar renders once and asking four questions to
-- draw four badges is four round trips on every page load. The role decides
-- what is counted; anyone with no outstanding work gets zeros.
--
-- Only things that CLEAR are counted. A badge that never goes away stops
-- being read, so "results were published" is not here — nothing marks it as
-- seen — while "a sheet came back to you" is, because resubmitting removes it.
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
begin
  -- ---------- student ----------
  if exists (select 1 from public.students s where s.id = auth.uid()) then
    select count(*)::int into v_feedback
      from public.get_student_feedback_catalogue()
     where submission_status <> 'submitted';

    return jsonb_build_object('feedback', v_feedback, 'results', 0, 'medical', 0);
  end if;

  -- ---------- lecturer, head of department included ----------
  if v_lecturer is not null then
    -- Sheets a department admin returned for correction.
    select count(distinct r.offering_id)::int into v_results
      from public.results r
      join public.course_lecturers cl
        on cl.offering_id = r.offering_id and cl.is_active
       and cl.lecturer_id = v_lecturer
     where r.status = 'draft' and coalesce(btrim(r.return_notes), '') <> '';

    -- Their own form requests the department sent back.
    select count(*)::int into v_feedback
      from public.feedback_periods p
     where p.created_by_lecturer_id = v_lecturer
       and p.approval_status = 'rejected';

    return jsonb_build_object('feedback', v_feedback, 'results', v_results, 'medical', 0);
  end if;

  -- ---------- department admin / super admin ----------
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

    return jsonb_build_object('feedback', v_feedback, 'results', v_results, 'medical', v_medical);
  end if;

  return jsonb_build_object('feedback', 0, 'results', 0, 'medical', 0);
end;
$$;

revoke execute on function public.get_my_notification_counts() from public, anon;
grant  execute on function public.get_my_notification_counts() to authenticated;
