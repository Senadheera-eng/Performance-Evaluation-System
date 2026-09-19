-- add_student_status_column
-- Applied 20260704090726
-- Exported from the live project; do not edit by hand.


ALTER TABLE students ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE students ADD CONSTRAINT status_check CHECK (status IN ('active','withdrawn','transferred','graduated'));

UPDATE students SET status = 'transferred' WHERE reg_number = '108943';
