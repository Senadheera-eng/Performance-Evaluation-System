-- a_guard_that_cannot_answer_must_refuse
-- Applied 20260909143200
-- Exported from the live project; do not edit by hand.

-- A guard that cannot answer must refuse.
--
-- get_my_role() looks the caller up in admins, then in students. A lecturer
-- is in neither, and an anonymous caller is nobody at all, so both got NULL.
-- Every guard written as `if role not in ('dept_admin','super_admin') then
-- raise` then evaluated NULL, which is not TRUE, so the raise never ran and
-- the function carried on and answered.
--
-- That is not theoretical. An ordinary lecturer calling
-- get_all_students_academic_stats() received all 167 students in the faculty.
-- An unauthenticated caller reached the UPDATE inside end_department_hod, and
-- could have appointed themselves a head of department through its twin.
--
-- Two fixes, because one is not enough. The role function stops returning
-- NULL, which makes every guard of that shape fail closed at once -- there is
-- no value of the empty string that is in ('dept_admin','super_admin'). And
-- the four guards that compare with <> are rewritten to say what they mean,
-- so they do not depend on that for their correctness.

-- Nobody is the empty string, and the empty string is not an admin.
create or replace function public.get_my_role()
returns text
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_role text;
begin
  select role into v_role from public.admins where id = auth.uid();
  if v_role is not null then
    return v_role;
  end if;
  select role into v_role from public.students where id = auth.uid();
  if v_role is not null then
    return v_role;
  end if;
  -- A lecturer holds no row in either table, and a signed-out caller holds
  -- no row anywhere. Both are "not an administrator", and saying so as a
  -- value rather than as NULL is what keeps NOT IN comparisons honest.
  return '';
end;
$$;

/* ---- the four guards that compared with <>, said plainly ---- */

create or replace function public.get_faculty_lecturers()
returns table(lecturer_id uuid, name text, email text, title text,
              staff_no text, department text, status text,
              is_hod boolean, hod_since date)
language plpgsql stable security definer set search_path to 'public'
as $$
begin
  if coalesce(public.get_my_role(), '') <> 'super_admin' then
    raise exception 'Access denied: super admin role required';
  end if;

  return query
  select l.id, l.name, l.email, l.title, l.staff_no, l.department, l.status,
         (a.id is not null), a.valid_from
    from public.lecturers l
    left join public.hod_appointments a
      on a.lecturer_id = l.id and a.is_active
   order by l.department, l.name;
end;
$$;

create or replace function public.end_department_hod(p_department text)
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_actor uuid := auth.uid();
begin
  if coalesce(public.get_my_role(), '') <> 'super_admin' then
    raise exception 'Access denied: super admin role required';
  end if;

  update public.hod_appointments
     set is_active = false,
         valid_to  = greatest(valid_from, current_date),
         ended_by  = v_actor,
         ended_at  = now()
   where is_active and department = p_department;
end;
$$;

/* set_department_hod and get_hod_history keep their bodies; only the guard
   changes, so they are patched in place rather than restated. */
do $$
declare
  v_def text;
  v_new text;
  v_sig text;
begin
  foreach v_sig in array array[
    'public.set_department_hod(text,uuid,text)',
    'public.get_hod_history(text)'
  ] loop
    v_def := pg_get_functiondef(v_sig::regprocedure);
    v_new := replace(v_def,
      'get_my_role() <> ''super_admin''',
      'coalesce(public.get_my_role(), '''') <> ''super_admin''');
    if v_new = v_def then
      raise exception '% no longer carries the guard this migration patches', v_sig;
    end if;
    execute v_new;
  end loop;
end
$$;

/* ------------------------------------------------------------------ */
/* And stop handing the whole API to strangers by default              */
/* ------------------------------------------------------------------ */

-- Postgres grants EXECUTE on a new function to PUBLIC, and PUBLIC includes
-- anon -- the role behind the API key that ships inside the frontend bundle.
-- An earlier migration revoked that once; every function written since has
-- been public again from the moment it was created.
--
-- What authenticated already holds is preserved exactly: this closes anon
-- without widening anybody.
do $$
declare
  r record;
begin
  for r in
    select p.oid,
           p.oid::regprocedure::text as sig,
           p.prorettype = 'trigger'::regtype as is_trigger,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_had,
           has_function_privilege('service_role', p.oid, 'EXECUTE') as svc_had
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
  loop
    if r.is_trigger then
      -- A trigger function is called by the table, never by a client.
      execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    else
      if r.auth_had then
        execute format('grant execute on function %s to authenticated', r.sig);
      end if;
      if r.svc_had then
        execute format('grant execute on function %s to service_role', r.sig);
      end if;
      execute format('revoke execute on function %s from public, anon', r.sig);
    end if;
  end loop;
end
$$;

-- So the next function written is not exposed the moment it exists.
alter default privileges in schema public revoke execute on functions from public;
alter default privileges for role postgres in schema public
  revoke execute on functions from public;
