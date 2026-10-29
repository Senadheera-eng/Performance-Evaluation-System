-- The Super Admin can extend an enrolment window that is open: give it a
-- later closing time before closing it. The students it is for are told the
-- new deadline, as they were told when it opened. (Dates are given in Sri
-- Lanka time; the closing time is what the student has to act by.)
create or replace function public.notify_enrolment_window()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare r record;
begin
  for r in
    select n.* from new_rows n join old_rows o on o.id = n.id
     where n.status = 'open' and o.status is distinct from 'open'
  loop
    perform public.notify_users(
      (select coalesce(array_agg(s.id), '{}'::uuid[]) from public.students s
        where s.role = 'student'
          and (r.department is null or s.department = r.department)
          and (r.batch_year is null or s.batch_year = r.batch_year)),
      'enrolment', 'enrolment_opened',
      'Enrolment is open: ' || r.title,
      'Choose your modules before ' || to_char(r.closes_at, 'FMDay DD FMMonth') || '.',
      '/app/enrollment', 'enrollment_period', r.id);
  end loop;

  -- An open window given a later closing time.
  for r in
    select n.* from new_rows n join old_rows o on o.id = n.id
     where n.status = 'open' and o.status = 'open' and n.closes_at > o.closes_at
  loop
    perform public.notify_users(
      (select coalesce(array_agg(s.id), '{}'::uuid[]) from public.students s
        where s.role = 'student'
          and (r.department is null or s.department = r.department)
          and (r.batch_year is null or s.batch_year = r.batch_year)),
      'enrolment', 'enrolment_extended',
      'Enrolment extended: ' || r.title,
      'You can now choose your modules until '
        || to_char(r.closes_at at time zone 'Asia/Colombo', 'FMDay DD FMMonth, FMHH12:MI AM') || '.',
      '/app/enrollment', 'enrollment_period', r.id);
  end loop;
  return null;
end;
$function$;
