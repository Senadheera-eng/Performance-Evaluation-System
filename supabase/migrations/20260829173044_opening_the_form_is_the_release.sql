-- opening_the_form_is_the_release
-- Applied 20260829173044
-- Exported from the live project; do not edit by hand.

-- Opening the form is the release.
--
-- Results used to sit behind a second gate: after a period closed, a
-- department admin went down a list of courses and released each one to its
-- lecturer. That is a step whose only output is a delay. The department has
-- already decided to run the round and already decided when it ends; asking
-- them to decide a third time, per course, added no judgement and meant a
-- lecturer's own students' feedback could sit unread because a list did not
-- get worked through.
--
-- So the gate is the period itself. Once a form is open, the coordinator sees
-- their results as they arrive; when it closes, the same results become the
-- final report. What does not change is the privacy floor -- below the
-- threshold a course still shows only how many people replied, never what
-- they said, because a report drawn from two responses is a report about two
-- identifiable students.

drop function if exists public.release_feedback(uuid, uuid, text);
drop function if exists public.withdraw_feedback_release(uuid, uuid);
drop function if exists public.get_releasable_feedback();

drop function if exists public.get_my_feedback_overview();

create function public.get_my_feedback_overview()
returns table(
  period_id uuid, period_title text, period_status text, feedback_type text,
  offering_id uuid, course_code text, course_title text,
  semester integer, batch_year integer,
  eligible_count integer, response_count integer, response_rate numeric,
  results_visible boolean, below_threshold boolean, avg_rating numeric)
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_lecturer  uuid;
  v_threshold int;
begin
  v_lecturer := public.my_lecturer_id();
  if v_lecturer is null then
    return;
  end if;
  v_threshold := public.feedback_privacy_threshold();

  return query
  with mine as (
    select cl.offering_id, o.course_id, o.batch_year, o.department, c.course_code,
           c.title as course_title, c.semester
      from public.course_lecturers cl
      join public.course_offerings o on o.id = cl.offering_id
      join public.courses c          on c.id = o.course_id
     where cl.lecturer_id = v_lecturer and cl.is_active
  ),
  pairs as (
    select p.id as period_id, p.title, p.status, p.feedback_type, m.*
      from mine m
      join public.feedback_period_courses fpc on fpc.course_id = m.course_id
      join public.feedback_periods p          on p.id = fpc.feedback_period_id
     where p.batch_year is null or p.batch_year = m.batch_year
  ),
  counted as (
    select pr.*,
           (select count(*)::int from public.students s
             where s.role = 'student' and s.status = 'active'
               and s.batch_year = pr.batch_year
               and public.student_took_course(s.id, pr.course_id)) as eligible,
           (select count(*)::int from public.feedback_submissions fs
             where fs.feedback_period_id = pr.period_id
               and fs.course_id = pr.course_id
               and fs.status = 'submitted')                         as responses
      from pairs pr
  )
  select c.period_id, c.title, c.status, c.feedback_type, c.offering_id,
         c.course_code, c.course_title, c.semester, c.batch_year,
         c.eligible, c.responses,
         case when c.eligible > 0
              then round((c.responses::numeric / c.eligible) * 100, 1) else 0 end,
         -- Answering has begun, and enough people have answered to hide
         -- behind each other.
         c.status in ('open', 'closed', 'archived') and c.responses >= v_threshold,
         c.responses < v_threshold,
         -- Response progress is never withheld: knowing how many people
         -- replied identifies nobody, and a lecturer watching the count come
         -- in is the whole reason to show results live.
         case
           when c.status in ('open', 'closed', 'archived')
                and c.responses >= v_threshold
           then (select round(avg(fa.rating_value)::numeric, 2)
                   from public.feedback_answers fa
                   join public.feedback_submissions fs on fs.id = fa.submission_id
                  where fs.feedback_period_id = c.period_id
                    and fs.course_id = c.course_id
                    and fs.status = 'submitted'
                    and fa.rating_value is not null
                    and (fa.lecturer_target_id is null
                         or fa.lecturer_target_id = v_lecturer))
           else null
         end
    from counted c
   order by c.batch_year desc, c.semester desc, c.course_code;
