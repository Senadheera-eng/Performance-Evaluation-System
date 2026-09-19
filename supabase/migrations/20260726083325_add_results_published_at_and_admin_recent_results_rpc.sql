-- add_results_published_at_and_admin_recent_results_rpc
-- Applied 20260726083325
-- Exported from the live project; do not edit by hand.

-- published_at/published_by give the dashboard a real "when was this
-- published" signal to sort by, instead of created_at (which reflects when
-- the draft row was first created, not when it was actually published -
-- those can be months apart).
ALTER TABLE public.results
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS published_by uuid REFERENCES public.admins(id);

-- One-time backfill: for rows already published, created_at is the best
-- available estimate of when that happened (nothing better was recorded).
UPDATE public.results
SET published_at = created_at
WHERE is_published = true AND published_at IS NULL;

CREATE OR REPLACE FUNCTION public.set_results_published_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.is_published = true
     AND (TG_OP = 'INSERT' OR OLD.is_published IS DISTINCT FROM true) THEN
    NEW.published_at := now();
    NEW.published_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_results_published_at ON public.results;
CREATE TRIGGER trg_results_published_at
  BEFORE INSERT OR UPDATE ON public.results
  FOR EACH ROW
  EXECUTE FUNCTION public.set_results_published_at();

REVOKE EXECUTE ON FUNCTION public.set_results_published_at() FROM PUBLIC, anon;

-- Recently published results for the admin dashboard, department-scoped
-- server-side. The previous client-side query joined students(name)
-- directly, which silently returned null for any student outside the
-- admin's own department - routine for shared first/second-year courses,
-- which have students from all four departments by design.
CREATE OR REPLACE FUNCTION public.get_admin_recent_results(p_limit integer DEFAULT 8)
RETURNS TABLE (
  result_id uuid,
  student_name text,
  reg_number text,
  index_number text,
  course_code text,
  course_title text,
  grade text,
  published_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role text := get_my_role();
  v_dept text := get_my_department();
BEGIN
  IF v_role NOT IN ('dept_admin', 'super_admin') THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  RETURN QUERY
  SELECT r.id, s.name, s.reg_number, s.index_number,
         c.course_code, c.title, r.grade, r.published_at
  FROM results r
  JOIN students s ON s.id = r.student_id
  JOIN courses c ON c.id = r.course_id
  WHERE r.is_published = true
    AND r.grade IS NOT NULL
    AND (v_role = 'super_admin' OR c.department = v_dept)
  ORDER BY r.published_at DESC NULLS LAST, r.created_at DESC
  LIMIT p_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_admin_recent_results(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_recent_results(integer) TO authenticated, service_role;
