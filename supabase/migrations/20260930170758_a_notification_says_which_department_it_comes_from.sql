-- A notification says which department it comes from, so the notification
-- list can carry that department's colour the way every other list does.
--
-- Every notification already points at the thing it is about (entity_type,
-- entity_id). The department is read from there rather than stored twice:
--   enrollment_period / feedback_period  -> the period's department
--                                           (null: faculty-wide)
--   offering / attendance_session        -> the course's department
--   mentor_assignment                    -> the other person's department:
--                                           the mentor's for a student, the
--                                           mentee's for a lecturer
--   mentor_message                       -> the sender's department
-- Anything else, or a row since deleted, gives null and stays neutral.
--
-- The return type gains a column, so the function is dropped and made again;
-- the columns it already returned are unchanged.

drop function if exists public.get_my_notifications(integer, boolean);

create function public.get_my_notifications(
  p_limit integer default 50,
  p_unread_only boolean default false
)
returns table (
  id uuid,
  source text,
  kind text,
  title text,
  body text,
  href text,
  created_at timestamptz,
  read_at timestamptz,
  department text
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select n.id, n.source, n.kind, n.title, n.body, n.href, n.created_at, n.read_at,
         case n.entity_type
           when 'enrollment_period' then
             (select ep.department from public.enrollment_periods ep where ep.id = n.entity_id)
           when 'feedback_period' then
             (select fp.department from public.feedback_periods fp where fp.id = n.entity_id)
           when 'offering' then
             (select c.department
                from public.course_offerings o
                join public.courses c on c.id = o.course_id
               where o.id = n.entity_id)
           when 'attendance_session' then
             (select c.department
                from public.attendance_sessions s
                join public.course_offerings o on o.id = s.offering_id
                join public.courses c on c.id = o.course_id
               where s.id = n.entity_id)
           when 'mentor_assignment' then
             (select case when n.kind = 'mentee_assigned' then st.department else l.department end
                from public.mentor_assignments a
                join public.students st on st.id = a.student_id
                join public.lecturers l on l.id = a.mentor_id
               where a.id = n.entity_id)
           when 'mentor_message' then
             (select case when m.sender_role = 'student' then st.department else l.department end
                from public.mentor_messages m
                join public.mentor_assignments a on a.id = m.assignment_id
                join public.students st on st.id = a.student_id
                join public.lecturers l on l.id = a.mentor_id
               where m.id = n.entity_id)
         end as department
    from public.notifications n
   where n.recipient_id = auth.uid()
     and (not p_unread_only or n.read_at is null)
   order by n.created_at desc
   limit greatest(1, least(coalesce(p_limit, 50), 200))
$$;

revoke execute on function public.get_my_notifications(integer, boolean) from public, anon;
grant execute on function public.get_my_notifications(integer, boolean) to authenticated;
