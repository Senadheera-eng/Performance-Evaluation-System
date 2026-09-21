-- An enrolment window set up by mistake can be removed, as long as it never
-- opened.
--
-- A student's enrolment is keyed on the course and the year, not on the
-- window it was made through, so deleting a window that has been open would
-- take away the record of why those enrolments exist while leaving the
-- enrolments themselves behind. A draft or a scheduled window has produced
-- none, so removing it takes nothing with it but its own course list.
create or replace function public.delete_enrollment_period(p_period_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period  record;
  v_enrolled int;
begin
  if coalesce(public.get_my_role(), '') <> 'super_admin' then
    raise exception 'Only a super admin may remove an enrolment period';
  end if;

  select id, title, status, academic_year
    into v_period
    from public.enrollment_periods
   where id = p_period_id;

  if v_period.id is null then
    raise exception 'That enrolment period no longer exists';
  end if;

  if v_period.status not in ('draft', 'scheduled') then
    raise exception
      'A % enrolment period cannot be removed', v_period.status
      using hint = 'Only a window that has not opened yet can be deleted. Archive it instead.';
  end if;

  -- Belt and braces: a window in either state should have no enrolments, but
  -- if one somehow does, it is a record and not a mistake to be swept away.
  select count(*)::int into v_enrolled
    from public.enrollments e
    join public.enrollment_period_courses pc on pc.course_id = e.course_id
   where pc.period_id = p_period_id
     and e.academic_year = v_period.academic_year
     and e.status <> 'dropped';

  if v_enrolled > 0 then
    raise exception
      'Students have already enrolled through this period'
      using detail = v_enrolled || ' enrolment(s) exist for its courses.',
            hint = 'Close and archive it rather than deleting it.';
  end if;

  -- Its course list goes with it; the foreign key already says so.
  delete from public.enrollment_periods where id = p_period_id;

  return jsonb_build_object(
    'message', '"' || v_period.title || '" was removed.');
end;
$$;

revoke all on function public.delete_enrollment_period(uuid) from public;
grant execute on function public.delete_enrollment_period(uuid) to authenticated;

comment on function public.delete_enrollment_period(uuid) is
  'Removes an enrolment window that never opened. Super admin only; refuses any window past draft or scheduled, and any window whose courses already carry enrolments.';;
