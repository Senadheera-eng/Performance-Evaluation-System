-- resit_updates_the_original_result_and_caps_a_repeat_at_c
-- Applied 20260822125839
-- Exported from the live project; do not edit by hand.

-- A re-sit does not create a second result. The student sat the same module
-- again, and the record of that module becomes the new outcome — so the R (or
-- L) row is updated in place. That keeps one row per student per course, which
-- is what stops a repeated module being counted twice in a GPA.
--
-- What must not be lost is why the student was there. original_grade keeps the
-- outcome being repeated, so "took this with a later batch because of an R"
-- stays legible to the student and to staff long after the grade changed.
--
-- A repeat (R) re-sit is capped: however well the student does the second
-- time, the recorded grade cannot exceed C. A medical (L) re-sit is not
-- capped — that student may still earn an A+. The cap is a faculty regulation,
-- so it lives in system_settings with the grade boundaries rather than in
-- code, and it is enforced on the row rather than in whichever screen happens
-- to be writing.

alter table public.results
  add column if not exists original_grade text;

comment on column public.results.original_grade is
  'The outcome this result replaced when the student re-sat: R (repeat) or L (medical). Null for a first attempt.';

insert into public.system_settings (key, value, description, category)
values (
  'resit_max_grade',
  '"C"'::jsonb,
  'Highest grade a repeat (R) re-sit may be awarded. A medical (L) re-sit is uncapped.',
  'grading'
) on conflict (key) do nothing;

create or replace function public.cap_resit_grade()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_cap      text;
  v_cap_gpv  numeric;
begin
  -- Only the moment an outstanding R or L becomes a real grade.
  if old.grade is null or old.grade not in ('R', 'L') then
    return new;
  end if;
  if new.grade is null or new.grade in ('R', 'L') then
    return new;   -- still outstanding, or being cleared
  end if;

  new.original_grade := coalesce(new.original_grade, old.grade);

  if old.grade = 'R' then
    select value #>> '{}' into v_cap
      from public.system_settings where key = 'resit_max_grade';
    v_cap := coalesce(v_cap, 'C');

    select (value -> v_cap)::numeric into v_cap_gpv
      from public.system_settings where key = 'gpv_scale';

    if v_cap_gpv is not null and coalesce(new.gpv, 0) > v_cap_gpv then
      new.grade := v_cap;
      new.gpv   := v_cap_gpv;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists results_cap_resit_grade on public.results;
create trigger results_cap_resit_grade
  before update on public.results
  for each row execute function public.cap_resit_grade();

revoke execute on function public.cap_resit_grade() from public, anon, authenticated;
