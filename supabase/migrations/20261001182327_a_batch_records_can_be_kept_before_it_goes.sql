-- A batch's records, to keep before it is removed: the students, every
-- result, every enrolment and every attendance mark.
create or replace function public.export_batch_records(p_batch_year integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only the Super Admin can manage batches';
  end if;

  return jsonb_build_object(
    'students', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', s.name, 'reg_number', s.reg_number, 'index_number', s.index_number,
               'email', s.email, 'department', s.department, 'status', s.status)
             order by s.index_number, s.name)
        from public.students s where s.batch_year = p_batch_year and s.role = 'student'), '[]'::jsonb),
    'results', coalesce((
      select jsonb_agg(jsonb_build_object(
               'reg_number', s.reg_number, 'index_number', s.index_number, 'name', s.name,
               'course_code', c.course_code, 'course_title', c.title, 'semester', c.semester,
               'credits', c.credits, 'academic_year', r.academic_year, 'grade', r.grade,
               'grade_point', r.gpv, 'published', r.is_published)
             order by s.index_number, c.semester, c.course_code, r.academic_year)
        from public.results r
        join public.students s on s.id = r.student_id
        join public.courses c on c.id = r.course_id
       where s.batch_year = p_batch_year), '[]'::jsonb),
    'enrollments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'reg_number', s.reg_number, 'index_number', s.index_number,
               'course_code', c.course_code, 'semester', c.semester,
               'academic_year', e.academic_year, 'status', e.status, 'kind', e.enrollment_kind)
             order by s.index_number, c.semester, c.course_code)
        from public.enrollments e
        join public.students s on s.id = e.student_id
        join public.courses c on c.id = e.course_id
       where s.batch_year = p_batch_year), '[]'::jsonb),
    'attendance', coalesce((
      select jsonb_agg(jsonb_build_object(
               'reg_number', s.reg_number, 'index_number', s.index_number,
               'course_code', c.course_code, 'date', a.lecture_date, 'status', a.status)
             order by s.index_number, c.course_code, a.lecture_date)
        from public.attendance a
        join public.students s on s.id = a.student_id
        join public.courses c on c.id = a.course_id
       where s.batch_year = p_batch_year), '[]'::jsonb));
end;
$$;
revoke all on function public.export_batch_records(integer) from public, anon;
grant execute on function public.export_batch_records(integer) to authenticated;
