/*
  Who hears about what.

  Every trigger here is statement-level with a transition table rather than
  row-level, and that is the whole reason it works. Publishing a sheet updates
  forty-one rows; a row-level trigger would send the department admin
  forty-one identical cards saying the same sheet moved. Seeing the whole
  statement at once means the students each get their own result and the
  reviewers get one card about the sheet.
*/

/* ------------------------------------------------------- who to tell */

/** Students taking an offering: their own id is their auth id. */
create or replace function public.offering_student_ids(p_offering_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(array_agg(distinct s.id), '{}'::uuid[])
    from public.students s
   where s.role = 'student'
     and (
       exists (select 1 from public.enrollments e
                join public.course_offerings o on o.id = p_offering_id
                where e.student_id = s.id
                  and e.course_id = o.course_id
                  and e.academic_year = o.academic_year)
       or exists (select 1 from public.results r
                   where r.student_id = s.id and r.offering_id = p_offering_id)
     )
$$;

/** The admins answerable for a department: its own, plus every super admin. */
create or replace function public.department_admin_ids(p_department text)
returns uuid[]
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(array_agg(a.id), '{}'::uuid[])
    from public.admins a
   where a.role = 'super_admin'
      or (a.role = 'dept_admin' and a.department is not distinct from p_department)
$$;

/** The sitting head of a department, if they have a login. */
create or replace function public.department_head_id(p_department text)
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select l.auth_user_id
    from public.hod_appointments h
    join public.lecturers l on l.id = h.lecturer_id
   where h.is_active and h.department = p_department and l.status = 'active'
   limit 1
$$;

/** Everyone currently teaching an offering. */
create or replace function public.offering_lecturer_ids(p_offering_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(array_agg(distinct l.auth_user_id), '{}'::uuid[])
    from public.course_lecturers cl
    join public.lecturers l on l.id = cl.lecturer_id
   where cl.offering_id = p_offering_id and cl.is_active
     and l.auth_user_id is not null
$$;

/** "CO4204 — Computer Vision", for a title. */
create or replace function public.offering_label(p_offering_id uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select c.course_code || ' — ' || c.title
    from public.course_offerings o
    join public.courses c on c.id = o.course_id
   where o.id = p_offering_id
$$;


/* ------------------------------------------------------- results */

create or replace function public.notify_result_changes()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
begin
  /* A student hears about their own result, one card each, naming the course.
     Grouped by offering so the label is looked up once per sheet, not once
     per student. */
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

  /* A sheet going for review is one event, not forty-one. It goes to the
     people who can act on it: the department admin and the head. */
  for r in
    select n.offering_id, count(*) as moved
      from new_rows n
      join old_rows o on o.id = n.id
     where n.status = 'submitted' and o.status is distinct from 'submitted'
       and n.offering_id is not null
     group by n.offering_id
  loop
    perform public.notify_users(
      public.department_admin_ids(public.offering_department(r.offering_id))
        || array_remove(array[public.department_head_id(
             public.offering_department(r.offering_id))], null),
      'results', 'result_submitted',
      coalesce(public.offering_label(r.offering_id), 'A sheet') || ' is ready for review',
      r.moved || ' result(s) submitted by the course lecturer. Review and publish, or send the sheet back.',
      '/admin/results', 'offering', r.offering_id);
  end loop;

  /* Returned to the lecturer, with the reason, because a sheet coming back
     with no note is the thing lecturers complain about. */
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

drop trigger if exists results_notify on public.results;
create trigger results_notify
  after update on public.results
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.notify_result_changes();


/* ------------------------------------------------------- attendance */

create or replace function public.notify_register_open()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare r record;
begin
  for r in select * from new_rows n where n.status = 'open'
  loop
    perform public.notify_users(
      public.offering_student_ids(r.offering_id),
      'attendance', 'register_open',
      'Attendance is open for ' || coalesce(public.offering_label(r.offering_id), 'a lecture'),
      'Sign in before the register closes, or the lecture counts as an absence.',
      '/app/attendance', 'attendance_session', r.id);
  end loop;
  return null;
end;
$$;

drop trigger if exists attendance_sessions_notify_insert on public.attendance_sessions;
create trigger attendance_sessions_notify_insert
  after insert on public.attendance_sessions
  referencing new table as new_rows
  for each statement execute function public.notify_register_open();

create or replace function public.notify_register_reopened()
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
      public.offering_student_ids(r.offering_id),
      'attendance', 'register_open',
      'Attendance is open for ' || coalesce(public.offering_label(r.offering_id), 'a lecture'),
      'Sign in before the register closes, or the lecture counts as an absence.',
      '/app/attendance', 'attendance_session', r.id);
  end loop;
  return null;
end;
$$;

drop trigger if exists attendance_sessions_notify_update on public.attendance_sessions;
create trigger attendance_sessions_notify_update
  after update on public.attendance_sessions
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.notify_register_reopened();


/* ------------------------------------------------------- enrolment */

create or replace function public.notify_enrolment_window()
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
      'enrolment', 'enrolment_opened',
      'Enrolment is open: ' || r.title,
      'Choose your modules before ' || to_char(r.closes_at, 'FMDay DD FMMonth') || '.',
      '/app/enrollment', 'enrollment_period', r.id);
  end loop;
  return null;
end;
$$;

drop trigger if exists enrollment_periods_notify on public.enrollment_periods;
create trigger enrollment_periods_notify
  after update on public.enrollment_periods
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.notify_enrolment_window();


/* ------------------------------------------------------- feedback */

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

  /* A lecturer who asked to run their own round hears the verdict. */
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

  /* A lecturer''s request arriving is news for the department. */
  for r in
    select n.* from new_rows n join old_rows o on o.id = n.id
     where n.approval_status = 'pending' and o.approval_status is distinct from 'pending'
       and n.created_by_lecturer_id is not null
  loop
    perform public.notify_users(
      public.department_admin_ids(r.department)
        || array_remove(array[public.department_head_id(r.department)], null),
      'feedback', 'feedback_request_pending',
      'A lecturer asked to run a feedback round',
      r.title || ' is waiting for your approval.',
      '/admin/feedback', 'feedback_period', r.id);
  end loop;

  return null;
end;
$$;

drop trigger if exists feedback_periods_notify on public.feedback_periods;
create trigger feedback_periods_notify
  after update on public.feedback_periods
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.notify_feedback_changes();


/* ------------------------------------------------------- medical */

create or replace function public.notify_medical_submitted()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare r record;
begin
  /* One card per department, however many of its courses the certificate
     names — the reviewer opens the submission, not the course row. */
  for r in
    select n.department, n.submission_id, count(*) as courses
      from new_rows n group by n.department, n.submission_id
  loop
    perform public.notify_users(
      public.department_admin_ids(r.department)
        || array_remove(array[public.department_head_id(r.department)], null),
      'medical', 'medical_submitted',
      'A medical certificate needs reviewing',
      r.courses || ' of your department''s course(s) are covered by a new submission.',
      '/admin/medical', 'medical_submission', r.submission_id);
  end loop;
  return null;
end;
$$;

drop trigger if exists medical_courses_notify_insert on public.medical_submission_courses;
create trigger medical_courses_notify_insert
  after insert on public.medical_submission_courses
  referencing new table as new_rows
  for each statement execute function public.notify_medical_submitted();

create or replace function public.notify_medical_reviewed()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare r record;
begin
  for r in
    select n.submission_id, n.review_status, m.student_id,
           count(*) as courses, max(n.review_notes) as notes
      from new_rows n
      join old_rows o on o.id = n.id
      join public.medical_submissions m on m.id = n.submission_id
     where n.review_status is distinct from o.review_status
       and n.review_status in ('approved', 'rejected')
     group by n.submission_id, n.review_status, m.student_id
  loop
    perform public.notify_user(
      r.student_id, 'medical', 'medical_' || r.review_status,
      case when r.review_status = 'approved'
           then 'Your medical certificate was accepted'
           else 'Your medical certificate was not accepted' end,
      coalesce(nullif(btrim(r.notes), ''),
               r.courses || ' course(s) were reviewed.'),
      '/app/medical', 'medical_submission', r.submission_id);
  end loop;
  return null;
end;
$$;

drop trigger if exists medical_courses_notify_review on public.medical_submission_courses;
create trigger medical_courses_notify_review
  after update on public.medical_submission_courses
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.notify_medical_reviewed();


/* ------------------------------------------------------- mentoring */

create or replace function public.notify_mentor_assigned()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare r record;
begin
  for r in
    select n.*, s.name as student_name,
           coalesce(l.title || ' ', '') || l.name as mentor_name,
           l.auth_user_id as mentor_auth
      from new_rows n
      join public.students s on s.id = n.student_id
      join public.lecturers l on l.id = n.mentor_id
     where n.ended_at is null
  loop
    perform public.notify_user(
      r.student_id, 'mentoring', 'mentor_assigned',
      r.mentor_name || ' is now your mentor',
      'You can message them from your mentor page.',
      '/app/mentor', 'mentor_assignment', r.id);

    perform public.notify_user(
      r.mentor_auth, 'mentoring', 'mentee_assigned',
      r.student_name || ' is now your mentee',
      'They have been added to your mentee list.',
      '/staff/mentees', 'mentor_assignment', r.id);
  end loop;
  return null;
end;
$$;

drop trigger if exists mentor_assignments_notify on public.mentor_assignments;
create trigger mentor_assignments_notify
  after insert on public.mentor_assignments
  referencing new table as new_rows
  for each statement execute function public.notify_mentor_assigned();


create or replace function public.notify_mentor_message()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare r record;
begin
  for r in
    select n.*, a.student_id, l.auth_user_id as mentor_auth,
           s.name as student_name,
           coalesce(l.title || ' ', '') || l.name as mentor_name
      from new_rows n
      join public.mentor_assignments a on a.id = n.assignment_id
      join public.students s on s.id = a.student_id
      join public.lecturers l on l.id = a.mentor_id
  loop
    if r.sender_role = 'mentor' then
      perform public.notify_user(
        r.student_id, 'mentoring', 'mentor_message',
        'Message from ' || r.mentor_name,
        left(r.body, 140), '/app/mentor', 'mentor_message', r.id);
    else
      perform public.notify_user(
        r.mentor_auth, 'mentoring', 'mentor_message',
        'Message from ' || r.student_name,
        left(r.body, 140), '/staff/mentees', 'mentor_message', r.id);
    end if;
  end loop;
  return null;
end;
$$;

drop trigger if exists mentor_messages_notify on public.mentor_messages;
create trigger mentor_messages_notify
  after insert on public.mentor_messages
  referencing new table as new_rows
  for each statement execute function public.notify_mentor_message();


/* ------------------------------------------------------- teaching */

create or replace function public.notify_course_assigned()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare r record;
begin
  for r in
    select n.*, l.auth_user_id
      from new_rows n
      join public.lecturers l on l.id = n.lecturer_id
     where n.is_active
  loop
    perform public.notify_user(
      r.auth_user_id, 'teaching', 'course_assigned',
      'You have been assigned to '
        || coalesce(public.offering_label(r.offering_id), 'a course'),
      case when r.assignment_role = 'coordinator'
           then 'You are the course coordinator for this offering.'
           else 'You are teaching this offering.' end,
      '/staff/courses', 'offering', r.offering_id);
  end loop;
  return null;
end;
$$;

drop trigger if exists course_lecturers_notify on public.course_lecturers;
create trigger course_lecturers_notify
  after insert on public.course_lecturers
  referencing new table as new_rows
  for each statement execute function public.notify_course_assigned();
