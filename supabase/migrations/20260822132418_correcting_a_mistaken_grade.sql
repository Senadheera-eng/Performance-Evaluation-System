-- correcting_a_mistaken_grade
-- Applied 20260822132418
-- Exported from the live project; do not edit by hand.

-- The cap on a repeat re-sit is enforced on the row, which is what makes it
-- reliable — but it also caught the case nobody wanted it to. If an R was
-- entered by mistake and the student's real grade is a B+, editing it back
-- clamped it to C, because from the row's point of view that is a repeat being
-- graded. There was no way out short of superuser access.
--
-- A correction is therefore a different act from grading, with its own
-- function, its own authorisation and its own audit trail. The trigger honours
-- a transaction-local flag that only that function can set: a client cannot
-- run SET, so this cannot be reached from the API by any other route.

alter table public.results
  add column if not exists corrected_by       uuid references auth.users(id) on delete set null,
  add column if not exists corrected_at       timestamptz,
  add column if not exists correction_reason  text;

comment on column public.results.correction_reason is
  'Why a grade was corrected outside the normal workflow — e.g. an R entered in error. Null for an ordinary result.';

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
  -- An authorised correction is not a re-sit, so nothing here applies.
  if coalesce(current_setting('pes.grade_correction', true), '') = 'on' then
    return new;
  end if;

  if old.grade is null or old.grade not in ('R', 'L') then
    return new;
  end if;
  if new.grade is null or new.grade in ('R', 'L') then
    return new;
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

/** Put a grade right when it was recorded in error.
 *
 *  Only the department that owns the course, and only with a reason — a
 *  correction that leaves no explanation is indistinguishable from tampering
 *  when someone reads the record a year later. */
create or replace function public.correct_result_grade(
  p_result_id uuid,
  p_grade     text,
  p_reason    text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_department text;
  v_old        text;
  v_gpv        numeric;
begin
  select c.department, r.grade into v_department, v_old
    from public.results r
    join public.courses c on c.id = r.course_id
   where r.id = p_result_id;

  if v_department is null then
    raise exception 'That result does not exist';
  end if;

  if not (coalesce(public.get_my_role(), '') = 'super_admin'
          or (coalesce(public.get_my_role(), '') = 'dept_admin'
              and public.get_my_department() = v_department)) then
    raise exception 'Only the department that owns this course can correct a grade';
  end if;

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Give a reason for the correction';
  end if;

  select (value -> p_grade)::numeric into v_gpv
    from public.system_settings where key = 'gpv_scale';
  if v_gpv is null then
    raise exception '% is not a grade this faculty awards', p_grade;
  end if;

  -- Tells the trigger this is a correction rather than a re-sit being graded.
  perform set_config('pes.grade_correction', 'on', true);

  update public.results
     set grade             = p_grade,
         gpv               = v_gpv,
         original_grade    = null,
         corrected_by      = auth.uid(),
         corrected_at      = now(),
         correction_reason = btrim(p_reason)
   where id = p_result_id;

  perform set_config('pes.grade_correction', 'off', true);

  return jsonb_build_object('ok', true,
    'message', format('Corrected from %s to %s.', coalesce(v_old, '—'), p_grade));
end;
$$;

revoke execute on function public.cap_resit_grade()                       from public, anon, authenticated;
revoke execute on function public.correct_result_grade(uuid, text, text)  from public, anon;
grant  execute on function public.correct_result_grade(uuid, text, text)  to authenticated;
