-- A published result can be changed by the department that owns the course.
--
-- Once a sheet is published its rows are closed to ordinary marks entry,
-- which is right: a lecturer does not edit what students can already see.
-- A published result still has to be changeable when it is wrong, or when
-- the examiners decide otherwise:
--
--   * the Super Admin can change any result, of any student, in any course;
--   * a Department Admin, and the Head of a department, can change any
--     result in a course their department owns, whichever department the
--     student belongs to.
--
-- Each change needs a reason. The marks and grade before and after are kept
-- in result_changes, and the student is told their result was updated.
--
-- A re-sit is still capped at C, as before. A change marked "recorded in
-- error" says the earlier R or F was never real, so the cap does not apply
-- (the same as correct_result_grade, which stays for the published app).

create table if not exists public.result_changes (
  id                uuid primary key default gen_random_uuid(),
  result_id         uuid not null references public.results (id) on delete cascade,
  student_id        uuid not null,
  course_id         uuid not null,
  old_mid_sem       double precision,
  old_ca            double precision,
  old_grade         text,
  new_mid_sem       double precision,
  new_ca            double precision,
  new_grade         text,
  recorded_in_error boolean not null default false,
  reason            text not null,
  changed_by        uuid,
  changed_at        timestamptz not null default now()
);
create index if not exists result_changes_result_idx
  on public.result_changes (result_id, changed_at desc);
create index if not exists result_changes_student_idx
  on public.result_changes (student_id);

/* May the caller change results in this course? The Super Admin anywhere;
   a Department Admin or Head of Department in their own department's
   courses. */
create or replace function public.can_change_course_results(p_course_id uuid)
returns boolean
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_role       text := coalesce(public.get_my_role(), '');
  v_department text;
begin
  if v_role = 'super_admin' then
    return true;
  end if;
  select c.department into v_department from public.courses c where c.id = p_course_id;
  if v_department is null then
    return false;
  end if;
  if v_role = 'dept_admin' and public.get_my_department() = v_department then
    return true;
  end if;
  return public.is_active_hod_of(v_department);
end;
$function$;
revoke all on function public.can_change_course_results(uuid) from public, anon;
grant execute on function public.can_change_course_results(uuid) to authenticated;

alter table public.result_changes enable row level security;
-- Read by those who may change the course's results; written only through
-- change_published_result.
revoke all on public.result_changes from anon, authenticated;
grant select on public.result_changes to authenticated;
drop policy if exists result_changes_read on public.result_changes;
create policy result_changes_read on public.result_changes
  for select to authenticated
  using (public.can_change_course_results(course_id));

create or replace function public.change_published_result(
  p_result_id         uuid,
  p_mid_sem           double precision,
  p_ca                double precision,
  p_grade             text,
  p_reason            text,
  p_recorded_in_error boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_old    record;
  v_new    record;
  v_grade  text := upper(nullif(btrim(coalesce(p_grade, '')), ''));
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 300), '');
  v_error  boolean := coalesce(p_recorded_in_error, false);
