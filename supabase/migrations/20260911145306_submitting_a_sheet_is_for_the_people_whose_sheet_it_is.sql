/*
  submit_offering_results admitted any department admin to any sheet:
  "get_my_role() in ('dept_admin','super_admin')" with no check on whose
  department the offering belongs to. In practice the Civil admin submitting a
  Computer Engineering sheet updated nothing — row security stopped the write
  — so it reported "0 result(s) submitted for review" rather than refusing.

  Nothing leaked, but a permission check that passes and then quietly does
  nothing is worse than one that says no: it reads as "there was nothing to
  submit" when the truth is "this is not yours". Say the true thing.

  The head of department is added for the same reason they can now publish:
  they carry the department's marks, and a sheet they hold has to be movable
  by them.
*/

create or replace function public.submit_offering_results(p_offering_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_department text;
  v_incomplete int;
  v_moved int;
begin
  v_department := public.offering_department(p_offering_id);

  if not (public.is_assigned_lecturer(p_offering_id)
          or public.get_my_role() = 'super_admin'
          or (public.get_my_role() = 'dept_admin'
              and public.get_my_department() = v_department)
          or public.is_active_hod_of(v_department)) then
    raise exception 'This sheet belongs to another department';
  end if;

  select count(*) into v_incomplete
    from public.results
   where offering_id = p_offering_id and status = 'draft' and grade is null;

  if v_incomplete > 0 then
    return jsonb_build_object(
      'ok', false,
      'incomplete', v_incomplete,
      'message', format('%s row(s) have no grade yet. Award every grade before submitting.', v_incomplete));
  end if;

  update public.results
     set status = 'submitted', submitted_by = auth.uid(), submitted_at = now(),
         returned_by = null, returned_at = null, return_notes = null
   where offering_id = p_offering_id and status = 'draft';

  get diagnostics v_moved = row_count;
  return jsonb_build_object('ok', true, 'submitted', v_moved,
    'message', format('%s result(s) submitted for review.', v_moved));
end;
$$;
