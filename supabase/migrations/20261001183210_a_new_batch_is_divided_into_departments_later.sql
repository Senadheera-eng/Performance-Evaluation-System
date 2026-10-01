-- A first-year intake is admitted to the faculty, not to a department, and is
-- divided into departments partway through. The Super Admin records that
-- division for a whole batch at once, from the faculty's list: registration
-- number and department, one row each.
create or replace function public.assign_batch_departments(p_batch_year integer, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer := 0;
  v_unknown jsonb;
  v_bad     jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'Only the Super Admin can manage batches';
  end if;

  with rows as (
    select trim(r->>'reg_number') as reg, nullif(trim(r->>'department'), '') as department
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
  )
  select coalesce(jsonb_agg(x.reg) filter (where x.kind = 'unknown'), '[]'::jsonb),
         coalesce(jsonb_agg(x.reg) filter (where x.kind = 'bad'), '[]'::jsonb)
    into v_unknown, v_bad
    from (
      select r.reg,
             case
               when r.department is not null and r.department not in
                    ('Civil Engineering', 'Computer Engineering',
                     'Electrical and Electronic Engineering', 'Mechanical Engineering') then 'bad'
               when not exists (select 1 from public.students s
                                 where s.reg_number = r.reg and s.batch_year = p_batch_year
                                   and s.role = 'student') then 'unknown'
             end as kind
        from rows r
    ) x
   where x.kind is not null;

  with rows as (
    select trim(r->>'reg_number') as reg, nullif(trim(r->>'department'), '') as department
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
  )
  update public.students s
     set department = r.department
    from rows r
   where s.reg_number = r.reg
     and s.batch_year = p_batch_year
     and s.role = 'student'
     and (r.department is null or r.department in
          ('Civil Engineering', 'Computer Engineering',
           'Electrical and Electronic Engineering', 'Mechanical Engineering'))
     and s.department is distinct from r.department;
  get diagnostics v_updated = row_count;

  return jsonb_build_object('updated', v_updated, 'not_in_batch', v_unknown, 'unknown_department', v_bad);
end;
$$;
revoke all on function public.assign_batch_departments(integer, jsonb) from public, anon;
grant execute on function public.assign_batch_departments(integer, jsonb) to authenticated;
