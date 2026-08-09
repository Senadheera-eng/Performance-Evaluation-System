-- fix_rls_recursion_via_plpgsql_helpers
-- Applied 20260720054838
-- Exported from the live project; do not edit by hand.

-- Root cause: Postgres inlines simple STABLE `LANGUAGE SQL` functions
-- directly into the calling query as an optimization. Once inlined, the
-- function body is no longer a real separate call — it executes under the
-- CALLER's RLS context, not the SECURITY DEFINER owner's (postgres, which
-- has BYPASSRLS). That silently defeated the intended RLS bypass and
-- produced a genuine structural cycle once enough tables' policies called
-- back into get_my_role()/get_my_department(). `LANGUAGE plpgsql`
-- functions are never inlined by the planner, which forces a real function
-- call boundary and restores the SECURITY DEFINER bypass.
CREATE OR REPLACE FUNCTION public.get_my_role()
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role text;
BEGIN
  SELECT role INTO v_role FROM admins WHERE id = auth.uid();
  IF v_role IS NOT NULL THEN
    RETURN v_role;
  END IF;
  SELECT role INTO v_role FROM students WHERE id = auth.uid();
  RETURN v_role;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_department()
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_department text;
BEGIN
  SELECT department INTO v_department FROM admins WHERE id = auth.uid();
  IF v_department IS NOT NULL THEN
    RETURN v_department;
  END IF;
  SELECT department INTO v_department FROM students WHERE id = auth.uid();
  RETURN v_department;
END;
$function$;
