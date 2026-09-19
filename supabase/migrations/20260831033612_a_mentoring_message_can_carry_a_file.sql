-- a_mentoring_message_can_carry_a_file
-- Applied 20260831033612
-- Exported from the live project; do not edit by hand.

-- A mentoring message can carry a file.
--
-- A student asking about a result sheet, a mentor sending back a form: the
-- conversation is not much use if everything has to be typed. One file per
-- message, with the text optional, because that is how sending a document
-- with a note attached actually works.
--
-- Files live under the assignment they were sent in, so the storage rule is
-- the same rule as the conversation's: the two people on that assignment,
-- nobody else. Not the head of department, not an admin. A path is checked
-- rather than trusted -- the client chooses where it uploads, so the function
-- refuses a path that does not begin with an assignment the sender is on.

alter table public.mentor_messages
  add column if not exists attachment_path text,
  add column if not exists attachment_name text,
  add column if not exists attachment_size bigint,
  add column if not exists attachment_type text;

-- The body was required. Now a message needs a body or a file, and an
-- attachment must arrive complete rather than as a path with no name.
alter table public.mentor_messages
  drop constraint if exists mentor_messages_body_check;
alter table public.mentor_messages
  alter column body drop not null;

alter table public.mentor_messages
  drop constraint if exists mentor_messages_says_something;
alter table public.mentor_messages
  add constraint mentor_messages_says_something check (
    coalesce(btrim(body), '') <> '' or attachment_path is not null);

alter table public.mentor_messages
  drop constraint if exists mentor_messages_attachment_complete;
alter table public.mentor_messages
  add constraint mentor_messages_attachment_complete check (
    attachment_path is null
    or (coalesce(btrim(attachment_name), '') <> '' and attachment_size is not null));

/* ------------------------------------------------------------------ */
/* Where the files live                                                */
/* ------------------------------------------------------------------ */

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mentor-attachments', 'mentor-attachments', false, 10485760,
        array['image/png','image/jpeg','image/gif','image/webp','image/heic',
              'application/pdf','text/plain','text/csv',
              'application/msword',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'application/vnd.ms-excel',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'application/vnd.ms-powerpoint',
              'application/vnd.openxmlformats-officedocument.presentationml.presentation',
              'application/zip'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- The first folder of the path is the assignment. Both sides of that
-- assignment may read and write inside it; everyone else is refused, and
-- that includes a lecturer who used to mentor the student but does not now.
create or replace function public.is_mentor_thread_participant(p_assignment_id uuid)
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1
      from public.mentor_assignments ma
      left join public.lecturers l on l.id = ma.mentor_id and l.status = 'active'
     where ma.id = p_assignment_id
       and (ma.student_id = auth.uid() or l.auth_user_id = auth.uid()));
$$;

grant execute on function public.is_mentor_thread_participant(uuid) to authenticated;

drop policy if exists mentor_attachments_read on storage.objects;
create policy mentor_attachments_read on storage.objects
  for select to authenticated
  using (bucket_id = 'mentor-attachments'
     and public.is_mentor_thread_participant(
           ((storage.foldername(name))[1])::uuid));

drop policy if exists mentor_attachments_write on storage.objects;
create policy mentor_attachments_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'mentor-attachments'
          and public.is_mentor_thread_participant(
                ((storage.foldername(name))[1])::uuid));

-- Deleting is for cleaning up an upload that never became a message. Once a
-- message exists the file is part of the conversation and stays.
drop policy if exists mentor_attachments_delete on storage.objects;
create policy mentor_attachments_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'mentor-attachments'
     and public.is_mentor_thread_participant(
           ((storage.foldername(name))[1])::uuid)
     and not exists (select 1 from public.mentor_messages m
                      where m.attachment_path = storage.objects.name));

/* ------------------------------------------------------------------ */
/* Sending                                                             */
/* ------------------------------------------------------------------ */

create or replace function public.send_mentor_message(
  p_body            text default null,
  p_student_id      uuid default null,
  p_attachment_path text default null,
  p_attachment_name text default null,
  p_attachment_size bigint default null,
  p_attachment_type text default null)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_student uuid := coalesce(p_student_id, auth.uid());
  v_thread  record;
  v_id      uuid;
  v_sent    timestamptz;
begin
  if coalesce(btrim(p_body), '') = '' and p_attachment_path is null then
    raise exception 'Write something, or attach a file';
  end if;
  if length(coalesce(p_body, '')) > 4000 then
    raise exception 'That message is too long. Keep it under 4000 characters.';
  end if;

  select * into v_thread from public.my_mentor_thread(v_student);
  if v_thread.assignment_id is null then
    raise exception 'You have no mentoring relationship with that person';
  end if;
  if not v_thread.is_current then
    raise exception 'That mentoring assignment has ended, so the conversation is closed';
  end if;

  -- The client picked the upload path, so it is checked rather than trusted:
  -- a file must sit under the assignment this message belongs to.
  if p_attachment_path is not null
     and split_part(p_attachment_path, '/', 1) <> v_thread.assignment_id::text then
    raise exception 'That file does not belong to this conversation';
  end if;

  insert into public.mentor_messages
    (assignment_id, sender_role, body,
     attachment_path, attachment_name, attachment_size, attachment_type)
  values (v_thread.assignment_id, v_thread.my_role, nullif(btrim(p_body), ''),
          p_attachment_path, p_attachment_name, p_attachment_size, p_attachment_type)
  returning id, sent_at into v_id, v_sent;

  return jsonb_build_object('ok', true, 'message_id', v_id, 'sent_at', v_sent);
end;
$$;

grant execute on function public.send_mentor_message(text, uuid, text, text, bigint, text)
  to authenticated;

-- The old five-less signature would still resolve for callers passing only
-- the first two arguments, but leaving both around makes which one runs a
-- coin toss. One function, one shape.
drop function if exists public.send_mentor_message(text, uuid);

/* ------------------------------------------------------------------ */
/* Delivering it without waiting for a poll                            */
/* ------------------------------------------------------------------ */

-- Realtime replays row changes to subscribers, and checks each subscriber's
-- RLS before it does -- so the policy that already limits this table to the
-- two participants is what keeps a conversation off everyone else's socket.
alter table public.mentor_messages replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public' and tablename = 'mentor_messages'
  ) then
    alter publication supabase_realtime add table public.mentor_messages;
  end if;
end
$$;
