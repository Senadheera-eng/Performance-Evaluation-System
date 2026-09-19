-- exact_section_subtitles_from_faculty_form
-- Applied 20260809081443
-- Exported from the live project; do not edit by hand.

-- The subtitle is not "description plus a required note the client appends".
-- The faculty's form says "Rate all statements below — all fields are
-- required" under Course Content and plain "Assignments, projects and lab
-- work" under Continuous Assessments, whose follow-ups are optional. Deriving
-- the suffix from whether any question is required got both wrong, so the
-- whole line is stored as written.

update public.feedback_questions set section_description = case section_key
  when 'course_content'         then 'Rate all statements below — all fields are required *'
  when 'learning_resources'     then 'Rate all statements below — all fields are required *'
  when 'delivery_mode'          then 'All fields are required *'
  when 'continuous_assessments' then 'Assignments, projects and lab work'
  when 'field_visits'           then 'Only fill if your course included field visits'
  when 'lecturers'              then 'Rate each lecturer — all fields are required *'
  when 'teaching_approach'      then 'All fields are required *'
  when 'other_comments'         then 'Any additional feedback on the overall course'
  else section_description
end;
