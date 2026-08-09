-- field_visit_followup_questions
-- Applied 20260809080559
-- Exported from the live project; do not edit by hand.

-- Answering "Yes" to Did you have Field Visits? opens three more questions.
-- They hang off the gate rather than being asked of everyone, so a course
-- without field visits never shows them — which is what the section's own
-- note ("Only fill if your course included field visits") is asking for.

insert into public.feedback_questions (
  question_text, question_type, target_type, placeholder,
  section_key, section_title, section_description, section_icon, section_order,
  is_required, display_order, category,
  depends_on_question_id, depends_on_values
)
select v.question_text, v.question_type, 'course', v.placeholder,
       'field_visits', 'Field Visits', 'Only fill if your course included field visits',
       '🏭', 5, false, v.display_order, 'Field Visits',
       gate.id, '["yes"]'::jsonb
  from (select id from public.feedback_questions
         where section_key = 'field_visits'
           and question_text = 'Did you have Field Visits?') gate,
       (values
         ('Place(s) of the field visit',              'short_text', 'Name of the place(s) visited…', 502),
         ('What did you learn from the field visits?', 'long_text',  'Describe what you learned…',    503),
         ('Additional comments on field visits',       'long_text',  'Any other feedback…',           504)
       ) as v(question_text, question_type, placeholder, display_order);
