-- create_course_prerequisites
-- Applied 20260725085557
-- Exported from the live project; do not edit by hand.


CREATE TABLE public.course_prerequisites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  prerequisite_course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  -- Provenance matters here: 'handbook' = stated in the Faculty Handbook,
  -- 'derived' = inferred from course-title sequencing, 'manual' = entered
  -- by a super admin. Anything not 'handbook' should be treated as
  -- provisional until the department confirms it.
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('handbook','derived','manual')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, prerequisite_course_id),
  CHECK (course_id <> prerequisite_course_id)
);

CREATE INDEX idx_course_prerequisites_course ON public.course_prerequisites (course_id);

ALTER TABLE public.course_prerequisites ENABLE ROW LEVEL SECURITY;

CREATE POLICY course_prerequisites_public_read ON public.course_prerequisites
  FOR SELECT USING (true);

CREATE POLICY course_prerequisites_super_admin_write ON public.course_prerequisites
  FOR ALL
  USING (get_my_role() = 'super_admin')
  WITH CHECK (get_my_role() = 'super_admin');

-- Seed sequential course chains (e.g. "Structural Analysis I" -> "II").
-- Only link when the follow-on course sits in a LATER semester: where two
-- numbered parts run in the same semester they're taken concurrently and
-- one cannot be a prerequisite for the other.
WITH numbered AS (
  SELECT id, semester, department,
         regexp_replace(title, '\s+(I|II|III|IV|V)$', '') AS stem,
         CASE regexp_replace(title, '^.*\s+(I|II|III|IV|V)$', '\1')
           WHEN 'I' THEN 1 WHEN 'II' THEN 2 WHEN 'III' THEN 3
           WHEN 'IV' THEN 4 WHEN 'V' THEN 5 END AS part
  FROM courses
  WHERE title ~ '\s(I|II|III|IV|V)$'
)
INSERT INTO course_prerequisites (course_id, prerequisite_course_id, source)
SELECT nxt.id, prv.id, 'derived'
FROM numbered prv
JOIN numbered nxt
  ON nxt.stem = prv.stem
 AND nxt.department = prv.department
 AND nxt.part = prv.part + 1
 AND nxt.semester > prv.semester
ON CONFLICT DO NOTHING;

-- Does a student satisfy every prerequisite for a course? A prerequisite
-- counts as met when a published, non-failing result exists for it.
CREATE OR REPLACE FUNCTION public.student_meets_prerequisites(
  p_student_id uuid, p_course_id uuid
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  RETURN NOT EXISTS (
    SELECT 1
    FROM course_prerequisites cp
    WHERE cp.course_id = p_course_id
      AND NOT EXISTS (
        SELECT 1 FROM results r
        WHERE r.student_id = p_student_id
          AND r.course_id = cp.prerequisite_course_id
          AND r.is_published = true
          AND r.grade IS NOT NULL
          AND r.grade NOT IN ('F', 'R')
      )
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.student_meets_prerequisites(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_meets_prerequisites(uuid, uuid) TO authenticated, service_role;
