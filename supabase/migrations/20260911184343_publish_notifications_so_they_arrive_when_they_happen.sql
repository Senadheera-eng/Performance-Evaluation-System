/*
  Realtime for notifications.

  Polling every sixty seconds meant a student could be looking at the results
  page for most of a minute after their grade was published and see nothing.
  The event is written by whoever caused it — a department publishing a sheet,
  a lecturer opening a register — always in a different session from the one
  waiting to hear about it, so there is nothing local that could ever tell
  this tab sooner. Publishing the table is what closes that gap.

  Realtime applies the same row security as everything else: the only SELECT
  policy on this table is recipient_id = auth.uid(), so a subscriber is sent
  their own rows and nobody else's. The client also filters by recipient on
  the server side, which is belt and braces rather than the protection — the
  policy is the protection.

  Replica identity stays default. It sends the whole new row on insert, which
  is all a notification needs; nothing here cares what a row looked like
  before it was marked read.
*/

do $$
begin
  if not exists (
    select 1 from pg_publication_rel pr
      join pg_publication p on p.oid = pr.prpubid
      join pg_class c on c.oid = pr.prrelid
      join pg_namespace n on n.oid = c.relnamespace
     where p.pubname = 'supabase_realtime'
       and n.nspname = 'public'
       and c.relname = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
