/*
  My Mentees showed 1 for ever.

  On 30 August a student wrote to their mentor and the mentoring assignment
  was ended twenty-three seconds later. The message was never read, and never
  could be: the Mentees page lists current mentees, so the thread it belongs
  to is not on the screen any more. The badge pointed at a conversation with
  no way to open it, and no amount of reading anything else would bring it
  down.

  Two functions answer "how many unread messages", and they disagreed. The
  per-mentee counts behind the page carry "and ma.ended_at is null"; the
  single number behind the badge did not. So the page could show nothing
  outstanding across all five mentees while the sidebar insisted on one —
  both correct about what they were each counting, and one of them counting
  the wrong thing.

  Ending a mentorship closes the conversation. What was said in it stays on
  the record, but it stops being something anybody is waiting on, so it stops
  being counted. The same applies in the other direction: a student whose
  mentor changed had an unread message from the old one stuck to their Mentor
  badge in exactly the same way.
*/
create or replace function public.my_unread_mentor_messages()
returns integer
language sql
stable
security definer
set search_path to 'public'
as $$
  select count(*)::int
    from public.mentor_messages m
    join public.mentor_assignments ma on ma.id = m.assignment_id
    left join public.lecturers l on l.id = ma.mentor_id and l.status = 'active'
   where m.read_at is null
     -- The one line that was missing, and the reason the badge stuck.
     and ma.ended_at is null
     and ((ma.student_id = auth.uid()      and m.sender_role = 'mentor')
       or (l.auth_user_id = auth.uid()     and m.sender_role = 'student'));
$$;