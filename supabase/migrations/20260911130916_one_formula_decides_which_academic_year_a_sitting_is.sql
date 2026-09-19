/*
  Enrolled students were not appearing on the Results page, and the reason was
  that two places decided what academic year a sitting belongs to, by
  different rules.

  The Results page derives it and never asks:
      batch_year + course.year - 1  /  batch_year + course.year

  update_my_enrolment took it from the enrolment window, where an admin had
  typed it by hand. Three windows exist for semester 7 of batch 2021, carrying
  two different years between them — 2021/2022 and 2026/2027 — while the
  derived answer is 2024/2025. Nothing matched, so a course with a real
  enrolment row reported "No students enrolled".

  Of 5,624 enrolment rows, 5,616 already agree with the derived rule: the
  historical import used it. The 8 that disagree are exactly the rows written
  through a window. So the window's typed year is the one thing in the system
  that ever drifted, and it is removed from the decision here.

  What is kept is the intent the original comment stated: "a repeat is sat
  with whichever batch is taking it". That is still true — the year is derived
  from the batch actually sitting the course, taken from the window when one
  says, and from the student otherwise. Only the hand-typed string is gone.

  enrollment_periods.academic_year is left in place. It is still shown to
  admins and read by reporting; it simply no longer decides what a row is
  filed under.
*/

create or replace function public.academic_year_for(
  p_batch_year integer,
  p_course_year integer
)
returns text
language sql
immutable
parallel safe
as $$
  select case
           when p_batch_year is null or p_course_year is null then null
           else (p_batch_year + p_course_year - 1)::text || '/' ||
                (p_batch_year + p_course_year)::text
         end;
$$;

comment on function public.academic_year_for(integer, integer) is
  'The one rule for which academic year a sitting belongs to: the batch taking '
  'it plus the study year of the course. Every reader and writer must use this '
  'rather than deriving it again or storing a typed copy.';

revoke execute on function public.academic_year_for(integer, integer) from public, anon;
grant execute on function public.academic_year_for(integer, integer) to authenticated, service_role;

-- ---------------------------------------------------------------- the writer

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

    /* Which batch is sitting this course. The window says when it names one,
       because a repeat is sat with whichever batch is taking it; otherwise it
       is the student's own. The year is then derived, never read from the
       window's typed field. */
    select coalesce(p.batch_year, v_student.batch_year) into v_batch
      from public.enrollment_periods p
     where p.status = 'open'
       and now() between p.opens_at and p.closes_at
       and (p.department is null or p.department = v_student.department)
       and public.period_covers_course(p.id, v_course)
     order by (p.semester = public.current_semester_for_batch(v_student.batch_year)) desc,
              p.closes_at
     limit 1;

    v_batch := coalesce(v_batch, v_student.batch_year);
    v_year  := public.academic_year_for(v_batch, v_cyear);

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

    select coalesce(p.batch_year, v_student.batch_year) into v_batch
      from public.enrollment_periods p
     where p.status = 'open'
       and now() between p.opens_at and p.closes_at
       and (p.department is null or p.department = v_student.department)
       and public.period_covers_course(p.id, v_course)
     order by (p.semester = public.current_semester_for_batch(v_student.batch_year)) desc,
              p.closes_at
     limit 1;

    v_batch := coalesce(v_batch, v_student.batch_year);
    v_year  := public.academic_year_for(v_batch, v_cyear);

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

-- ------------------------------------------------------------- the repair

/* The eight rows a window filed under a typed year. Checked beforehand: none
   of them collides with an existing row for the same student and course at
   the derived year. */
update public.enrollments e
   set academic_year = public.academic_year_for(
         coalesce(e.enrolled_with_batch, s.batch_year), c.year)
  from public.students s, public.courses c
 where s.id = e.student_id
   and c.id = e.course_id
   and e.academic_year is distinct from
       public.academic_year_for(coalesce(e.enrolled_with_batch, s.batch_year), c.year);
