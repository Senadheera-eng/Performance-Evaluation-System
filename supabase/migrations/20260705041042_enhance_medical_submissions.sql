-- enhance_medical_submissions
-- Applied 20260705041042
-- Exported from the live project; do not edit by hand.


ALTER TABLE medical_submissions
  ADD COLUMN IF NOT EXISTS reason_type text NOT NULL DEFAULT 'medical'
    CHECK (reason_type IN ('medical', 'bereavement', 'other')),
  ADD COLUMN IF NOT EXISTS end_date date,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES students(id),
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_notes text,
  ADD COLUMN IF NOT EXISTS file_name text;

ALTER TABLE medical_submissions
  DROP CONSTRAINT IF EXISTS medical_submissions_status_check;
ALTER TABLE medical_submissions
  ADD CONSTRAINT medical_submissions_status_check
  CHECK (status IN ('pending', 'approved', 'rejected'));
