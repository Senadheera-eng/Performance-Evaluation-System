-- create_medical_certificates_bucket
-- Applied 20260705041109
-- Exported from the live project; do not edit by hand.


-- Private bucket (medical documents are sensitive personal data)
INSERT INTO storage.buckets (id, name, public)
VALUES ('medical-certificates', 'medical-certificates', false)
ON CONFLICT (id) DO NOTHING;

-- Students can upload to their own folder (path prefix = their student id)
CREATE POLICY "Students can upload own medical certificates"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'medical-certificates'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Students can view their own files; admins can view all
CREATE POLICY "Students view own, admins view all medical certificates"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'medical-certificates'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR get_my_role() = 'dept_admin'
  )
);

-- Students can delete their own not-yet-reviewed files
CREATE POLICY "Students can delete own medical certificates"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'medical-certificates'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
