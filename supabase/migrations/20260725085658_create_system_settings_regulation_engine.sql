-- create_system_settings_regulation_engine
-- Applied 20260725085658
-- Exported from the live project; do not edit by hand.


-- Regulation engine: the academic rules the report (§4.6) claims are
-- configurable. Holding them as data rather than code constants is what
-- makes the system genuinely reconfigurable for another faculty.
CREATE TABLE public.system_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  description text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL REFERENCES public.admins(id)
);

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

-- Students need to read thresholds (e.g. to see the 80% rule applied to
-- their own attendance), so reads are open to any signed-in user. Only the
-- super admin can change a regulation.
CREATE POLICY system_settings_read ON public.system_settings
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY system_settings_super_admin_write ON public.system_settings
  FOR ALL
  USING (get_my_role() = 'super_admin')
  WITH CHECK (get_my_role() = 'super_admin');

INSERT INTO public.system_settings (key, value, description, category) VALUES
  ('attendance_threshold', '80'::jsonb,
   'Minimum attendance percentage required for exam eligibility (Faculty Handbook CCR rule).', 'attendance'),
  ('attendance_prewarning_threshold', '85'::jsonb,
   'Attendance percentage at which a student receives an early warning, before the critical threshold.', 'attendance'),
  ('graduation_total_credits', '144'::jsonb,
   'Total credits required to graduate.', 'graduation'),
  ('total_semesters', '8'::jsonb,
   'Number of semesters in the degree programme.', 'graduation'),
  ('first_batch_intake_year', '2015'::jsonb,
   'Intake year of Batch 1; used to derive batch numbers from a student''s batch_year.', 'general'),
  ('medical_submission_deadline_days', '14'::jsonb,
   'Days after the event within which medical evidence must be submitted (Faculty Handbook).', 'medical'),
  ('feedback_text_max_length', '1500'::jsonb,
   'Maximum characters allowed in a written feedback answer.', 'feedback'),
  ('feedback_min_responses_for_analytics', '5'::jsonb,
   'Minimum submitted responses before per-course feedback analytics and comments are revealed, to prevent deanonymisation.', 'feedback'),
  ('student_departments',
   '["Civil Engineering","Computer Engineering","Electrical and Electronic Engineering","Mechanical Engineering"]'::jsonb,
   'Departments a student can belong to. Excludes Interdisciplinary Studies, which owns shared courses but no students.', 'departments'),
  ('interdisciplinary_department', '"Interdisciplinary Studies"'::jsonb,
   'Name of the department that owns shared general-education courses taken across all departments.', 'departments'),
  ('gpv_scale',
   '{"A+":4.0,"A":4.0,"A-":3.7,"B+":3.3,"B":3.0,"B-":2.7,"C+":2.3,"C":2.0,"C-":1.7,"D+":1.3,"D":1.0,"F":0.0,"R":0.0,"L":0.0}'::jsonb,
   'Grade to grade-point-value mapping used for GPA and CGPA calculation.', 'grading'),
  ('grade_boundaries',
   '[{"grade":"A+","min_oa":85},{"grade":"A","min_oa":75},{"grade":"A-","min_oa":70},{"grade":"B+","min_oa":65},{"grade":"B","min_oa":60},{"grade":"B-","min_oa":55},{"grade":"C+","min_oa":50},{"grade":"C","min_oa":45},{"grade":"C-","min_oa":40},{"grade":"D+","min_oa":35},{"grade":"D","min_oa":30},{"grade":"F","min_oa":0}]'::jsonb,
   'Overall-assessment mark boundaries, highest first, used to derive a letter grade.', 'grading'),
  ('oa_weights', '{"mid_sem":0.4,"ca":0.2,"ese":0.4}'::jsonb,
   'Weighting of Mid Sem, Continuous Assessment and End Semester Exam marks in the overall assessment.', 'grading'),
  ('honours_classifications',
   '[{"key":"first","label":"First Class Honours","threshold":3.7},{"key":"second_upper","label":"Second Class Honours (Upper)","threshold":3.3},{"key":"second_lower","label":"Second Class Honours (Lower)","threshold":3.0},{"key":"pass","label":"Pass","threshold":2.0}]'::jsonb,
   'CGPA thresholds for degree classification.', 'graduation');
