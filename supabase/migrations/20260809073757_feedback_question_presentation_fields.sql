-- feedback_question_presentation_fields
-- Applied 20260809073757
-- Exported from the live project; do not edit by hand.

-- The faculty's own form carries wording the question model had nowhere to
-- put: a subtitle under each section heading ("Assignments, projects and lab
-- work"), and the grey prompt inside every free-text box ("Suggest any topics
-- you feel should be added…"). Both are part of what a student reads, so they
-- belong with the question rather than hard-coded into one client.

alter table public.feedback_questions
  add column if not exists placeholder          text,
  add column if not exists section_description  text,
  add column if not exists section_icon         text;

comment on column public.feedback_questions.placeholder is
  'Grey prompt shown inside a text input. Null for non-text questions.';
comment on column public.feedback_questions.section_description is
  'Subtitle under the section heading. Same for every question in the section.';
comment on column public.feedback_questions.section_icon is
  'Emoji shown beside the section heading.';
