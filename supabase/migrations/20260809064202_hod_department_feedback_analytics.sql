-- hod_department_feedback_analytics
-- Applied 20260809064202
-- Exported from the live project; do not edit by hand.

-- What a head of department sees about feedback across their department.
--
-- A lecturer sees their own courses, and only once the department releases
-- them. A head of department is accountable for the teaching in the whole
-- department, so the scope is every offering it owns and the gate is the
-- period being closed rather than a release — releasing is the act of
-- forwarding results to the individual being rated, which is a different
-- decision from the department looking at its own teaching.
--
-- Two rules do not move. Nothing is shown while a period is still open: a
-- partial return is a misleading one, exactly as it is for a lecturer. And
-- the minimum-response threshold applies here too — it exists to stop a
-- single student being identified from their answers, which is a protection
-- owed to the student regardless of who is reading.

/** Every offering in the caller's department covered by a feedback period. */
create or replace function public.get_department_feedback_overview(
  p_period_id uuid default null
)
returns table (
  period_id        uuid,
  period_title     text,
  period_status    text,
  feedback_type    text,
  offering_id      uuid,
  course_code      text,
  course_title     text,
  semester         integer,
  batch_year       integer,
  lecturers        text,
  eligible_count   integer,
  response_count   integer,
  response_rate    numeric,
  results_visible  boolean,
  below_threshold  boolean,
  is_released      boolean,
  avg_rating       numeric
)
language plpgsql
stable security definer
set search_path to 'public'
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
         c.status in ('closed', 'archived') and c.responses >= v_threshold,
         c.responses < v_threshold,
         public.feedback_is_released(c.period_id, c.offering_id),
         case
           when c.status in ('closed', 'archived') and c.responses >= v_threshold
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

/** Each lecturer in the department, side by side.
 *
 *  The average covers only the questions asked *about that lecturer*, so a
 *  course taught by three people gives three separate readings rather than
 *  one shared course score — which is the whole reason answers carry a
 *  lecturer target. Offerings below the response threshold are excluded from
 *  the average and reported separately, so a number is never quietly built
 *  from a handful of replies. */
create or replace function public.get_department_lecturer_feedback(
  p_period_id uuid default null
)
returns table (
  lecturer_id       uuid,
  lecturer_name     text,
  is_hod            boolean,
  course_count      integer,
  courses_counted   integer,
  courses_withheld  integer,
  response_count    integer,
  rated_answers     integer,
  avg_rating        numeric
)
language plpgsql
stable security definer
set search_path to 'public'
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
  with scoped as (
    select cl.lecturer_id, o.id as offering_id, o.course_id, p.id as period_id,
           (select count(*)::int from public.feedback_submissions fs
             where fs.feedback_period_id = p.id and fs.course_id = o.course_id
               and fs.status = 'submitted') as responses,
           p.status
      from public.course_offerings o
      join public.course_lecturers cl on cl.offering_id = o.id and cl.is_active
      join public.feedback_period_courses fpc on fpc.course_id = o.course_id
      join public.feedback_periods p on p.id = fpc.feedback_period_id
     where (v_department is null or o.department = v_department)
       and (p_period_id is null or p.id = p_period_id)
       and p.status <> 'draft'
       and (p.batch_year is null or p.batch_year = o.batch_year)
  ),
  visible as (
    select s.*, (s.status in ('closed', 'archived') and s.responses >= v_threshold) as counts
      from scoped s
  ),
  rated as (
    select v.lecturer_id,
           count(fa.id)::int              as answers,
           avg(fa.rating_value)::numeric  as avg_rating
      from visible v
      join public.feedback_submissions fs
        on fs.feedback_period_id = v.period_id and fs.course_id = v.course_id
       and fs.status = 'submitted'
      join public.feedback_answers fa
        on fa.submission_id = fs.id
       and fa.lecturer_target_id = v.lecturer_id
       and fa.rating_value is not null
     where v.counts
     group by v.lecturer_id
  )
  select l.id,
         coalesce(l.title || ' ', '') || l.name,
         public.is_active_hod_of(l.department) and l.id = public.my_lecturer_id(),
         count(distinct v.offering_id)::int,
         count(distinct v.offering_id) filter (where v.counts)::int,
         count(distinct v.offering_id) filter (where not v.counts)::int,
         coalesce(sum(v.responses) filter (where v.counts), 0)::int,
         coalesce(max(r.answers), 0),
         case when max(r.answers) > 0 then round(max(r.avg_rating), 2) else null end
    from visible v
    join public.lecturers l on l.id = v.lecturer_id
    left join rated r on r.lecturer_id = v.lecturer_id
   group by l.id, l.title, l.name, l.department
   order by 9 desc nulls last, 2;
