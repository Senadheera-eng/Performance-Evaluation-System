-- lecturer_can_resubmit_and_withdraw_feedback_requests
-- Applied 20260809035908
-- Exported from the live project; do not edit by hand.

-- Two gaps in the lecturer-created feedback period lifecycle, both found
-- while building the screen a lecturer actually uses.
--
-- 1. Rejecting says "the lecturer can revise it and ask again", but asking
--    again was impossible. protect_lecturer_feedback_period() pins
--    approval_status to its old value for the row's own author, so a rejected
--    form could be edited forever and never return to the department's
--    queue — which only lists approval_status = 'pending'. The rejection was
--    effectively permanent.
--
-- 2. There was no delete policy for the author at all. A request raised by
--    mistake sat in the department's queue with nobody able to take it back,
--    and an abandoned rejected form stayed on the lecturer's list for good.

create or replace function public.protect_lecturer_feedback_period()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if old.created_by_lecturer_id is not null
     and old.created_by_lecturer_id = public.my_lecturer_id() then

    if old.approval_status = 'rejected' and new.approval_status = 'pending' then
      -- The one verdict move that belongs to the author: asking again. The
      -- previous decision is cleared with it, so the department's queue shows
      -- a fresh request rather than one carrying an old rejection note.
      new.approved_by    := null;
      new.approved_at    := null;
      new.approval_notes := null;
    else
      new.approval_status := old.approval_status;
      new.approved_by     := old.approved_by;
      new.approved_at     := old.approved_at;
      new.approval_notes  := old.approval_notes;
    end if;

    new.created_by_lecturer_id := old.created_by_lecturer_id;
    new.department             := old.department;

    if new.approval_status = 'approved' then
      new.title         := old.title;
      new.academic_year := old.academic_year;
      new.semester      := old.semester;
      new.batch_year    := old.batch_year;
      new.opens_at      := old.opens_at;
      new.closes_at     := old.closes_at;
      new.feedback_type := old.feedback_type;
      new.allow_editing := old.allow_editing;
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.protect_lecturer_feedback_period() from public, anon, authenticated;

-- Withdrawing is only ever available before the department has approved, so
-- nothing that was signed off — or that students have seen — can be removed.
-- feedback_submissions references periods with no cascade, so even if this
-- policy were widened a period with responses could not be deleted.
drop policy if exists fp_lecturer_delete_own on public.feedback_periods;

create policy fp_lecturer_delete_own on public.feedback_periods
  for delete to authenticated
  using (
    created_by_lecturer_id is not null
    and created_by_lecturer_id = my_lecturer_id()
    and status = 'draft'
    and approval_status in ('pending', 'rejected')
  );
