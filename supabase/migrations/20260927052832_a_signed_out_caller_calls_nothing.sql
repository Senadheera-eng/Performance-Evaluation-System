-- A signed-out caller calls nothing, including functions written after the
-- rule was.
--
-- 20260909143200 revoked EXECUTE from PUBLIC and changed the default so new
-- functions would not repeat the mistake. It did not hold: the security
-- advisor found 37 SECURITY DEFINER functions the anon role could call, every
-- one of them written after that migration (notices, notifications, the
-- grade-point and repeat triggers, enrolment oversight).
--
-- The reason is that PUBLIC was never the only door. Supabase's own default
-- privileges for the postgres role grant EXECUTE to anon, authenticated and
-- service_role *by name*, so revoking from PUBLIC closed one grant and left
-- the explicit anon grant on every function created afterwards. Each guard
-- checked still fails closed for a caller with no identity, so this was a
-- door into empty rooms rather than a leak, but a door nonetheless.
--
-- So, for every function this application owns (extension functions such as
-- pgvector's are left alone):
--   * anon and PUBLIC lose EXECUTE.
--   * authenticated keeps exactly what it had: where it could call a
--     function only through PUBLIC, it is granted the call by name first, so
--     no signed-in screen loses anything.
--   * trigger functions lose authenticated too. A trigger fires regardless
--     of the caller's EXECUTE privilege; calling one over /rpc serves no
--     purpose. 20260808105224 set that rule for the triggers of its day.
-- Then the default itself is changed, by name, for anon and PUBLIC, so the
-- next function written is closed without anyone having to remember.

do $$
declare
  f record;
begin
  for f in
    select p.oid, p.oid::regprocedure as sig,
           p.prorettype = 'trigger'::regtype as is_trigger
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind in ('f', 'p')
       and not exists (
         select 1 from pg_depend d
          where d.classid = 'pg_proc'::regclass
            and d.objid = p.oid
            and d.deptype = 'e')
  loop
    if f.is_trigger then
      execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    else
      if has_function_privilege('authenticated', f.oid, 'execute') then
        execute format('grant execute on function %s to authenticated', f.sig);
      end if;
      execute format('revoke execute on function %s from public, anon', f.sig);
    end if;
  end loop;
end
$$;

alter default privileges for role postgres in schema public
  revoke execute on functions from public;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon;
