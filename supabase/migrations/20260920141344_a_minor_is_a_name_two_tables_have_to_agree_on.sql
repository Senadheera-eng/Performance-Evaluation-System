-- Renaming and removing a minor, without leaving courses pointing at a name
-- that no longer exists.
--
-- A minor lives in two places: the stream a course is tagged with
-- (courses.minor_category) and the credits it takes (minor_requirements,
-- keyed by department and name). The name is the only thing joining them, so
-- renaming one without the other silently unteaches every course of that
-- minor. There was no rename at all before — the only way was to delete and
-- re-add, which did exactly that.
--
-- Both functions do the pair together, and both are open to the people the
-- row policies already allow to write these tables: the department's admin,
-- its sitting head, and a super admin. The checks are repeated here because
-- a function that runs as its owner must do its own checking.
create or replace function public.may_manage_minors(p_department text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.get_my_role(), '') = 'super_admin'
      or (coalesce(public.get_my_role(), '') = 'dept_admin'
          and public.get_my_department() = p_department)
      or public.is_active_hod_of(p_department);
$$;
revoke all on function public.may_manage_minors(text) from public, anon;
grant execute on function public.may_manage_minors(text) to authenticated;

create or replace function public.rename_minor(
  p_department text, p_from text, p_to text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_courses int;
begin
  if not public.may_manage_minors(p_department) then
    raise exception 'Only this department can manage its minors';
  end if;
  if coalesce(btrim(p_to), '') = '' then
    raise exception 'Give the minor a name';
  end if;
  if not exists (select 1 from public.minor_requirements
                  where department = p_department and minor = p_from) then
    raise exception 'No minor called % in this department', p_from;
  end if;
  if btrim(p_to) <> p_from
     and exists (select 1 from public.minor_requirements
                  where department = p_department and minor = btrim(p_to)) then
    raise exception 'This department already has a minor called %', btrim(p_to);
  end if;

  update public.minor_requirements
     set minor = btrim(p_to)
   where department = p_department and minor = p_from;

  update public.courses
     set minor_category = btrim(p_to)
   where department = p_department and minor_category = p_from;
  get diagnostics v_courses = row_count;

  return jsonb_build_object('ok', true, 'courses_retagged', v_courses,
    'message', format('Renamed to %s. %s course%s retagged.',
                      btrim(p_to), v_courses, case when v_courses = 1 then '' else 's' end));
end;
$$;
revoke all on function public.rename_minor(text, text, text) from public, anon;
grant execute on function public.rename_minor(text, text, text) to authenticated;

create or replace function public.delete_minor(p_department text, p_minor text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_courses int;
begin
  if not public.may_manage_minors(p_department) then
    raise exception 'Only this department can manage its minors';
  end if;

  -- The courses stay; they simply stop belonging to a stream. Leaving the
  -- tag behind would leave them pointing at a minor nothing defines.
  update public.courses
     set minor_category = null
   where department = p_department and minor_category = p_minor;
  get diagnostics v_courses = row_count;

  delete from public.minor_requirements
   where department = p_department and minor = p_minor;

  return jsonb_build_object('ok', true, 'courses_untagged', v_courses,
    'message', format('Removed. %s course%s no longer tagged.',
                      v_courses, case when v_courses = 1 then '' else 's' end));
end;
$$;
revoke all on function public.delete_minor(text, text) from public, anon;
grant execute on function public.delete_minor(text, text) to authenticated;

-- What a department's minors are, with what each is worth and which courses
-- carry it. One read for the screen that manages them.
create or replace function public.get_department_minors(p_department text)
returns table (
  minor text, required_credits integer, tagged_courses integer,
  tagged_credits integer, courses jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select mr.minor, mr.required_credits,
         coalesce(c.n, 0), coalesce(c.credits, 0), coalesce(c.list, '[]'::jsonb)
    from public.minor_requirements mr
    left join lateral (
      select count(*)::int as n, sum(co.credits)::int as credits,
             jsonb_agg(jsonb_build_object(
               'course_id', co.id, 'course_code', co.course_code,
               'title', co.title, 'credits', co.credits,
               'semester', co.semester) order by co.semester, co.course_code) as list
        from public.courses co
       where co.department = mr.department and co.minor_category = mr.minor
    ) c on true
   where mr.department = p_department
   order by mr.minor;
$$;
revoke all on function public.get_department_minors(text) from public, anon;
grant execute on function public.get_department_minors(text) to authenticated;