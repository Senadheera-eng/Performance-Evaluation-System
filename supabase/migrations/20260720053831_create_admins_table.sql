-- create_admins_table
-- Applied 20260720053831
-- Exported from the live project; do not edit by hand.

CREATE TABLE public.admins (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  role text NOT NULL CHECK (role IN ('dept_admin', 'super_admin')),
  -- NULL for super_admin, which has no single home department.
  department text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;

CREATE POLICY admins_self_read ON public.admins
  FOR SELECT USING (id = auth.uid());

CREATE POLICY admins_super_admin_all ON public.admins
  FOR ALL
  USING (get_my_role() = 'super_admin')
  WITH CHECK (get_my_role() = 'super_admin');
