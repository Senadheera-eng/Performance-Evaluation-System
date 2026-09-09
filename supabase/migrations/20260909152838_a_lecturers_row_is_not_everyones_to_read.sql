/*
  Every signed-in account could read every column of every lecturer.

  lecturers_read was `using (true)`, so any student could list all forty-one
  staff rows and, with them, each lecturer's auth_user_id — the identifier the
  whole row-level security scheme compares against auth.uid() — plus their
  email and staff number. Nothing in the application ever asked for that. The
  only client that reads this table directly is the sign-in path, and it looks
  up the caller's own row by auth_user_id; every list of colleagues, mentors or
  assignable staff comes from a security definer function that applies its own
  rules and is unaffected by this policy.

  So the read is narrowed to the caller's own row. Management access is not
  added here because it already exists: the dept_admin, HOD and super_admin
  policies on this table are FOR ALL, which includes SELECT, and they keep
  seeing exactly the staff they could see before — a department admin their
  department, a super admin the faculty.

  Four policies on other tables join lecturers inline rather than through a
  definer function (mentor_assignments, mentor_messages, mentor_notes and the
  feedback_periods insert check). Each of them resolves to the caller's own
  lecturer row, so each still passes. The mentor_messages join is a LEFT JOIN,
  which is what keeps a student's side of a mentoring thread readable when the
  lecturer row beside it is not.
*/

drop policy if exists lecturers_read on public.lecturers;

create policy lecturers_read_self on public.lecturers
  for select to authenticated
  using (auth_user_id = (select auth.uid()));
