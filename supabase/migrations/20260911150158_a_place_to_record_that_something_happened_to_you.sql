/*
  Notifications: a record that something happened, addressed to a person.

  Until now the only thing resembling a notification was a number on a sidebar
  item, computed on the fly from current state. That answers "is there work
  outstanding?" and it answers it well — but it cannot answer the question
  people actually ask, which is "what changed, when, and where do I go?". A
  badge reading 1 on Results tells a lecturer nothing about whether a sheet
  came back, which sheet, or why.

  These are two different things and both are worth keeping:

    the badge   is a state  — "there are 3 sheets waiting for review"
    a notification is an event — "Dr Ratnam submitted CO4204 on 11 September"

  They are deliberately not merged. A badge clears when the work is done; a
  notification stays until the person has read it, because it is a record of
  something that happened to them, not a to-do item. Anyone tempted to derive
  one from the other should read this paragraph first.

  Written only by triggers running as definer. There is no insert policy at
  all, so nothing reaching the API can address a notification to somebody
  else — which is the whole attack this table would otherwise invite.
*/

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),

  /* auth.users, because all three kinds of person live there: a student's
     row id IS their auth id, so does an admin's, and a lecturer carries
     lecturers.auth_user_id. One column addresses all of them. */
  recipient_id uuid not null references auth.users(id) on delete cascade,

  /* What sort of thing happened. Drives the icon and the grouping, and lets a
     reader filter to one kind without parsing the title. */
  kind text not null,

  /* Which part of the system it came from, for "clear source". */
  source text not null check (source in (
    'results', 'attendance', 'enrolment', 'feedback',
    'medical', 'mentoring', 'teaching'
  )),

  title text not null,
  /* What actually changed, in a sentence. Null when the title says it all. */
  body text,
  /* Where to go. A full in-app path, because the portal differs per
     recipient and the trigger is the only thing that knows which one. */
  href text,

  /* What it is about, so a later event on the same thing can find its
     predecessor rather than stacking a second card for one change. */
  entity_type text,
  entity_id uuid,

  created_at timestamptz not null default now(),
  read_at timestamptz
);

comment on table public.notifications is
  'Events addressed to a person. Written only by SECURITY DEFINER triggers; '
  'read and marked read by the recipient. Distinct from sidebar badge counts, '
  'which are current state rather than a record of what changed.';

/* The feed: one person''s notifications, newest first. */
create index if not exists notifications_recipient_idx
  on public.notifications (recipient_id, created_at desc);

/* The bell: how many are unread. Partial, because read rows are the majority
   within a week and none of them are ever counted. */
create index if not exists notifications_unread_idx
  on public.notifications (recipient_id)
  where read_at is null;

alter table public.notifications enable row level security;

/* Read your own. That is the entire client-facing surface: marking read goes
   through a function so it cannot be used to edit a title. */
drop policy if exists notifications_own_read on public.notifications;
create policy notifications_own_read on public.notifications
  for select to authenticated
  using (recipient_id = (select auth.uid()));

revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;


/* ---------------------------------------------------------------- writing */

/**
 * Address one notification to one person.
 *
 * Silently does nothing when the recipient is null (a lecturer with no login,
 * a deleted account) or is the person who caused the event — nobody needs
 * telling about their own action, and a trigger cannot easily know that
 * without being told once, here.
 */
create or replace function public.notify_user(
  p_recipient uuid,
  p_source text,
  p_kind text,
  p_title text,
  p_body text default null,
  p_href text default null,
  p_entity_type text default null,
  p_entity_id uuid default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_recipient is null then
    return;
  end if;
  -- Your own doing is not news to you.
  if p_recipient = auth.uid() then
    return;
  end if;

  insert into public.notifications
    (recipient_id, source, kind, title, body, href, entity_type, entity_id)
  values
    (p_recipient, p_source, p_kind, p_title, p_body, p_href, p_entity_type, p_entity_id);
end;
$$;

revoke execute on function public.notify_user(uuid, text, text, text, text, text, text, uuid)
  from public, anon, authenticated;


/**
 * The same, to many people at once, in one statement.
 *
 * A published sheet tells forty students; a window opening tells a hundred
 * and sixty. Doing that one insert at a time inside a trigger is how a
 * publish starts taking seconds.
 */
create or replace function public.notify_users(
  p_recipients uuid[],
  p_source text,
  p_kind text,
  p_title text,
  p_body text default null,
  p_href text default null,
  p_entity_type text default null,
  p_entity_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_actor uuid := auth.uid();
  v_n integer;
begin
  insert into public.notifications
    (recipient_id, source, kind, title, body, href, entity_type, entity_id)
  select distinct r, p_source, p_kind, p_title, p_body, p_href, p_entity_type, p_entity_id
    from unnest(coalesce(p_recipients, '{}'::uuid[])) r
   where r is not null
     and r is distinct from v_actor;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke execute on function public.notify_users(uuid[], text, text, text, text, text, text, uuid)
  from public, anon, authenticated;


/* ---------------------------------------------------------------- reading */

create or replace function public.get_my_notifications(
  p_limit integer default 50,
  p_unread_only boolean default false
)
returns table(
  id uuid,
  source text,
  kind text,
  title text,
  body text,
  href text,
  created_at timestamptz,
  read_at timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select n.id, n.source, n.kind, n.title, n.body, n.href, n.created_at, n.read_at
    from public.notifications n
   where n.recipient_id = auth.uid()
     and (not p_unread_only or n.read_at is null)
   order by n.created_at desc
   limit greatest(1, least(coalesce(p_limit, 50), 200))
$$;

grant execute on function public.get_my_notifications(integer, boolean) to authenticated;


create or replace function public.get_my_unread_notification_count()
returns integer
language sql
stable
security definer
set search_path to 'public'
as $$
  select count(*)::int from public.notifications
   where recipient_id = auth.uid() and read_at is null
$$;

grant execute on function public.get_my_unread_notification_count() to authenticated;


/**
 * Mark some or all of mine read.
 *
 * Null means all of them. Scoped to the caller in the WHERE clause rather
 * than trusting the ids passed in, so a guessed id belonging to someone else
 * matches nothing instead of marking their mail read.
 */
create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_n integer;
begin
  update public.notifications
     set read_at = now()
   where recipient_id = auth.uid()
     and read_at is null
     and (p_ids is null or id = any(p_ids));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

grant execute on function public.mark_notifications_read(uuid[]) to authenticated;
