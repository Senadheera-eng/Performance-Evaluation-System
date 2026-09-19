-- fix_rls_recursion_in_role_helpers
-- Applied 20260720054717
-- Exported from the live project; do not edit by hand.

-- get_my_role()/get_my_department() are SECURITY DEFINER, which is
-- *supposed* to bypass RLS on the tables they read via ownership — and
-- did, for the single-table case. But now that they touch two tables where
-- BOTH have a self-referencing policy (admins_super_admin_all also calls
-- get_my_role()), Postgres's planner detects a genuine cross-table cycle
-- and refuses with "infinite recursion detected in policy for relation
-- students" (42P17) — confirmed by reproducing the exact failing query.
-- SET row_security = off on the function forces RLS to be skipped for
-- every table these functions touch, unconditionally, removing the
-- ambiguity in the implicit ownership-based bypass.
CREATE OR REPLACE FUNCTION public.get_my_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET row_security = off
AS $function$
  SELECT COALESCE(
    (SELECT role FROM admins WHERE id = auth.uid()),
    (SELECT role FROM students WHERE id = auth.uid())
  )
$function$;

CREATE OR REPLACE FUNCTION public.get_my_department()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET row_security = off
AS $function$
  SELECT COALESCE(
    (SELECT department FROM admins WHERE id = auth.uid()),
    (SELECT department FROM students WHERE id = auth.uid())
  )
$function$;
