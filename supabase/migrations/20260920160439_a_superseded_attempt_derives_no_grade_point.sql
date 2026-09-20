-- The grade point is derived from the grade, every time — unless a later
-- attempt has replaced it.
--
-- results_derive_grade_point is the one place that decides a grade point, so
-- the repeat rule belongs there rather than beside it: a trigger that nulled
-- the grade point afterwards was simply overwritten the next time the row was
-- touched, and the course went on counting twice.
--
-- An attempt that a later one has replaced keeps its grade and its marks —
-- it is still the student's record — and derives no grade point, so it drops
-- out of every credit total and every average in the system at once.
create or replace function public.results_derive_grade_point()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gpv double precision;
begin
  if new.grade is null or btrim(new.grade) = '' then
    new.grade := null;
    new.gpv   := null;
    return new;
  end if;

  new.grade := upper(btrim(new.grade));
  v_gpv := public.grade_point_value(new.grade);

  if v_gpv is null then
    raise exception
      '% is not a grade this faculty awards', new.grade
      using hint = 'Valid grades come from system_settings.gpv_scale.';
  end if;

  /* Repeating a course with a later batch makes a second, later row for the
     same course. The later attempt is the one that stands; the earlier one
     stops carrying a grade point so its credits are not counted twice. */
  if exists (
    select 1
      from public.results other
     where other.student_id = new.student_id
       and other.course_id = new.course_id
       and other.id <> new.id
       and other.is_published
       and (other.academic_year, coalesce(other.published_at, other.created_at))
           > (new.academic_year, coalesce(new.published_at, new.created_at))
  ) then
    new.gpv := null;
    return new;
  end if;

  -- Supplied by nobody, derived from the grade, every time.
  new.gpv := v_gpv;
  return new;
end;
$$;

-- When an attempt arrives or leaves, the others of that course are touched
-- so the rule above is applied to them again.
create or replace function public.settle_repeated_attempts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The nudge below fires this trigger again; once is enough.
  if pg_trigger_depth() > 1 then
    return null;
  end if;

  update public.results r
     set grade = r.grade
    from (select distinct student_id, course_id from changed_rows) t
   where r.student_id = t.student_id
     and r.course_id = t.course_id
     and r.is_published;

  return null;
end;
$$;;
