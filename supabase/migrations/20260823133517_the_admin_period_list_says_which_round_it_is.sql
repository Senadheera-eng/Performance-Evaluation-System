-- the_admin_period_list_says_which_round_it_is
-- Applied 20260823133517
-- Exported from the live project; do not edit by hand.

-- feedback_periods has always carried feedback_type, and every screen that
-- reads a period shows it -- the student's form, the lecturer's requests, the
-- release panel, the department analytics. The one list that did not was the
-- department admin's own, because the RPC behind it never selected the column.
--
-- That is also why the create form could not offer the choice: there was
-- nowhere for the answer to show up afterwards. Two rounds covering the same
-- semester read as duplicate rows.

drop function if exists public.get_admin_feedback_periods();

create function public.get_admin_feedback_periods()
returns table(
  id uuid, title text, academic_year text, semester integer,
  batch_year integer, department text, feedback_type text,
  opens_at timestamp with time zone, closes_at timestamp with time zone,
  status text, allow_editing boolean)
language plpgsql security definer set search_path to 'public'
as $function$
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
   where v_role = 'super_admin' or p.department = v_dept
   order by p.created_at desc;
end;
$function$;

grant execute on function public.get_admin_feedback_periods() to authenticated;
