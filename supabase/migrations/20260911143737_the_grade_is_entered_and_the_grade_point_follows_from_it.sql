/*
  Marks stop deciding the grade; the examiner does.

  Until now the entry screens computed OA from CA and ESE, looked the grade up
  in the boundary table, and wrote all three. That is not how this faculty
  awards a grade — the marks are evidence, the grade is a decision, and an
  examiners' meeting can and does move one. So Mid-Sem and CA are recorded as
  what they are, ESE is no longer entered, and the grade is typed.

  That moves a load-bearing number. gpv is what every CGPA, class list and
  honours classification is computed from, and it used to arrive alongside a
  grade the client had just derived. If the grade is now typed — by hand or out
  of a spreadsheet — then nothing stops a row carrying grade 'A' with gpv 2.3,
  or a grade that is not a grade at all, and a CGPA would quietly be wrong.

  So gpv is no longer something a writer supplies. It is derived here, from
  the same system_settings.gpv_scale the rest of the app reads, on every write.
  A grade outside that scale is refused rather than stored. Whatever writes the
  row — the sheet, the spreadsheet import, a direct table write — gets the same
  answer, because there is only one place that answers.
*/

create or replace function public.grade_point_value(p_grade text)
returns double precision
language sql
stable
security definer
set search_path to 'public'
as $$
  select (value -> upper(btrim(p_grade)))::double precision
    from public.system_settings
   where key = 'gpv_scale'
$$;

comment on function public.grade_point_value(text) is
  'The grade point for a grade, from system_settings.gpv_scale. Null when the '
  'grade is not on the scale, which callers must treat as "not a grade".';

grant execute on function public.grade_point_value(text) to authenticated;


create or replace function public.results_derive_grade_point()
returns trigger
language plpgsql
security definer
set search_path to 'public'
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

  -- Supplied by nobody, derived from the grade, every time.
  new.gpv := v_gpv;
  return new;
end;
$$;

drop trigger if exists trg_results_derive_grade_point on public.results;
create trigger trg_results_derive_grade_point
  before insert or update of grade on public.results
  for each row execute function public.results_derive_grade_point();


/*
  A mark is a number out of its paper. Nothing outside 0..100 is a mark, and a
  spreadsheet that lands 850 in a column is a mistake worth refusing at the
  table rather than discovering in a class list. The tighter faculty maximum
  (50 for each of Mid-Sem and CA) belongs with the assessment rules and is
  checked by the sheet and by the importer, which can say which row and why.
*/
alter table public.results
  drop constraint if exists results_mid_sem_mark_range,
  drop constraint if exists results_ca_mark_range;

alter table public.results
  add constraint results_mid_sem_mark_range
    check (mid_sem_mark is null or (mid_sem_mark >= 0 and mid_sem_mark <= 100)),
  add constraint results_ca_mark_range
    check (ca_mark is null or (ca_mark >= 0 and ca_mark <= 100));


/*
  Publishing was the department admin's alone. The head of department reviews
  the same sheets, can already return one to the lecturer, and is the person
  the department actually answers to for its marks — so they publish too.

  The lecturer still cannot, and not because this function says so:
  results_lecturer_update permits a row only while its status is 'draft', in
  both the USING and the WITH CHECK, so a lecturer writing directly to the
  table cannot move a row to 'published' either.
*/
create or replace function public.publish_offering_results(p_offering_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_department text;
  v_skipped int;
  v_moved int;
begin
  v_department := public.offering_department(p_offering_id);
  if not (public.get_my_role() = 'super_admin'
          or (public.get_my_role() = 'dept_admin'
              and public.get_my_department() = v_department)
          or public.is_active_hod_of(v_department)) then
    raise exception 'Only the department admin or head of department can publish results';
  end if;

  select count(*) into v_skipped
    from public.results
   where offering_id = p_offering_id and status <> 'published' and grade is null;

  update public.results
     set status = 'published'
   where offering_id = p_offering_id
     and status in ('draft', 'submitted')
     and grade is not null;

  get diagnostics v_moved = row_count;
  return jsonb_build_object('ok', true, 'published', v_moved, 'skipped', v_skipped,
    'message', case when v_skipped > 0
      then format('%s result(s) published; %s skipped for having no grade.', v_moved, v_skipped)
      else format('%s result(s) published.', v_moved) end);
end;
$$;
