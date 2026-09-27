-- A department admin could not see a feedback round the super admin ran for
-- the whole faculty. Such a round has no department (null), and the list
-- only returned rounds whose department equalled the admin's own, so a
-- round every student in the department could see was missing from the
-- page that is meant to watch it.
--
-- Faculty-wide rounds are now listed too. Seeing is all this adds: the
-- fp_dept_admin_manage policy still lets a department admin change only
-- rounds that belong to their department, so a faculty-wide round stays the
-- super admin's to open, close or edit. The results functions already limit
-- a department admin to their own department's courses within any round.
create or replace function public.get_admin_feedback_periods()
returns table (
  id uuid, title text, academic_year text, semester integer, batch_year integer,
  department text, feedback_type text, opens_at timestamptz, closes_at timestamptz,
  status text, allow_editing boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := get_my_role();
  v_dept text := get_my_department();
begin
  if v_role not in ('dept_admin','super_admin') then
    raise exception 'Access denied: admin role required';
  end if;

  return query
  select p.id, p.title, p.academic_year, p.semester, p.batch_year,
         p.department, p.feedback_type, p.opens_at, p.closes_at,
         p.status, p.allow_editing
    from feedback_periods p
   where v_role = 'super_admin' or p.department = v_dept or p.department is null
   order by p.created_at desc;
end;
$$;