end;
$$;

/** One offering, question by question, with the lecturer-targeted questions
 *  broken out per lecturer rather than filtered to the caller. That split is
 *  the comparison a head of department needs and the one a lecturer must not
 *  have: a lecturer sees their own ratings and nobody else's. */
create or replace function public.get_department_feedback_detail(
  p_period_id uuid,
  p_offering_id uuid
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_department text;
  v_course     uuid;
  v_status     text;
  v_threshold  int;
  v_responses  int;
  v_course_q   jsonb;
  v_lecturer_q jsonb;
  v_comments   jsonb;
begin
  v_department := public.offering_department(p_offering_id);
  if not (public.is_active_hod_of(v_department)
          or coalesce(public.get_my_role(), '') = 'super_admin') then
    raise exception 'Only the head of this department can see these results';
  end if;

  select course_id into v_course from public.course_offerings where id = p_offering_id;
  select status into v_status from public.feedback_periods where id = p_period_id;
  v_threshold := public.feedback_privacy_threshold();

  select count(*)::int into v_responses
    from public.feedback_submissions fs
   where fs.feedback_period_id = p_period_id and fs.course_id = v_course
     and fs.status = 'submitted';

  if v_status not in ('closed', 'archived') then
    return jsonb_build_object('visible', false, 'response_count', v_responses,
      'message', 'This feedback period is still open. Results appear once it closes.');
  end if;

  if v_responses < v_threshold then
    return jsonb_build_object('visible', false, 'response_count', v_responses,
      'below_threshold', true, 'threshold', v_threshold,
      'message', format('Detail is hidden below %s responses, so an individual reply cannot be identified.', v_threshold));
  end if;

  select jsonb_agg(jsonb_build_object(
           'question_id', q.id, 'question_text', q.question_text,
           'question_type', q.question_type, 'section_title', q.section_title,
           'responses', q.n, 'average', q.avg_rating, 'distribution', q.distribution)
         order by q.section_order, q.display_order)
    into v_course_q
  from (
    select fq.id, fq.question_text, fq.question_type, fq.section_title,
           fq.section_order, fq.display_order,
           count(fa.id)::int as n,
           round(avg(fa.rating_value)::numeric, 2) as avg_rating,
           coalesce(jsonb_object_agg(x.val, x.cnt) filter (where x.val is not null), '{}'::jsonb) as distribution
      from public.feedback_questions fq
      join public.feedback_period_questions fpq
        on fpq.question_id = fq.id and fpq.feedback_period_id = p_period_id
      left join public.feedback_answers fa on fa.question_id = fq.id
        and fa.submission_id in (
          select fs.id from public.feedback_submissions fs
           where fs.feedback_period_id = p_period_id and fs.course_id = v_course
             and fs.status = 'submitted')
      left join lateral (
        select coalesce(fa.rating_value::text, fa.choice_value) as val, 1 as cnt
      ) x on x.val is not null
     where fq.target_type = 'course'
       and fq.question_type in ('rating', 'single_choice', 'yes_no')
     group by fq.id, fq.question_text, fq.question_type, fq.section_title,
              fq.section_order, fq.display_order
  ) q;

  select jsonb_agg(jsonb_build_object(
           'lecturer_id', t.lecturer_id, 'lecturer_name', t.lecturer_name,
           'questions', t.questions) order by t.lecturer_name)
    into v_lecturer_q
  from (
    select l.id as lecturer_id,
           coalesce(l.title || ' ', '') || l.name as lecturer_name,
           jsonb_agg(jsonb_build_object(
             'question_id', s.id, 'question_text', s.question_text,
             'question_type', s.question_type, 'section_title', s.section_title,
             'responses', s.n, 'average', s.avg_rating, 'distribution', s.distribution)
           order by s.section_order, s.display_order) as questions
      from public.course_lecturers cl
      join public.lecturers l on l.id = cl.lecturer_id
      join lateral (
        select fq.id, fq.question_text, fq.question_type, fq.section_title,
               fq.section_order, fq.display_order,
               count(fa.id)::int as n,
               round(avg(fa.rating_value)::numeric, 2) as avg_rating,
               coalesce(jsonb_object_agg(x.val, x.cnt) filter (where x.val is not null), '{}'::jsonb) as distribution
          from public.feedback_questions fq
          join public.feedback_period_questions fpq
            on fpq.question_id = fq.id and fpq.feedback_period_id = p_period_id
          left join public.feedback_answers fa on fa.question_id = fq.id
            and fa.lecturer_target_id = cl.lecturer_id
            and fa.submission_id in (
              select fs.id from public.feedback_submissions fs
               where fs.feedback_period_id = p_period_id and fs.course_id = v_course
                 and fs.status = 'submitted')
          left join lateral (
            select coalesce(fa.rating_value::text, fa.choice_value) as val, 1 as cnt
          ) x on x.val is not null
         where fq.target_type = 'lecturer'
           and fq.question_type in ('rating', 'single_choice', 'yes_no')
         group by fq.id, fq.question_text, fq.question_type, fq.section_title,
                  fq.section_order, fq.display_order
      ) s on true
     where cl.offering_id = p_offering_id and cl.is_active
     group by l.id, l.title, l.name
  ) t;

  -- Comments carry no student identity here either. A head of department
  -- reads what was said about the teaching, not who said it; the anonymity
  -- choice a student made concerns the department admin's own records.
  select coalesce(jsonb_agg(jsonb_build_object(
           'question_text', fq.question_text,
           'section_title', fq.section_title,
           'about_lecturer', case when fa.lecturer_target_id is null then null
                                  else coalesce(l.title || ' ', '') || l.name end,
           'comment', fa.text_value)
         order by fq.section_order, fq.display_order), '[]'::jsonb)
    into v_comments
    from public.feedback_answers fa
    join public.feedback_questions fq on fq.id = fa.question_id
    join public.feedback_submissions fs on fs.id = fa.submission_id
    left join public.lecturers l on l.id = fa.lecturer_target_id
   where fs.feedback_period_id = p_period_id and fs.course_id = v_course
     and fs.status = 'submitted'
     and fq.question_type in ('short_text', 'long_text')
     and coalesce(btrim(fa.text_value), '') <> '';

  return jsonb_build_object(
    'visible', true,
    'response_count', v_responses,
    'course_questions', coalesce(v_course_q, '[]'::jsonb),
    'lecturer_questions', coalesce(v_lecturer_q, '[]'::jsonb),
    'comments', v_comments
  );
end;
$$;

revoke execute on function public.get_department_feedback_overview(uuid)        from public, anon;
revoke execute on function public.get_department_lecturer_feedback(uuid)        from public, anon;
revoke execute on function public.get_department_feedback_detail(uuid, uuid)    from public, anon;
grant  execute on function public.get_department_feedback_overview(uuid)        to authenticated;
grant  execute on function public.get_department_lecturer_feedback(uuid)        to authenticated;
grant  execute on function public.get_department_feedback_detail(uuid, uuid)    to authenticated;
