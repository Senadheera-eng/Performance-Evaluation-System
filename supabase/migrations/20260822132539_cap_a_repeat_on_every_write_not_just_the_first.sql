-- cap_a_repeat_on_every_write_not_just_the_first
-- Applied 20260822132539
-- Exported from the live project; do not edit by hand.

-- The cap was applied at the moment an R became a real grade, and nowhere
-- else. So the second edit escaped it: R -> A+ clamped to C, and then C -> A+
-- went straight through, because by then the old grade was C and the trigger
-- had nothing to react to. The regulation was enforced once rather than held.
--
-- It is now a property of the row. Once a result is marked as a repeat it
-- cannot exceed the cap on any write, and original_grade cannot be quietly
-- cleared to escape it either. Correcting a grade entered in error is still
-- possible, but only through correct_result_grade, which authorises the caller
-- and records why.

create or replace function public.cap_resit_grade()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_origin   text;
  v_cap      text;
  v_cap_gpv  numeric;
begin
  -- An authorised correction says this was never a repeat.
  if coalesce(current_setting('pes.grade_correction', true), '') = 'on' then
    return new;
  end if;

  -- What this row is repeating, if anything: what it already carried, or the
  -- outcome it is replacing right now.
  v_origin := coalesce(new.original_grade, old.original_grade);
  if old.grade in ('R', 'L')
     and new.grade is not null and new.grade not in ('R', 'L') then
    v_origin := coalesce(v_origin, old.grade);
  end if;

  -- Pinned, so it cannot be nulled out on the way past.
  new.original_grade := v_origin;

  if v_origin = 'R'
     and new.grade is not null and new.grade not in ('R', 'L') then
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

revoke execute on function public.cap_resit_grade() from public, anon, authenticated;
