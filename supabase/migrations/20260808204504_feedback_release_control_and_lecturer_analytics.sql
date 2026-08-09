-- feedback_release_control_and_lecturer_analytics
-- Applied 20260808204504
-- Exported from the live project; do not edit by hand.

-- Feedback does not reach a lecturer the moment a student submits it.
--
-- Two reasons. While a period is open, a partial picture is a misleading
-- one — three responses out of forty is not a verdict. And a department has
-- a legitimate interest in seeing what its students said before it is
-- forwarded, not least because a comment can identify its author in a small
-- cohort. So: students submit, the period closes, the department reviews,
-- the department releases, and only then does the lecturer see it.

create table if not exists public.feedback_releases (
  id                 uuid primary key default gen_random_uuid(),
  feedback_period_id uuid not null references public.feedback_periods(id) on delete cascade,
  offering_id        uuid not null references public.course_offerings(id) on delete cascade,
  released_by        uuid references auth.users(id) on delete set null,
  released_at        timestamptz not null default now(),
  notes              text,
  unique (feedback_period_id, offering_id)
);

create index if not exists feedback_releases_offering_idx
  on public.feedback_releases (offering_id);

alter table public.feedback_releases enable row level security;

drop policy if exists feedback_releases_read on public.feedback_releases;
create policy feedback_releases_read on public.feedback_releases
  for select to authenticated using (true);

drop policy if exists feedback_releases_dept_admin_write on public.feedback_releases;
create policy feedback_releases_dept_admin_write on public.feedback_releases
  for all to authenticated
  using      (get_my_role() = 'dept_admin'
              and get_my_department() = offering_department(offering_id))
  with check (get_my_role() = 'dept_admin'
              and get_my_department() = offering_department(offering_id));

drop policy if exists feedback_releases_super_admin_write on public.feedback_releases;
create policy feedback_releases_super_admin_write on public.feedback_releases
  for all to authenticated
  using      (get_my_role() = 'super_admin')
  with check (get_my_role() = 'super_admin');

-- Whether release is a deliberate act or automatic on closure is faculty
-- policy, not a code decision — so it lives with the other regulations.
insert into public.system_settings (key, value, description, category) values (
  'feedback_release_mode',
  '"dept_admin_release"'::jsonb,
  'How released feedback reaches lecturers: "dept_admin_release" (a department admin releases each course explicitly) or "auto_on_close" (released as soon as the period closes).',
  'feedback'
) on conflict (key) do nothing;

/** Whether a lecturer may see the feedback for one offering in one period. */
create or replace function public.feedback_is_released(
  p_period_id uuid,
  p_offering_id uuid
)
returns boolean
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_mode   text;
  v_status text;
begin
  select value #>> '{}' into v_mode
    from public.system_settings where key = 'feedback_release_mode';

  if coalesce(v_mode, 'dept_admin_release') = 'auto_on_close' then
    select status into v_status from public.feedback_periods where id = p_period_id;
    return v_status in ('closed', 'archived');
  end if;

  return exists (
    select 1 from public.feedback_releases
     where feedback_period_id = p_period_id and offering_id = p_offering_id
  );
end;
$$;

/** The minimum responses before per-course detail is shown, from settings. */
create or replace function public.feedback_privacy_threshold()
returns integer
language sql
stable security definer
set search_path to 'public'
as $$
  select coalesce((select (value #>> '{}')::int from public.system_settings
                    where key = 'feedback_min_responses_for_analytics'), 5);
$$;

-- ---------------------------------------------------------------------
-- What a lecturer sees
-- ---------------------------------------------------------------------
/** Every offering the calling lecturer teaches that has a feedback period
 *  covering it: response progress always, results only once released and
 *  only above the privacy threshold. */
create or replace function public.get_my_feedback_overview()
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
  eligible_count   integer,
  response_count   integer,
  response_rate    numeric,
  is_released      boolean,
  below_threshold  boolean,
  avg_rating       numeric
)
language plpgsql
stable security definer
set search_path to 'public'
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
         public.feedback_is_released(c.period_id, c.offering_id),
         c.responses < v_threshold,
         -- The headline rating, withheld unless it is both released and
         -- large enough to be anonymous. Response progress is never
         -- withheld: knowing how many people replied identifies nobody.
         case
           when public.feedback_is_released(c.period_id, c.offering_id)
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

/** Question-by-question results for one of the caller's own offerings.
 *  Lecturer-targeted questions are filtered to the caller: a course taught
 *  by three people gives each of them their own ratings and nobody else's,
 *  which is the whole point of targeting the answers. */
