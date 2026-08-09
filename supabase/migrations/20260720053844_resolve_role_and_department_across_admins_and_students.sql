-- resolve_role_and_department_across_admins_and_students
-- Applied 20260720053844
-- Exported from the live project; do not edit by hand.

-- Both are SECURITY DEFINER, so they bypass RLS on admins/students when
-- resolving internally — no circular-policy issue, same as before. Every
-- existing RLS policy across the app calls through these two functions
-- rather than checking a table directly, so moving admin identity into its
-- own table requires no changes anywhere else.
CREATE OR REPLACE FUNCTION public.get_my_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
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
AS $function$
  SELECT COALESCE(
    (SELECT department FROM admins WHERE id = auth.uid()),
    (SELECT department FROM students WHERE id = auth.uid())
  )
$function$;
