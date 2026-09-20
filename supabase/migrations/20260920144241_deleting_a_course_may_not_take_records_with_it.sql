-- Deleting a course, without taking a cohort's record with it.
--
-- Every table that points at a course does so ON DELETE CASCADE: enrolments,
-- attendance, results, feedback. A plain delete of a course taught three
-- years ago would therefore erase those students' marks and registers
-- silently — which is exactly what a "Delete" button on a catalogue screen
-- invites someone to do.
--
-- So a course can only be removed while nothing has used it yet: no
-- delivery, no enrolment, no attendance, no result, no feedback round. That
-- covers the real case — a course typed in by mistake — and refuses the one
-- that destroys history, naming what is holding it.
create or replace function public.delete_course(p_course_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course   record;
  v_blockers text[] := '{}';
  v_n        int;
begin
  select c.id, c.course_code, c.title, c.department into v_course
    from public.courses c where c.id = p_course_id;
  if v_course.id is null then
    raise exception 'No such course';
  end if;

  -- The same people the row policy lets write a course.
  if not (coalesce(public.get_my_role(), '') = 'super_admin'
          or (coalesce(public.get_my_role(), '') = 'dept_admin'
              and public.get_my_department() = v_course.department)
          or public.is_active_hod_of(v_course.department)) then
    raise exception 'Only % can change its own courses', v_course.department;
  end if;

  select count(*) into v_n from public.results where course_id = p_course_id;
  if v_n > 0 then v_blockers := v_blockers || format('%s result%s', v_n, case when v_n = 1 then '' else 's' end); end if;

  select count(*) into v_n from public.attendance where course_id = p_course_id;
  if v_n > 0 then v_blockers := v_blockers || format('%s attendance record%s', v_n, case when v_n = 1 then '' else 's' end); end if;

  select count(*) into v_n from public.enrollments where course_id = p_course_id;
  if v_n > 0 then v_blockers := v_blockers || format('%s enrolment%s', v_n, case when v_n = 1 then '' else 's' end); end if;

  select count(*) into v_n from public.course_offerings where course_id = p_course_id;
  if v_n > 0 then v_blockers := v_blockers || format('%s delivery%s', v_n, case when v_n = 1 then '' else 'ies'end); end if;

  select count(*) into v_n from public.feedback_period_courses where course_id = p_course_id;
  if v_n > 0 then v_blockers := v_blockers || format('%s feedback round%s', v_n, case when v_n = 1 then '' else 's' end); end if;

  if array_length(v_blockers, 1) > 0 then
    raise exception '% still has % — a course that has been taught cannot be deleted, because its records would go with it.',
      v_course.course_code, array_to_string(v_blockers, ', ');
  end if;

  delete from public.courses where id = p_course_id;

  return jsonb_build_object('ok', true,
    'message', format('%s removed from the catalogue.', v_course.course_code));
end;
$$;
revoke all on function public.delete_course(uuid) from public, anon;
grant execute on function public.delete_course(uuid) to authenticated;