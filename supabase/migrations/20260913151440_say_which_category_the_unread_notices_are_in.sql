/*
  The sidebar says there is one unread notice. Quick Access is where someone
  then looks for it, and it said nothing — so the count told them something
  was waiting and then left them to open nine categories to find out which.

  Same number, broken down by where it actually is. It comes from the same
  unread notice notifications the sidebar badge counts, so the parts always
  add up to the whole: there is one fact here, reported at two levels of
  detail, not two counts that could drift apart.
*/
create or replace function public.get_my_unread_notice_counts()
returns table(category text, unread integer)
language sql
stable
security definer
set search_path to 'public'
as $$
  select n.category, count(*)::int
    from public.notifications f
    join public.notices n on n.id = f.entity_id
   where f.recipient_id = auth.uid()
     and f.source = 'notices'
     and f.entity_type = 'notice'
     and f.read_at is null
   group by n.category
$$;

grant execute on function public.get_my_unread_notice_counts() to authenticated;