-- the_sheet_says_which_courses_this_round_is_actually_offering
-- Applied 20260829043512
-- Exported from the live project; do not edit by hand.

-- The sheet says which courses this round is actually offering.
--
-- A semester's curriculum and a semester's enrolment window are not the same
-- list. Computer Engineering's Semester 7 includes the Elective (1) language
-- and general-studies courses, which live at Semester 5 in the catalogue; a
-- window opened for Semester 7 covers courses by their own semester, so it
-- does not carry them. The page showed all fifteen with a live checkbox, and
-- ticking one of the four the window does not carry produced an error on
-- Save that named the course and explained nothing.
--
-- So the plan now says, per course, whether it can be enrolled in right now.
-- A course in the curriculum but not in this round stays on the sheet -- a
-- student should see the whole semester as the handbook prints it -- but it
-- is shown as not offered rather than offered and then refused.
--
-- The sidebar badge follows the same line. A badge counts work the student
-- can actually do; counting a basket no open window can satisfy would leave a
-- number sitting there that nothing they did could ever clear.

create or replace function public.get_my_enrolment_plan()
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_student  record;
  v_sem      integer;
  v_dept_key text;
  v_year     text;
  v_win_year text;
  v_baskets  jsonb;
  v_minors   jsonb;
  v_window   jsonb;
begin
  select s.id, s.batch_year, s.department into v_student
    from public.students s where s.id = auth.uid();
  if v_student.id is null then
    raise exception 'Only a student has an enrolment plan';
  end if;

  v_sem := public.current_semester_for_batch(v_student.batch_year);
  v_dept_key := case when v_sem <= 2 then 'COMMON' else v_student.department end;
  v_year := (v_student.batch_year + ceil(v_sem / 2.0)::int - 1)::text || '/'
          || (v_student.batch_year + ceil(v_sem / 2.0)::int)::text;

  -- The open window for this semester if there is one; otherwise the last one
  -- there was, so the page can say when it closed rather than going quiet.
  select to_jsonb(w), w.academic_year into v_window, v_win_year
    from (select p.id as period_id, p.title, p.opens_at, p.closes_at,
                 p.academic_year,
                 (p.status = 'open' and now() between p.opens_at and p.closes_at)
                   as is_open
            from public.enrollment_periods p
           where (p.department is null or p.department = v_student.department)
             and p.semester = v_sem
           order by (p.status = 'open' and now() between p.opens_at and p.closes_at) desc,
                    p.closes_at desc
           limit 1) w;

  -- Which year's enrolments this page is about. The window's own year, when
  -- there is one -- an admin may run a semester under a label that does not
  -- match the arithmetic, and the enrolments follow the window.
  v_win_year := coalesce(v_win_year, v_year);

  with slot as (
    select s.basket, s.required_credits, c.id as course_id, c.course_code,
           c.title, c.credits, c.contributes_to_gpa, c.minor_category,
           exists (select 1 from public.enrollments e
                    where e.student_id = v_student.id
                      and e.course_id = c.id
                      and e.academic_year = v_win_year
                      and e.status = 'enrolled') as selected,
           -- A pass is a pass whenever it was earned.
           exists (select 1 from public.results r
                    where r.student_id = v_student.id
                      and r.course_id = c.id
                      and r.is_published
                      and r.grade not in ('R', 'L', 'F')) as already_passed,
           -- A mark against the attempt in progress, published or not: from
           -- there the choice is no longer the student's to take back.
           exists (select 1 from public.results r
                    where r.student_id = v_student.id
                      and r.course_id = c.id
                      and r.academic_year = v_win_year) as locked,
           -- The one authority on whether a tick will be accepted, asked here
           -- so the checkbox and the Save button cannot disagree.
           public.enrolment_kind_for_course(c.id) is not null as enrollable
      from public.curriculum_slots s
      join public.courses c on c.id = s.course_id
     where s.department = v_dept_key and s.semester = v_sem
  )
  select jsonb_agg(b order by b->>'sort_key')
    into v_baskets
    from (
      select jsonb_build_object(
               'sort_key', case when basket = 'Compulsory' then '0'
                                when basket = 'Optional' then '2' else '1' end || basket,
               'basket', basket,
               'required_credits', max(required_credits),
               'selected_credits',
                 coalesce(sum(credits) filter (where selected), 0),
               'available_credits', sum(credits),
               -- Whether this round can satisfy the basket at all, so the
               -- page can say so once rather than on every row.
               'offered_now',
                 coalesce(bool_or(enrollable and not selected and not already_passed), false),
               'courses', jsonb_agg(jsonb_build_object(
                   'course_id', course_id, 'course_code', course_code,
                   'title', title, 'credits', credits,
                   'contributes_to_gpa', contributes_to_gpa,
                   'minor', minor_category,
                   'selected', selected,
                   'already_passed', already_passed,
                   'locked', locked,
                   'enrollable', enrollable)
                 order by course_code)) as b
        from slot
       group by basket
    ) t;

  select jsonb_agg(jsonb_build_object(
           'minor', m.minor,
           'required_credits', m.required_credits,
           'earned_credits', coalesce(e.earned, 0),
           'selected_credits', coalesce(e.selected, 0),
           'status', case
             when coalesce(e.earned, 0) + coalesce(e.selected, 0) >= m.required_credits
               then 'complete'
             when coalesce(e.earned, 0) + coalesce(e.selected, 0) > 0 then 'partial'
             else 'none' end)
         order by m.minor)
    into v_minors
    from public.minor_requirements m
    left join lateral (
      select sum(c.credits) filter (
               where exists (select 1 from public.results r
                              where r.student_id = v_student.id and r.course_id = c.id
                                and r.is_published and r.grade not in ('R','L','F'))) as earned,
             sum(c.credits) filter (
               where exists (select 1 from public.enrollments en
                              where en.student_id = v_student.id and en.course_id = c.id
                                and en.status = 'enrolled')
                 and not exists (select 1 from public.results r
                                  where r.student_id = v_student.id and r.course_id = c.id
                                    and r.is_published and r.grade not in ('R','L','F'))) as selected
        from public.courses c
       where c.minor_category = m.minor and c.department = m.department
    ) e on true
   where m.department = v_student.department;

  return jsonb_build_object(
    'semester',      v_sem,
    'academic_year', v_year,
    'department',    v_student.department,
    'curriculum_of', v_dept_key,
    'window',        v_window,
    'baskets',       coalesce(v_baskets, '[]'::jsonb),
    'minors',        coalesce(v_minors, '[]'::jsonb));
end;
$$;

grant execute on function public.get_my_enrolment_plan() to authenticated;

-- The badge counts only what an open window can actually deliver.
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
            -- unticked is its own piece of work -- provided this round is
            -- carrying it, and it is not already passed.
            when b ->> 'basket' = 'Compulsory' then (
              select count(*)
                from jsonb_array_elements(b -> 'courses') c
               where not (c ->> 'selected')::boolean
                 and not (c ->> 'already_passed')::boolean
                 and (c ->> 'enrollable')::boolean)
            -- An elective basket is one decision however many courses sit in
            -- it, so a basket short of its credits counts once -- and only
            -- while there is something in it left to tick.
            when (b ->> 'required_credits') is not null
             and coalesce((b ->> 'selected_credits')::int, 0)
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
