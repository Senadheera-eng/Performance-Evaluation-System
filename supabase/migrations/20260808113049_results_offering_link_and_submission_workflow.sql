-- results_offering_link_and_submission_workflow
-- Applied 20260808113049
-- Exported from the live project; do not edit by hand.

-- Results gain (a) a link to the offering that produced them, so a lecturer's
-- access can be resolved from their teaching assignment, and (b) a review
-- state, because "lecturer enters, department admin publishes" is a two-party
-- workflow that a single is_published boolean cannot express.

alter table public.results
  add column if not exists offering_id  uuid references public.course_offerings(id) on delete set null,
  add column if not exists status       text not null default 'draft',
  add column if not exists entered_by   uuid references auth.users(id) on delete set null,
  add column if not exists submitted_by uuid references auth.users(id) on delete set null,
  add column if not exists submitted_at timestamptz,
  add column if not exists returned_by  uuid references auth.users(id) on delete set null,
  add column if not exists returned_at  timestamptz,
  add column if not exists return_notes text;

alter table public.results drop constraint if exists results_status_check;
alter table public.results
  add constraint results_status_check
  check (status in ('draft', 'submitted', 'published'));

-- Resolve each existing result to its offering. The offering key is
-- (course, academic year, the student's own batch) — which is why a repeat
-- candidate's row correctly lands on their own batch's offering rather than
-- the cohort they sat the exam alongside.
update public.results r
   set offering_id = o.id
  from public.course_offerings o,
       public.students s
 where s.id = r.student_id
   and o.course_id     = r.course_id
   and o.academic_year = r.academic_year
   and o.batch_year    = s.batch_year
   and r.offering_id is null;

-- Everything already visible to students is, by definition, published.
update public.results
   set status = 'published'
 where is_published = true and status <> 'published';

-- is_published stays as the authoritative flag for the existing student and
-- admin policies, so nothing that reads it needs to change today; status is
-- what the new workflow drives. This keeps the two from ever disagreeing,
-- whichever one a caller writes.
create or replace function public.sync_result_publication_state()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'published' then
      new.is_published := true;
    elsif new.is_published then
      new.status := 'published';
    else
      new.is_published := false;
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    new.is_published := (new.status = 'published');
  elsif new.is_published is distinct from old.is_published then
    -- A legacy caller flipped the boolean without touching status. Unpublishing
    -- returns the row to draft; it does not silently resurrect a stale
    -- 'submitted' state that nobody re-submitted.
    new.status := case when new.is_published then 'published' else 'draft' end;
  end if;
  return new;
end;
$$;

drop trigger if exists results_sync_publication_state on public.results;
create trigger results_sync_publication_state
  before insert or update on public.results
  for each row execute function public.sync_result_publication_state();

revoke execute on function public.sync_result_publication_state() from public, anon, authenticated;

create index if not exists results_offering_idx on public.results (offering_id);
create index if not exists results_status_idx   on public.results (status);
