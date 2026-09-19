-- a_mentor_and_their_student_can_talk
-- Applied 20260830143626
-- Exported from the live project; do not edit by hand.

-- A mentor and their student can talk.
--
-- The conversation hangs off the assignment rather than off the pair. That
-- is the whole design decision here: when a student is moved to a new mentor,
-- the new mentor does not inherit the old one's messages. A student who wrote
-- to one lecturer about something difficult did not write it to whoever
-- replaces them, and a thread that silently changes audience is worse than
-- one that ends.
--
-- The old mentor keeps their thread, read-only, because they can no longer
-- send to a student who is not theirs. The student keeps both, because both
-- are theirs.
--
-- Nobody writes a sender id. The assignment already names exactly two people;
-- a message says which side it came from and the row supplies who that is, so
-- a crafted request cannot post as somebody else.

create table if not exists public.mentor_messages (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.mentor_assignments(id) on delete cascade,
  sender_role   text not null check (sender_role in ('student', 'mentor')),
  body          text not null check (btrim(body) <> ''),
  sent_at       timestamptz not null default now(),
  -- Set when the other side has seen it. The sender's own messages are never
  -- marked: you have read what you wrote.
  read_at       timestamptz
);

create index if not exists mentor_messages_thread
  on public.mentor_messages (assignment_id, sent_at);

-- Unread counting hits this constantly: one partial index rather than a scan.
create index if not exists mentor_messages_unread
  on public.mentor_messages (assignment_id, sender_role) where read_at is null;

comment on table public.mentor_messages is
  'Messages between a student and their academic mentor, keyed to the assignment so a reassignment starts a new conversation.';

alter table public.mentor_messages enable row level security;

-- Both sides of the assignment may read the thread; nobody else, including
-- the head of department. Mentoring conversations are not departmental
-- correspondence.
create policy mentor_messages_participants_read on public.mentor_messages
  for select using (exists (
    select 1
      from public.mentor_assignments ma
      left join public.lecturers l on l.id = ma.mentor_id
     where ma.id = mentor_messages.assignment_id
       and (ma.student_id = auth.uid() or l.auth_user_id = auth.uid())));

-- Writing goes through send_mentor_message, which decides which side you are.

/* ------------------------------------------------------------------ */
/* Reading a thread                                                    */
/* ------------------------------------------------------------------ */

-- Resolves the assignment the caller is allowed to talk on, and which side of
-- it they are. Null when they are neither.
create or replace function public.my_mentor_thread(p_student_id uuid)
returns table(assignment_id uuid, my_role text, is_current boolean)
language sql stable security definer set search_path to 'public'
as $$
  select ma.id,
         case when ma.student_id = auth.uid() then 'student' else 'mentor' end,
         ma.ended_at is null
    from public.mentor_assignments ma
    left join public.lecturers l on l.id = ma.mentor_id and l.status = 'active'
   where ma.student_id = p_student_id
     and (ma.student_id = auth.uid() or l.auth_user_id = auth.uid())
   -- The open assignment if there is one, otherwise the most recent.
   order by (ma.ended_at is null) desc, ma.assigned_at desc
   limit 1;
$$;

grant execute on function public.my_mentor_thread(uuid) to authenticated;

-- The conversation, plus who the other person is. Passing null means "me",
-- which is how a student asks for their own.
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

  -- Whoever the caller is not.
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
           'mine', m.sender_role = v_thread.my_role)
         order by m.sent_at)
    into v_msgs
    from public.mentor_messages m
   where m.assignment_id = v_thread.assignment_id;

  return jsonb_build_object(
    'thread', jsonb_build_object(
      'assignment_id', v_thread.assignment_id,
      'my_role', v_thread.my_role,
      -- A closed assignment is still readable, but nothing more can be said
      -- on it. The page uses this to explain why the box is gone.
      'is_current', v_thread.is_current,
      'other', v_other,
      'messages', coalesce(v_msgs, '[]'::jsonb)));
end;
$$;

grant execute on function public.get_mentor_thread(uuid) to authenticated;

/* ------------------------------------------------------------------ */
/* Saying something                                                    */
/* ------------------------------------------------------------------ */

create or replace function public.send_mentor_message(
  p_body text, p_student_id uuid default null)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_student uuid := coalesce(p_student_id, auth.uid());
  v_thread  record;
  v_id      uuid;
begin
  if coalesce(btrim(p_body), '') = '' then
    raise exception 'Write something first';
  end if;
  if length(p_body) > 4000 then
    raise exception 'That message is too long. Keep it under 4000 characters.';
  end if;

  select * into v_thread from public.my_mentor_thread(v_student);
  if v_thread.assignment_id is null then
    raise exception 'You have no mentoring relationship with that person';
  end if;
  if not v_thread.is_current then
    raise exception 'That mentoring assignment has ended, so the conversation is closed';
  end if;

  insert into public.mentor_messages (assignment_id, sender_role, body)
  values (v_thread.assignment_id, v_thread.my_role, btrim(p_body))
  returning id into v_id;

  return jsonb_build_object('ok', true, 'message_id', v_id);
end;
$$;

grant execute on function public.send_mentor_message(text, uuid) to authenticated;

-- Marks what the other side sent as seen. Never touches your own messages.
create or replace function public.mark_mentor_thread_read(
  p_student_id uuid default null)
returns integer
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_student uuid := coalesce(p_student_id, auth.uid());
  v_thread  record;
  v_n       integer;
begin
  select * into v_thread from public.my_mentor_thread(v_student);
  if v_thread.assignment_id is null then return 0; end if;

  update public.mentor_messages
     set read_at = now()
   where assignment_id = v_thread.assignment_id
     and sender_role <> v_thread.my_role
     and read_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

grant execute on function public.mark_mentor_thread_read(uuid) to authenticated;

/* ------------------------------------------------------------------ */
/* How many are waiting                                                */
/* ------------------------------------------------------------------ */

-- Unread messages addressed to the caller, whichever side they are on.
create or replace function public.my_unread_mentor_messages()
returns integer
language sql stable security definer set search_path to 'public'
as $$
  select count(*)::int
    from public.mentor_messages m
    join public.mentor_assignments ma on ma.id = m.assignment_id
    left join public.lecturers l on l.id = ma.mentor_id and l.status = 'active'
   where m.read_at is null
     and ((ma.student_id = auth.uid()      and m.sender_role = 'mentor')
       or (l.auth_user_id = auth.uid()     and m.sender_role = 'student'));
$$;

grant execute on function public.my_unread_mentor_messages() to authenticated;

-- Per mentee, so the mentor's list can show which conversations are waiting.
create or replace function public.my_mentee_unread()
returns table(student_id uuid, unread integer, last_message_at timestamptz)
language sql stable security definer set search_path to 'public'
as $$
  select ma.student_id,
         count(*) filter (where m.read_at is null
                            and m.sender_role = 'student')::int,
         max(m.sent_at)
    from public.mentor_assignments ma
    join public.lecturers l on l.id = ma.mentor_id
    left join public.mentor_messages m on m.assignment_id = ma.id
   where l.auth_user_id = auth.uid() and l.status = 'active'
     and ma.ended_at is null
   group by ma.student_id;
$$;

grant execute on function public.my_mentee_unread() to authenticated;
