/*
  A badge that never clears is worse than no badge.

  The Notices count is unread notice notifications, so something has to mark
  them read, and the honest moment is when the person opens the notice — not
  when they glance at the bell, and not when they merely land on the board.

  Scoped to the caller in its own WHERE clause, like every other read-marker
  here, so passing somebody else's notice id marks nothing.
*/
create or replace function public.mark_notice_read(p_notice_id uuid)
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
     and entity_type = 'notice'
     and entity_id = p_notice_id;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

grant execute on function public.mark_notice_read(uuid) to authenticated;