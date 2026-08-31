-- the_thread_hands_back_the_files_too
-- Applied 20260831033651
-- Exported from the live project; do not edit by hand.

-- The thread hands back the files too.
--
-- The reader was written before messages could carry anything but text, so
-- it returned the words and dropped the attachment. A message that is only a
-- file would have come back looking empty.
--
-- The path is returned rather than a link. Signing a URL costs a round trip
-- to storage per file, and a thread of forty messages does not need forty
-- signatures prepared for a reader who will open one of them. The page signs
-- on demand, and a signature that expires is one the reader can ask for
-- again.

create or replace function public.get_mentor_thread(p_student_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_student uuid := coalesce(p_student_id, auth.uid());
  v_thread  record;
  v_other   jsonb;
  v_msgs    jsonb;
begin
  select * into v_thread from public.my_mentor_thread(v_student);
  if v_thread.assignment_id is null then
    return jsonb_build_object('thread', null);
  end if;

  if v_thread.my_role = 'student' then
    select jsonb_build_object(
             'name', coalesce(l.title || ' ', '') || l.name,
             'email', l.email, 'role', 'mentor')
      into v_other
      from public.mentor_assignments ma
      join public.lecturers l on l.id = ma.mentor_id
     where ma.id = v_thread.assignment_id;
  else
    select jsonb_build_object(
             'name', s.name, 'email', s.email, 'role', 'student',
             'index_number', s.index_number)
      into v_other
      from public.mentor_assignments ma
      join public.students s on s.id = ma.student_id
     where ma.id = v_thread.assignment_id;
  end if;

  select jsonb_agg(jsonb_build_object(
           'id', m.id, 'sender_role', m.sender_role, 'body', m.body,
           'sent_at', m.sent_at, 'read_at', m.read_at,
           'mine', m.sender_role = v_thread.my_role,
           'attachment', case when m.attachment_path is null then null else
             jsonb_build_object(
               'path', m.attachment_path,
               'name', m.attachment_name,
               'size', m.attachment_size,
               'type', m.attachment_type) end)
         order by m.sent_at)
    into v_msgs
    from public.mentor_messages m
   where m.assignment_id = v_thread.assignment_id;

  return jsonb_build_object(
    'thread', jsonb_build_object(
      'assignment_id', v_thread.assignment_id,
      'my_role', v_thread.my_role,
      'is_current', v_thread.is_current,
      'other', v_other,
      'messages', coalesce(v_msgs, '[]'::jsonb)));
end;
$$;

grant execute on function public.get_mentor_thread(uuid) to authenticated;

-- Realtime delivers a row, not a rendered message, so the page needs to turn
-- one row into the same shape the thread returns. Given a message id it
-- answers with that one message, or nothing if the caller is not on its
-- conversation.
create or replace function public.get_mentor_message(p_message_id uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_row  record;
  v_role text;
begin
  select m.*, ma.student_id, ma.mentor_id
    into v_row
    from public.mentor_messages m
    join public.mentor_assignments ma on ma.id = m.assignment_id
   where m.id = p_message_id;
  if v_row.id is null then return null; end if;

  select case when v_row.student_id = auth.uid() then 'student'
              when exists (select 1 from public.lecturers l
                            where l.id = v_row.mentor_id
                              and l.auth_user_id = auth.uid()
                              and l.status = 'active') then 'mentor'
         end
    into v_role;
  if v_role is null then return null; end if;

  return jsonb_build_object(
    'id', v_row.id, 'sender_role', v_row.sender_role, 'body', v_row.body,
    'sent_at', v_row.sent_at, 'read_at', v_row.read_at,
    'mine', v_row.sender_role = v_role,
    'attachment', case when v_row.attachment_path is null then null else
      jsonb_build_object(
        'path', v_row.attachment_path,
        'name', v_row.attachment_name,
        'size', v_row.attachment_size,
        'type', v_row.attachment_type) end);
end;
$$;

grant execute on function public.get_mentor_message(uuid) to authenticated;
