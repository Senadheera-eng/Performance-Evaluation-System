-- An open feedback round given a later closing time tells its students.
--
-- Department admins can now extend an open round from the Feedback page (a
-- later closes_at on feedback_periods, allowed by the existing row policies).
-- Students were told when a round opened, but not when it was extended, so
-- one who had seen "It closes on Friday" never learned they had more time.
-- This adds that notice to notify_feedback_changes, beside the one sent on
-- opening and to the same students: the round's batch, in its department or
-- in every department for a faculty-wide round. It mirrors the notice an
-- extended enrolment window sends (notify_enrolment_window), and gives the
-- new time in Sri Lanka's time zone.
--
-- Only a later time on a round that was open and still is counts as an
-- extension; opening, closing and every other edit are unchanged. Everything
-- else in the function is as it was.

create or replace function public.notify_feedback_changes()
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
      'feedback', 'feedback_opened',
      'Feedback is open: ' || r.title,
      'Your answers are anonymous. It closes on '
        || to_char(r.closes_at, 'FMDay DD FMMonth') || '.',
      '/app/feedback', 'feedback_period', r.id);
  end loop;

  -- An open round given a later closing time.
  for r in
    select n.* from new_rows n join old_rows o on o.id = n.id
     where n.status = 'open' and o.status = 'open' and n.closes_at > o.closes_at
  loop
    perform public.notify_users(
      (select coalesce(array_agg(s.id), '{}'::uuid[]) from public.students s
        where s.role = 'student'
          and (r.department is null or s.department = r.department)
          and (r.batch_year is null or s.batch_year = r.batch_year)),
      'feedback', 'feedback_extended',
      'Feedback extended: ' || r.title,
      'You can now give your feedback until '
        || to_char(r.closes_at at time zone 'Asia/Colombo', 'FMDay DD FMMonth, FMHH12:MI AM')
        || '. Your answers are anonymous.',
      '/app/feedback', 'feedback_period', r.id);
  end loop;

  for r in
    select n.*, l.auth_user_id
      from new_rows n
      join old_rows o on o.id = n.id
      left join public.lecturers l on l.id = n.created_by_lecturer_id
     where n.approval_status is distinct from o.approval_status
       and n.approval_status in ('approved', 'rejected')
       and n.created_by_lecturer_id is not null
  loop
    perform public.notify_user(
      r.auth_user_id, 'feedback',
      'feedback_request_' || r.approval_status,
      case when r.approval_status = 'approved'
           then 'Your feedback round was approved: ' || r.title
           else 'Your feedback round was not approved: ' || r.title end,
      coalesce(nullif(btrim(r.approval_notes), ''),
               case when r.approval_status = 'approved'
                    then 'You can open it for students when you are ready.'
                    else 'The department did not give a reason.' end),
      '/staff/feedback', 'feedback_period', r.id);
  end loop;

  for r in
    select n.* from new_rows n join old_rows o on o.id = n.id
     where n.approval_status = 'pending' and o.approval_status is distinct from 'pending'
       and n.created_by_lecturer_id is not null
  loop
    perform public.notify_users(
      public.department_admin_ids(r.department),
      'feedback', 'feedback_request_pending',
      'A lecturer asked to run a feedback round',
      r.title || ' is waiting for your approval.',
      '/admin/feedback', 'feedback_period', r.id);

    perform public.notify_user(
      public.department_head_id(r.department),
      'feedback', 'feedback_request_pending',
      'A lecturer asked to run a feedback round',
      r.title || ' is waiting for your approval.',
      '/staff/feedback', 'feedback_period', r.id);
  end loop;

  return null;
end;
$function$;
