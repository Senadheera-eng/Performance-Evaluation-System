-- dept_admin_rbac_foundation
-- Applied 20260720045404
-- Exported from the live project; do not edit by hand.

-- Extend role model to support a faculty-wide super_admin alongside the
-- existing per-department dept_admin.
ALTER TABLE students DROP CONSTRAINT students_role_check;
ALTER TABLE students ADD CONSTRAINT students_role_check
  CHECK (role = ANY (ARRAY['student'::text, 'dept_admin'::text, 'super_admin'::text]));

-- A super_admin has no single home department, so this column can no
-- longer be mandatory for every row.
ALTER TABLE students ALTER COLUMN department DROP NOT NULL;

-- Mirrors get_my_role() — the caller's home department, used by every
-- department-scoped RLS policy below.
CREATE OR REPLACE FUNCTION public.get_my_department()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  select department from students where id = auth.uid()
$function$;

-- Data cleanup: 6 students are tagged 'Inter-departmental', a stray value
-- that isn't one of the 4 real departments. Their enrollment history is
-- unanimous — each has 4 Mechanical-Engineering-specific courses vs. 2 in
-- every other department (the shared first/second-year courseload every
-- student gets) — they are Mechanical Engineering students.
UPDATE students
SET department = 'Mechanical Engineering'
WHERE department = 'Inter-departmental';

-- Promote the existing single admin account to faculty-wide Super Admin,
-- per explicit user decision. Department admins are provisioned separately.
UPDATE students
SET role = 'super_admin', department = NULL
WHERE email = 'admin@sjp.ac.lk';
