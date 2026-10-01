-- A course is enrolled in the academic year of the semester that offers it.
--
-- update_my_enrolment worked the year out from the course's own `year`
-- column. Most courses sit in one semester, so that was the same thing. But
-- the curriculum places some in two: the language and humanities electives
-- (IS3171-IS3174 in Semesters 5 and 7, IS3175-IS3177 in 6 and 8) and the two
-- minor projects (CO3554, CO3563 in 6 and 7). A course has one `year`, so in
-- one of its two semesters the enrolment was filed under the wrong year:
-- ticking IS3172 in the Semester 7 window wrote it to 2023/2024, Semester 5's
-- year. The page asks about Semester 7's year, found nothing, and the tick
-- never stayed -- Save appeared to do nothing, every time.
--
-- The window already says which semester it is offering. The year now comes
-- from that: the batch sitting it, in the year of study that semester falls
-- in -- the same formula get_my_enrolment_plan uses to read the tick back.
-- The course's own year is used only when no window is found, as before.
--
-- The two enrolments already misfiled this way (both IS3172, both made in
-- the open Semester 7 window) move to the year they were meant for.
create or replace function public.update_my_enrolment(
  p_add uuid[] default '{}'::uuid[],
  p_remove uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_student record;
  v_course  uuid;
  v_kind    text;
  v_year    text;
  v_batch   integer;
  v_sem     integer;
  v_cyear   integer;
  v_code    text;
  v_n       integer;
  v_added   integer := 0;
  v_removed integer := 0;
begin
  select s.id, s.batch_year, s.department into v_student
    from public.students s where s.id = auth.uid();
  if v_student.id is null then
    raise exception 'Only a student can change their own enrolment';
  end if;

  -- Drops come first. A student swapping one elective for another would
  -- otherwise be turned away at a course with a capacity by the place they
  -- are in the middle of giving up.
  foreach v_course in array coalesce(p_remove, '{}'::uuid[]) loop
    select c.course_code, c.year into v_code, v_cyear
      from public.courses c where c.id = v_course;

    if public.enrolment_kind_for_course(v_course) is null then
      raise exception 'Enrolment has closed for %. Ask your department.', v_code;
    end if;

    /* Which batch is sitting this course, and in which semester. The window
       says both: a repeat is sat with whichever batch is taking it, and a
       course the curriculum places in two semesters belongs to the one this
       window is offering. The year is then derived from them. */
    v_batch := null;
    v_sem := null;
    select coalesce(p.batch_year, v_student.batch_year), p.semester into v_batch, v_sem
      from public.enrollment_periods p
     where p.status = 'open'
       and now() between p.opens_at and p.closes_at
       and (p.department is null or p.department = v_student.department)
       and public.period_covers_course(p.id, v_course)
     order by (p.semester = public.current_semester_for_batch(v_student.batch_year)) desc,
              p.closes_at
     limit 1;

    v_batch := coalesce(v_batch, v_student.batch_year);
    v_year  := public.academic_year_for(
                 v_batch, coalesce(ceil(v_sem / 2.0)::int, v_cyear));

    -- A recorded mark outlives the window, and removing the enrolment under it
    -- would orphan the result. Scoped to the year being dropped: the old R
    -- that sent a student back to a course must not lock the repeat.
    if exists (select 1 from public.results r
                where r.student_id = v_student.id
                  and r.course_id  = v_course
                  and r.academic_year = v_year) then
      raise exception 'Marks are already recorded for %. Ask your department to remove it.', v_code;
    end if;

    delete from public.enrollments e
     where e.student_id    = v_student.id
       and e.course_id     = v_course
       and e.academic_year = v_year
       and e.status        = 'enrolled';
    get diagnostics v_n = row_count;
    v_removed := v_removed + v_n;
  end loop;

  foreach v_course in array coalesce(p_add, '{}'::uuid[]) loop
    select c.course_code, c.year into v_code, v_cyear
      from public.courses c where c.id = v_course;

    v_kind := public.enrolment_kind_for_course(v_course);
    if v_kind is null then
      raise exception 'Enrolment is not open for %.', v_code;
    end if;

    v_batch := null;
    v_sem := null;
    select coalesce(p.batch_year, v_student.batch_year), p.semester into v_batch, v_sem
      from public.enrollment_periods p
     where p.status = 'open'
       and now() between p.opens_at and p.closes_at
       and (p.department is null or p.department = v_student.department)
       and public.period_covers_course(p.id, v_course)
     order by (p.semester = public.current_semester_for_batch(v_student.batch_year)) desc,
              p.closes_at
     limit 1;

    v_batch := coalesce(v_batch, v_student.batch_year);
    v_year  := public.academic_year_for(
                 v_batch, coalesce(ceil(v_sem / 2.0)::int, v_cyear));

    insert into public.enrollments
      (student_id, course_id, academic_year, status, enrollment_kind, enrolled_with_batch)
    values (v_student.id, v_course, v_year, 'enrolled', v_kind,
            case when v_kind = 'regular' then null else v_batch end)
    on conflict (student_id, course_id, academic_year) do update
       set status = 'enrolled', enrollment_kind = excluded.enrollment_kind
     where public.enrollments.status is distinct from 'enrolled';
    get diagnostics v_n = row_count;
    v_added := v_added + v_n;
  end loop;

  return jsonb_build_object('added', v_added, 'removed', v_removed);
end;
$function$;

-- The enrolments already filed under the wrong year: made in an open window
-- for the student's current semester, for a course that window carries, but
-- under another year, with no mark recorded and nothing already at the
-- right year.
update public.enrollments e
   set academic_year = public.academic_year_for(s.batch_year, ceil(p.semester / 2.0)::int)
  from public.students s, public.courses c, public.enrollment_periods p
 where s.id = e.student_id
   and c.id = e.course_id
   and p.semester = public.current_semester_for_batch(s.batch_year)
   and (p.department is null or p.department = s.department)
   and e.enrolled_at between p.opens_at and p.closes_at
   and e.status = 'enrolled'
   and e.enrollment_kind = 'regular'
   and public.period_covers_course(p.id, c.id)
   and e.academic_year <> public.academic_year_for(s.batch_year, ceil(p.semester / 2.0)::int)
   and not exists (select 1 from public.results r
                    where r.student_id = e.student_id and r.course_id = e.course_id
                      and r.academic_year = e.academic_year)
   and not exists (select 1 from public.enrollments e2
                    where e2.student_id = e.student_id and e2.course_id = e.course_id
                      and e2.academic_year = public.academic_year_for(s.batch_year, ceil(p.semester / 2.0)::int));