end;
$$;

grant execute on function public.get_my_feedback_overview() to authenticated;

-- The head of department reads the same rule, and loses the release column
-- that no longer has anything behind it.
drop function if exists public.get_department_feedback_overview(uuid);

create function public.get_department_feedback_overview(p_period_id uuid default null)
returns table(
  period_id uuid, period_title text, period_status text, feedback_type text,
  offering_id uuid, course_code text, course_title text,
  semester integer, batch_year integer, lecturers text,
  eligible_count integer, response_count integer, response_rate numeric,
  results_visible boolean, below_threshold boolean, avg_rating numeric)
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_department text;
  v_threshold  int;
begin
  v_department := public.my_hod_department();
  if v_department is null then
    if coalesce(public.get_my_role(), '') <> 'super_admin' then
      raise exception 'Only a head of department can see department-wide feedback';
    end if;
  end if;
  v_threshold := public.feedback_privacy_threshold();

  return query
  with offerings as (
    select o.id as offering_id, o.course_id, o.batch_year, c.course_code,
           c.title as course_title, c.semester
      from public.course_offerings o
      join public.courses c on c.id = o.course_id
     where v_department is null or o.department = v_department
  ),
  pairs as (
    select p.id as period_id, p.title, p.status, p.feedback_type, o.*
      from offerings o
      join public.feedback_period_courses fpc on fpc.course_id = o.course_id
      join public.feedback_periods p          on p.id = fpc.feedback_period_id
     where (p_period_id is null or p.id = p_period_id)
       and p.status <> 'draft'
       and (p.batch_year is null or p.batch_year = o.batch_year)
  ),
  counted as (
    select pr.*,
           (select count(*)::int from public.students s
             where s.role = 'student' and s.status = 'active'
               and s.batch_year = pr.batch_year
               and public.student_took_course(s.id, pr.course_id))  as eligible,
           (select count(*)::int from public.feedback_submissions fs
             where fs.feedback_period_id = pr.period_id
               and fs.course_id = pr.course_id
               and fs.status = 'submitted')                          as responses,
           (select string_agg(coalesce(l.title || ' ', '') || l.name, ', '
                              order by cl.assignment_role desc, l.name)
              from public.course_lecturers cl
              join public.lecturers l on l.id = cl.lecturer_id
             where cl.offering_id = pr.offering_id and cl.is_active) as lecturer_names
      from pairs pr
  )
  select c.period_id, c.title, c.status, c.feedback_type, c.offering_id,
         c.course_code, c.course_title, c.semester, c.batch_year,
         c.lecturer_names,
         c.eligible, c.responses,
         case when c.eligible > 0
              then round((c.responses::numeric / c.eligible) * 100, 1) else 0 end,
         c.status in ('open', 'closed', 'archived') and c.responses >= v_threshold,
         c.responses < v_threshold,
         case
           when c.status in ('open', 'closed', 'archived')
                and c.responses >= v_threshold
           then (select round(avg(fa.rating_value)::numeric, 2)
                   from public.feedback_answers fa
                   join public.feedback_submissions fs on fs.id = fa.submission_id
                  where fs.feedback_period_id = c.period_id
                    and fs.course_id = c.course_id
                    and fs.status = 'submitted'
                    and fa.rating_value is not null)
           else null
         end
    from counted c
   order by c.batch_year desc, c.semester desc, c.course_code;
end;
$$;

grant execute on function public.get_department_feedback_overview(uuid) to authenticated;

-- The admin's badge counted courses waiting to be released. With no release
-- step there is nothing there to count, and what is left is the one thing
-- that genuinely waits on them: a lecturer's period asking for approval.
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

    -- A draft form is the coordinator's window to add their own questions,
    -- and it closes the moment the department opens the round.
    select v_feedback + count(*)::int into v_feedback
      from public.get_my_coordinated_feedback()
     where period_status = 'draft';

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

-- Nothing reads the release ledger now.
drop function if exists public.feedback_is_released(uuid, uuid);
drop table if exists public.feedback_releases;
