-- Unused, empty tables, a column and a view, removed without losing data.
--
-- Each was checked on 30 October 2026 against the app on main, dev and
-- feature/UI, the four Edge Functions, and every database function, view and
-- policy:
--
--   timetables              0 rows. Created before the migration history and
--                           never read or written by anything.
--   feedback                0 rows. The first feedback table, replaced in July
--                           2026 by feedback_submissions / feedback_answers and
--                           locked down since. Nothing reads or writes it.
--   courses.lecturer_name   Empty in every course. Who teaches a course is in
--                           course_lecturers. Only
--                           get_student_eligible_feedback_courses still
--                           returned it, and now returns null in its place,
--                           which is what it always returned.
--   student_gpa_summary     A view nothing uses; the screens call functions.
--
-- Each drop first checks the thing is still empty, and stops the migration
-- if it is not, so no data can go with it.

do $$
begin
  if exists (select 1 from public.timetables) then
    raise exception 'timetables has rows; not dropping it';
  end if;
  if exists (select 1 from public.feedback) then
    raise exception 'feedback has rows; not dropping it';
  end if;
  if exists (select 1 from public.courses where lecturer_name is not null) then
    raise exception 'courses.lecturer_name holds data; not dropping it';
  end if;
end $$;

create or replace function public.get_student_eligible_feedback_courses(p_period_id uuid)
 returns table(course_id uuid, course_code text, title text, credits integer, semester integer, category text, department text, lecturer_name text, submission_status text)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_student_id uuid := auth.uid();
  v_period record;
  v_open boolean;
begin
  select * into v_period from feedback_periods where id = p_period_id;
  if v_period is null then return; end if;

  v_open := v_period.status = 'open'
            and now() between v_period.opens_at and v_period.closes_at;

  return query
  select c.id, c.course_code, c.title, c.credits, c.semester, c.category,
         c.department,
         -- courses.lecturer_name was never filled in and is gone; the
         -- column stays in the result so callers do not change.
         null::text as lecturer_name,
         case
           when fs.status = 'submitted' then 'submitted'
           when fs.status = 'draft' and v_open then 'draft'
           when fs.status = 'draft' then 'closed'
           when v_open then 'pending'
           else 'closed'
         end as submission_status
  from feedback_period_courses fpc
  join courses c on c.id = fpc.course_id
  left join feedback_submissions fs
         on fs.feedback_period_id = p_period_id
        and fs.course_id = c.id
        and fs.student_id = v_student_id
  where fpc.feedback_period_id = p_period_id
    and student_took_course(v_student_id, c.id)
  order by c.course_code;
end;
$function$;

drop view public.student_gpa_summary;
alter table public.courses drop column lecturer_name;
drop table public.timetables;
drop table public.feedback;
