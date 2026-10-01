-- The Super Admin's view of the batches in PES, for bringing a new intake
-- in and removing one that has left. A student is a row in students whose id
-- is their sign-in account's id; a batch with no published results is in
-- Semester 1 by current_semester_for_batch, so a new intake needs nothing
-- else from the database.

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins a
                  where a.id = auth.uid() and a.role = 'super_admin');
$$;
revoke all on function public.is_super_admin() from public, anon;
grant execute on function public.is_super_admin() to authenticated;

-- Every batch: how many students, where it is in its degree, and its
-- students by department.
create or replace function public.get_batches()
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

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'batch_year', b.batch_year,
             'students', b.students,
             'active', b.active,
             'semester', public.current_semester_for_batch(b.batch_year),
             'departments', b.departments,
             'last_added', b.last_added)
           order by b.batch_year desc)
      from (
        select s.batch_year,
               count(*)::int as students,
               count(*) filter (where s.status = 'active')::int as active,
               max(s.created_at) as last_added,
               (select jsonb_agg(jsonb_build_object('department', d.department, 'students', d.n)
                                 order by d.department nulls last)
                  from (select s2.department, count(*)::int as n
                          from public.students s2
                         where s2.batch_year = s.batch_year
                         group by s2.department) d) as departments
          from public.students s
         where s.batch_year is not null and s.role = 'student'
         group by s.batch_year
      ) b), '[]'::jsonb);
end;
$$;
revoke all on function public.get_batches() from public, anon;
grant execute on function public.get_batches() to authenticated;