create or replace function public.get_my_feedback_detail(
  p_period_id uuid,
  p_offering_id uuid
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_lecturer  uuid;
  v_course    uuid;
  v_threshold int;
  v_responses int;
  v_questions jsonb;
  v_comments  jsonb;
begin
  v_lecturer := public.my_lecturer_id();
  if v_lecturer is null or not public.is_assigned_lecturer(p_offering_id) then
    raise exception 'You are not assigned to this course offering';
  end if;

  if not public.feedback_is_released(p_period_id, p_offering_id) then
    return jsonb_build_object('released', false,
      'message', 'These results have not been released by your department yet.');
  end if;

  select course_id into v_course from public.course_offerings where id = p_offering_id;
  v_threshold := public.feedback_privacy_threshold();

  select count(*)::int into v_responses
    from public.feedback_submissions fs
   where fs.feedback_period_id = p_period_id and fs.course_id = v_course
     and fs.status = 'submitted';

  if v_responses < v_threshold then
    return jsonb_build_object('released', true, 'response_count', v_responses,
      'below_threshold', true, 'threshold', v_threshold,
      'message', format('Detail is hidden below %s responses, so an individual reply cannot be identified.', v_threshold));
  end if;

  select jsonb_agg(jsonb_build_object(
           'question_id', q.id,
           'question_text', q.question_text,
           'question_type', q.question_type,
           'target_type', q.target_type,
           'section_title', q.section_title,
           'responses', q.n,
           'average', q.avg_rating,
           'distribution', q.distribution)
         order by q.section_order, q.display_order)
    into v_questions
  from (
    select fq.id, fq.question_text, fq.question_type, fq.target_type,
           fq.section_title, fq.section_order, fq.display_order,
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
        and (fq.target_type = 'course' or fa.lecturer_target_id = v_lecturer)
      left join lateral (
        select coalesce(fa.rating_value::text, fa.choice_value) as val, 1 as cnt
      ) x on x.val is not null
     where fq.question_type in ('rating', 'single_choice', 'yes_no')
     group by fq.id, fq.question_text, fq.question_type, fq.target_type,
              fq.section_title, fq.section_order, fq.display_order
  ) q;

  -- Written comments, always without any identity attached. A lecturer sees
  -- what was said, never who said it, whatever the student chose about
  -- anonymity — that choice concerns the department, not the person being
  -- rated.
  select coalesce(jsonb_agg(jsonb_build_object(
           'question_text', fq.question_text,
           'section_title', fq.section_title,
           'comment', fa.text_value)
         order by fq.section_order, fq.display_order), '[]'::jsonb)
    into v_comments
    from public.feedback_answers fa
    join public.feedback_questions fq on fq.id = fa.question_id
    join public.feedback_submissions fs on fs.id = fa.submission_id
   where fs.feedback_period_id = p_period_id and fs.course_id = v_course
     and fs.status = 'submitted'
     and fq.question_type in ('short_text', 'long_text')
     and coalesce(btrim(fa.text_value), '') <> ''
     and (fq.target_type = 'course' or fa.lecturer_target_id = v_lecturer);

  return jsonb_build_object(
    'released', true,
    'below_threshold', false,
    'response_count', v_responses,
    'questions', coalesce(v_questions, '[]'::jsonb),
    'comments', v_comments
  );
end;
$$;

/** Release one course's feedback to its lecturers. */
create or replace function public.release_feedback(
  p_period_id uuid,
  p_offering_id uuid,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_department text;
  v_status text;
begin
  v_department := public.offering_department(p_offering_id);
  if not (coalesce(public.get_my_role(),'') = 'super_admin'
          or (coalesce(public.get_my_role(),'') = 'dept_admin'
              and public.get_my_department() = v_department)) then
    raise exception 'Only the department admin can release feedback';
  end if;

  select status into v_status from public.feedback_periods where id = p_period_id;
  if v_status not in ('closed', 'archived') then
    raise exception 'Close the feedback period before releasing its results';
  end if;

  insert into public.feedback_releases (feedback_period_id, offering_id, released_by, notes)
  values (p_period_id, p_offering_id, auth.uid(), p_notes)
  on conflict (feedback_period_id, offering_id) do nothing;

  return jsonb_build_object('ok', true, 'message', 'Feedback released to the assigned lecturers.');
end;
$$;

create or replace function public.withdraw_feedback_release(
  p_period_id uuid,
  p_offering_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_department text;
begin
  v_department := public.offering_department(p_offering_id);
  if not (coalesce(public.get_my_role(),'') = 'super_admin'
          or (coalesce(public.get_my_role(),'') = 'dept_admin'
              and public.get_my_department() = v_department)) then
    raise exception 'Only the department admin can withdraw a release';
  end if;

  delete from public.feedback_releases
   where feedback_period_id = p_period_id and offering_id = p_offering_id;

  return jsonb_build_object('ok', true, 'message', 'Release withdrawn; lecturers can no longer see these results.');
end;
$$;

revoke execute on function public.feedback_is_released(uuid, uuid)          from public, anon;
revoke execute on function public.feedback_privacy_threshold()              from public, anon;
revoke execute on function public.get_my_feedback_overview()                from public, anon;
revoke execute on function public.get_my_feedback_detail(uuid, uuid)        from public, anon;
revoke execute on function public.release_feedback(uuid, uuid, text)        from public, anon;
revoke execute on function public.withdraw_feedback_release(uuid, uuid)     from public, anon;
grant  execute on function public.feedback_is_released(uuid, uuid)          to authenticated;
grant  execute on function public.feedback_privacy_threshold()              to authenticated;
grant  execute on function public.get_my_feedback_overview()                to authenticated;
grant  execute on function public.get_my_feedback_detail(uuid, uuid)        to authenticated;
grant  execute on function public.release_feedback(uuid, uuid, text)        to authenticated;
grant  execute on function public.withdraw_feedback_release(uuid, uuid)     to authenticated;
