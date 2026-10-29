-- Saved what-ifs for the Graduation Planner.
--
-- A student tries grades for this semester, plans an SGPA for a semester
-- ahead, or changes a past grade to see what it would have done. Those
-- what-ifs lived in one browser, so a plan made on a laptop was not there on
-- a phone. They are kept here, with the student's account, as named
-- scenarios ("Realistic", "Best case") that can be compared. They are the
-- student's own: nobody else reads them, and they never touch the record.
create table if not exists public.planner_scenarios (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null default auth.uid() references public.students (id) on delete cascade,
  name        text not null,
  -- Course id -> expected grade, for courses being sat or still to clear.
  guesses     jsonb not null default '{}'::jsonb,
  -- Semester -> planned SGPA.
  plans       jsonb not null default '{}'::jsonb,
  -- Result id -> a past grade tried differently.
  past        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint planner_scenarios_name_length check (char_length(btrim(name)) between 1 and 40),
  constraint planner_scenarios_objects check (
    jsonb_typeof(guesses) = 'object' and jsonb_typeof(plans) = 'object' and jsonb_typeof(past) = 'object'),
  constraint planner_scenarios_size check (
    pg_column_size(guesses) + pg_column_size(plans) + pg_column_size(past) < 32768)
);

create unique index if not exists planner_scenarios_name_unique
  on public.planner_scenarios (student_id, lower(btrim(name)));

alter table public.planner_scenarios enable row level security;
revoke all on public.planner_scenarios from anon;
grant select, insert, update, delete on public.planner_scenarios to authenticated;

drop policy if exists planner_scenarios_own on public.planner_scenarios;
create policy planner_scenarios_own on public.planner_scenarios
  for all to authenticated
  using (student_id = auth.uid() and public.account_is_active(auth.uid()))
  with check (student_id = auth.uid() and public.account_is_active(auth.uid()));

-- Ten is plenty to compare, and keeps the table from becoming a store.
create or replace function public.planner_scenarios_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if (select count(*) from public.planner_scenarios s where s.student_id = new.student_id) >= 10 then
      raise exception 'You can keep up to 10 scenarios. Delete one to add another.';
    end if;
  end if;
  new.name := btrim(new.name);
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists planner_scenarios_guard on public.planner_scenarios;
create trigger planner_scenarios_guard
  before insert or update on public.planner_scenarios
  for each row execute function public.planner_scenarios_guard();
