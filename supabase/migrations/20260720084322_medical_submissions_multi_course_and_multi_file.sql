-- medical_submissions_multi_course_and_multi_file
-- Applied 20260720084322
-- Exported from the live project; do not edit by hand.


CREATE TABLE public.medical_submission_courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES public.medical_submissions(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.courses(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (submission_id, course_id)
);

CREATE TABLE public.medical_submission_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES public.medical_submissions(id) ON DELETE CASCADE,
  file_url text NOT NULL,
  file_name text NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.medical_submission_courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medical_submission_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students submit medical certs" ON public.medical_submissions;
DROP POLICY IF EXISTS "Students view own submissions" ON public.medical_submissions;
DROP POLICY IF EXISTS medical_dept_admin_own_courses ON public.medical_submissions;

ALTER TABLE public.medical_submissions DROP COLUMN course_id;
ALTER TABLE public.medical_submissions DROP COLUMN file_url;
ALTER TABLE public.medical_submissions DROP COLUMN file_name;

CREATE OR REPLACE FUNCTION public.submission_belongs_to_me(p_submission_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM medical_submissions ms
    WHERE ms.id = p_submission_id AND ms.student_id = auth.uid()
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.submission_has_course_in_my_department(p_submission_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM medical_submission_courses msc
    JOIN courses c ON c.id = msc.course_id
    WHERE msc.submission_id = p_submission_id AND c.department = get_my_department()
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.student_has_medical_submission_in_my_department(p_student_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM medical_submissions ms
    JOIN medical_submission_courses msc ON msc.submission_id = ms.id
    JOIN courses c ON c.id = msc.course_id
    WHERE ms.student_id = p_student_id AND c.department = get_my_department()
  );
END;
$function$;

CREATE POLICY medical_submissions_dept_admin_read ON public.medical_submissions
  FOR SELECT
  USING (get_my_role() = 'dept_admin' AND submission_has_course_in_my_department(id));

CREATE POLICY medical_submissions_dept_admin_update ON public.medical_submissions
  FOR UPDATE
  USING (get_my_role() = 'dept_admin' AND submission_has_course_in_my_department(id))
  WITH CHECK (get_my_role() = 'dept_admin' AND submission_has_course_in_my_department(id));

CREATE POLICY msc_student_insert ON public.medical_submission_courses
  FOR INSERT
  WITH CHECK (submission_belongs_to_me(submission_id));

CREATE POLICY msc_student_read ON public.medical_submission_courses
  FOR SELECT
  USING (submission_belongs_to_me(submission_id));

CREATE POLICY msc_dept_admin_read ON public.medical_submission_courses
  FOR SELECT
  USING (
    get_my_role() = 'dept_admin' AND EXISTS (
      SELECT 1 FROM courses c
      WHERE c.id = medical_submission_courses.course_id AND c.department = get_my_department()
    )
  );

CREATE POLICY msc_super_admin_all ON public.medical_submission_courses
  FOR ALL
  USING (get_my_role() = 'super_admin')
  WITH CHECK (get_my_role() = 'super_admin');

CREATE POLICY msf_student_insert ON public.medical_submission_files
  FOR INSERT
  WITH CHECK (submission_belongs_to_me(submission_id));

CREATE POLICY msf_student_read ON public.medical_submission_files
  FOR SELECT
  USING (submission_belongs_to_me(submission_id));

CREATE POLICY msf_dept_admin_read ON public.medical_submission_files
  FOR SELECT
  USING (get_my_role() = 'dept_admin' AND submission_has_course_in_my_department(submission_id));

CREATE POLICY msf_super_admin_all ON public.medical_submission_files
  FOR ALL
  USING (get_my_role() = 'super_admin')
  WITH CHECK (get_my_role() = 'super_admin');

DROP POLICY IF EXISTS "Students view own, admins view all medical certificates" ON storage.objects;

CREATE POLICY "Students view own, admins view department-scoped medical certificates"
  ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'medical-certificates' AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR get_my_role() = 'super_admin'
      OR (
        get_my_role() = 'dept_admin'
        AND student_has_medical_submission_in_my_department(((storage.foldername(name))[1])::uuid)
      )
    )
  );
