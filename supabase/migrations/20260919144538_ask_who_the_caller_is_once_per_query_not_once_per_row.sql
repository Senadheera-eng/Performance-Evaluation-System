-- Row security that asks "who am I?" once per query, not once per row.
--
-- A policy written as `get_my_role() = 'super_admin'` is evaluated for every
-- row the table scan touches, and get_my_role() is a plpgsql function that
-- looks the caller up in admins and then students. Reading 167 students as a
-- department admin made ~800 of those calls (four policies, each per row) and
-- took 20 ms; the same query with the call wrapped as
-- `(select get_my_role())` is planned as an InitPlan — evaluated once and
-- reused — and took 1.6 ms. The answer cannot differ between rows: these
-- functions read only the caller's identity, never the row.
--
-- Rather than restate sixty-five policies by hand (and risk a typo in one of
-- them quietly changing who can see what), this rewrites the stored
-- expressions in place: every bare call to one of the caller-identity
-- functions becomes a sub-select, calls already wrapped are left alone, and
-- nothing else in any expression changes. Running it twice is a no-op.
--
-- Checked before applying, in a rolled-back transaction: eight callers (super
-- admin, three department admins, two students, a lecturer, a head of
-- department) counted every table with a policy, before and after — 336
-- counts, none changed.
do $$
declare
  r record;
  v_pattern constant text :=
    '(?<!SELECT )\m(get_my_role|get_my_department|my_hod_department|auth\.uid|auth\.role)\(\)';
  v_q text;
  v_w text;
  v_sql text;
begin
  for r in
    select n.nspname, c.relname, p.polname,
           pg_get_expr(p.polqual, p.polrelid) as q,
           pg_get_expr(p.polwithcheck, p.polrelid) as w
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname in ('public', 'storage')
  loop
    v_q := regexp_replace(r.q, v_pattern, '(select \1())', 'g');
    v_w := regexp_replace(r.w, v_pattern, '(select \1())', 'g');
    if v_q is not distinct from r.q and v_w is not distinct from r.w then
      continue;
    end if;
    v_sql := format('alter policy %I on %I.%I', r.polname, r.nspname, r.relname);
    if v_q is not null then v_sql := v_sql || format(' using (%s)', v_q); end if;
    if v_w is not null then v_sql := v_sql || format(' with check (%s)', v_w); end if;
    execute v_sql;
  end loop;
end;
$$;