begin
  select r.id, r.student_id, r.course_id, r.status, r.mid_sem_mark, r.ca_mark, r.grade,
         c.course_code, c.title
    into v_old
    from public.results r
    join public.courses c on c.id = r.course_id
   where r.id = p_result_id
     for update of r;
  if v_old.id is null then
    raise exception 'That result does not exist';
  end if;
  if not public.can_change_course_results(v_old.course_id) then
    raise exception 'Only the Super Admin, or the department that owns %, can change this result', v_old.course_code;
  end if;
  if v_old.status <> 'published' then
    raise exception 'This result is not published yet. Change it on the course''s results sheet.';
  end if;
  if v_reason is null then
    raise exception 'Give a reason for the change. It is kept with the result.';
  end if;
  if v_grade is null then
    raise exception 'Choose the grade';
  end if;
  if public.grade_point_value(v_grade) is null then
    raise exception '% is not a grade this faculty awards', v_grade;
  end if;
  if (p_mid_sem is not null and (p_mid_sem < 0 or p_mid_sem > 100))
     or (p_ca is not null and (p_ca < 0 or p_ca > 100)) then
    raise exception 'A mark must be between 0 and 100';
  end if;
  if v_old.mid_sem_mark is not distinct from p_mid_sem
     and v_old.ca_mark is not distinct from p_ca
     and v_old.grade is not distinct from v_grade
     and not v_error then
    return jsonb_build_object('ok', false, 'message', 'Nothing was changed.');
  end if;

  if v_error then
    -- Tells the cap trigger this is a correction, not a re-sit being graded.
    perform set_config('pes.grade_correction', 'on', true);
    update public.results
       set mid_sem_mark = p_mid_sem, ca_mark = p_ca, grade = v_grade,
           original_grade = null, corrected_by = auth.uid(), corrected_at = now(),
           correction_reason = v_reason
     where id = p_result_id;
    perform set_config('pes.grade_correction', 'off', true);
  else
    update public.results
       set mid_sem_mark = p_mid_sem, ca_mark = p_ca, grade = v_grade
     where id = p_result_id;
  end if;

  -- What was actually recorded: a re-sit above the cap comes back as C.
  select r.grade, r.mid_sem_mark, r.ca_mark into v_new
    from public.results r where r.id = p_result_id;

  insert into public.result_changes
    (result_id, student_id, course_id, old_mid_sem, old_ca, old_grade,
     new_mid_sem, new_ca, new_grade, recorded_in_error, reason, changed_by)
  values
    (p_result_id, v_old.student_id, v_old.course_id, v_old.mid_sem_mark, v_old.ca_mark, v_old.grade,
     v_new.mid_sem_mark, v_new.ca_mark, v_new.grade, v_error, v_reason, auth.uid());

  perform public.notify_users(
    array[v_old.student_id], 'results', 'result_changed',
    'Your result for ' || v_old.course_code || ' was updated',
    case when v_old.grade is distinct from v_new.grade
         then format('Your grade in %s is now %s (it was %s).', v_old.title, v_new.grade, coalesce(v_old.grade, 'none'))
         else format('Your marks in %s were updated. Your grade is still %s.', v_old.title, v_new.grade)
    end,
    '/app/results', 'result', p_result_id);

  return jsonb_build_object(
    'ok', true,
    'grade', v_new.grade,
    'capped', v_new.grade is distinct from v_grade,
    'message', case
      when v_new.grade is distinct from v_grade then
        format('Saved. %s is a re-sit, so the grade is recorded as %s, the highest a re-sit can get. The student has been told.',
               v_old.course_code, v_new.grade)
      else format('Saved. The student has been told their %s result was updated.', v_old.course_code)
    end);
end;
$function$;
revoke all on function public.change_published_result(uuid, double precision, double precision, text, text, boolean) from public, anon;
grant execute on function public.change_published_result(uuid, double precision, double precision, text, text, boolean) to authenticated;

/* A result's changes, newest first, with who made each one. */
create or replace function public.get_result_changes(p_result_id uuid)
returns table (
  changed_at timestamptz, changed_by_name text, reason text, recorded_in_error boolean,
  old_mid_sem double precision, old_ca double precision, old_grade text,
  new_mid_sem double precision, new_ca double precision, new_grade text)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_course uuid;
begin
  select r.course_id into v_course from public.results r where r.id = p_result_id;
  if v_course is null or not public.can_change_course_results(v_course) then
    raise exception 'Not authorised to see the changes to this result';
  end if;

  return query
  select h.changed_at,
         coalesce(a.name,
                  case when coalesce(l.title, '') <> '' then l.title || ' ' || l.name else l.name end,
                  'Unknown'),
         h.reason, h.recorded_in_error,
         h.old_mid_sem, h.old_ca, h.old_grade, h.new_mid_sem, h.new_ca, h.new_grade
    from public.result_changes h
    left join public.admins a on a.id = h.changed_by
    left join public.lecturers l on l.auth_user_id = h.changed_by
   where h.result_id = p_result_id
   order by h.changed_at desc;
end;
$function$;
revoke all on function public.get_result_changes(uuid) from public, anon;
grant execute on function public.get_result_changes(uuid) to authenticated;
