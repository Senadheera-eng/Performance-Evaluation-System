-- What removing a batch would take with it, counted, so the Super Admin
-- sees it before deciding.
create or replace function public.get_batch_footprint(p_batch_year integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
begin
  if not public.is_super_admin() then
    raise exception 'Only the Super Admin can manage batches';
  end if;

  select coalesce(array_agg(s.id), '{}') into v_ids
    from public.students s where s.batch_year = p_batch_year and s.role = 'student';

  return jsonb_build_object(
    'batch_year', p_batch_year,
    'semester', public.current_semester_for_batch(p_batch_year),
    'students', cardinality(v_ids),
    'active', (select count(*) from public.students s
                where s.id = any(v_ids) and s.status = 'active'),
    'results', (select count(*) from public.results r where r.student_id = any(v_ids)),
    'attendance', (select count(*) from public.attendance a where a.student_id = any(v_ids)),
    'enrollments', (select count(*) from public.enrollments e where e.student_id = any(v_ids)),
    'medical_submissions', (select count(*) from public.medical_submissions m where m.student_id = any(v_ids)),
    'mentor_messages', (select count(*) from public.mentor_messages mm
                          join public.mentor_assignments ma on ma.id = mm.assignment_id
                         where ma.student_id = any(v_ids)),
    'feedback_submissions', (select count(*) from public.feedback_submissions f
                              where f.student_id = any(v_ids)),
    'notifications', (select count(*) from public.notifications n where n.recipient_id = any(v_ids)));
end;
$$;
revoke all on function public.get_batch_footprint(integer) from public, anon;
grant execute on function public.get_batch_footprint(integer) to authenticated;
