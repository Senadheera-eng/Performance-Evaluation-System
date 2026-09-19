/*
  The head of department was being sent to /admin.

  Three notifications addressed the department admins and the head together
  and gave them one href between them. But a head of department is a lecturer,
  and /admin is closed to lecturers — ProtectedRoute turns them away. The card
  said "review and publish" and the link went nowhere they are allowed.

  The point of a notification is to say what changed and where to go. A link
  that cannot be followed fails the second half, so the two audiences are told
  separately now, each pointed at their own portal.

  Medical is the sharper case: there is no medical screen in the staff portal
  at all, so there was no correct link to give a head. They are no longer told
  about a submission they cannot act on — a card that only creates an
  obligation with no way to discharge it is worse than silence.
*/

create or replace function public.notify_result_changes()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
  v_dept text;
  v_head uuid;
begin
  for r in
    select n.offering_id, array_agg(n.student_id) as students
      from new_rows n
      join old_rows o on o.id = n.id
     where n.status = 'published' and o.status is distinct from 'published'
       and n.offering_id is not null
     group by n.offering_id
  loop
    perform public.notify_users(
      r.students, 'results', 'result_published',
      'Your result is out for ' || coalesce(public.offering_label(r.offering_id), 'a course'),
      'The department has published this sheet. Your grade is on your results page.',
      '/app/results', 'offering', r.offering_id);
  end loop;

  for r in
    select n.offering_id, count(*) as moved
      from new_rows n
      join old_rows o on o.id = n.id
     where n.status = 'submitted' and o.status is distinct from 'submitted'
       and n.offering_id is not null
     group by n.offering_id
  loop
    v_dept := public.offering_department(r.offering_id);
    v_head := public.department_head_id(v_dept);

    perform public.notify_users(
      public.department_admin_ids(v_dept),
      'results', 'result_submitted',
      coalesce(public.offering_label(r.offering_id), 'A sheet') || ' is ready for review',
      r.moved || ' result(s) submitted by the course lecturer. Review and publish, or send the sheet back.',
      '/admin/results', 'offering', r.offering_id);

    -- The head reviews the same sheet, from the staff portal.
    perform public.notify_user(
      v_head, 'results', 'result_submitted',
      coalesce(public.offering_label(r.offering_id), 'A sheet') || ' is ready for review',
      r.moved || ' result(s) submitted by the course lecturer. Review and publish, or send the sheet back.',
      '/staff/results', 'offering', r.offering_id);
  end loop;

  for r in
    select n.offering_id, max(n.return_notes) as notes
      from new_rows n
      join old_rows o on o.id = n.id
     where n.status = 'draft' and o.status = 'submitted'
       and n.offering_id is not null
     group by n.offering_id
  loop
    perform public.notify_users(
      public.offering_lecturer_ids(r.offering_id),
      'results', 'result_returned',
      coalesce(public.offering_label(r.offering_id), 'A sheet') || ' was sent back to you',
      coalesce(nullif(btrim(r.notes), ''), 'The department returned this sheet for changes.'),
      '/staff/results', 'offering', r.offering_id);
  end loop;

  return null;
end;
$$;


create or replace function public.notify_feedback_changes()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
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
$$;


create or replace function public.notify_medical_submitted()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare r record;
begin
  for r in
    select n.department, n.submission_id, count(*) as courses
      from new_rows n group by n.department, n.submission_id
  loop
    /* Admins only. The staff portal has no medical screen, so there is
       nowhere to send a head of department. */
    perform public.notify_users(
      public.department_admin_ids(r.department),
      'medical', 'medical_submitted',
      'A medical certificate needs reviewing',
      r.courses || ' of your department''s course(s) are covered by a new submission.',
      '/admin/medical', 'medical_submission', r.submission_id);
  end loop;
  return null;
end;
$$;
