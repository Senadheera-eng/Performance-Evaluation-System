-- the_lab_section_the_report_was_already_printing
-- Applied 20260829172705
-- Exported from the live project; do not edit by hand.

-- The lab section the report was already printing.
--
-- The faculty's feedback report has a Practical Work / Lab section -- seven
-- statements, the skills the work developed, and a comment box -- and the
-- question bank never had it. The gate for it was there all along: Continuous
-- Assessments asks "Did you have Practical / Lab Classes?" and nothing was
-- ever behind the Yes.
--
-- Skills developed is the first question in the bank where a student picks
-- more than one answer, so the bank learns a new question type. A single
-- choice lands in choice_value; several land in choice_values, kept as a
-- json array rather than a delimited string so counting them is a join and
-- not a parse.

alter table public.feedback_questions
  drop constraint feedback_questions_question_type_check;
alter table public.feedback_questions
  add constraint feedback_questions_question_type_check
  check (question_type = any (array['rating', 'short_text', 'long_text',
                                    'single_choice', 'multi_select', 'yes_no']));

-- Both kinds of choice question carry their options; nothing else may.
alter table public.feedback_questions
  drop constraint feedback_questions_options_shape;
alter table public.feedback_questions
  add constraint feedback_questions_options_shape
  check (case
    when question_type in ('single_choice', 'multi_select')
      then coalesce(jsonb_typeof(options), '') = 'array'
       and coalesce(jsonb_array_length(options), 0) > 0
    else options is null
  end);

alter table public.feedback_answers
  add column if not exists choice_values jsonb;

alter table public.feedback_answers
  drop constraint if exists feedback_answers_choice_values_shape;
alter table public.feedback_answers
  add constraint feedback_answers_choice_values_shape
  check (choice_values is null or jsonb_typeof(choice_values) = 'array');

-- Answered means something was actually chosen, whichever shape it takes.
create or replace function public.feedback_answer_provided(
  p_question_type text, p_answer jsonb)
returns boolean
language sql immutable set search_path to 'public'
as $$
  select case p_question_type
    when 'rating' then coalesce(p_answer->>'rating_value', '') <> ''
    when 'single_choice' then coalesce(btrim(p_answer->>'choice_value'), '') <> ''
    when 'yes_no' then coalesce(btrim(p_answer->>'choice_value'), '') <> ''
    when 'multi_select' then
      coalesce(jsonb_typeof(p_answer->'choice_values'), '') = 'array'
        and coalesce(jsonb_array_length(p_answer->'choice_values'), 0) > 0
    else coalesce(btrim(p_answer->>'text_value'), '') <> ''
  end;
$$;

-- Section 8: the practical work itself, shown only to students who said they
-- had lab classes.
insert into public.feedback_questions
  (question_text, question_type, category, display_order, is_required,
   is_active, options, target_type, section_key, section_title,
   section_order, section_icon, section_description,
   depends_on_question_id, depends_on_values, placeholder)
select v.question_text, v.question_type, 'practical_work', v.display_order,
       v.is_required, true, v.options, 'course', 'practical_work',
       'Practical Work / Lab', 8, '🔬',
       'Answer these only if the course had practical or laboratory classes.',
       (select id from public.feedback_questions
         where question_text = 'Did you have Practical / Lab Classes?'),
       '["yes"]'::jsonb, v.placeholder
  from (values
    ('The practical/lab work helped me understand the subject', 'rating', 801, true, null::jsonb, null::text),
    ('Lab instructors were supportive',                          'rating', 802, true, null, null),
    ('Lab instructors were well prepared',                       'rating', 803, true, null, null),
    ('Lab instructors communicated clearly',                     'rating', 804, true, null, null),
    ('Lab exercises were useful and relevant',                   'rating', 805, true, null, null),
    ('The time allocated for lab sessions was sufficient',       'rating', 806, true, null, null),
    ('I enjoyed the lab sessions',                               'rating', 807, true, null, null),
    ('Which skills did the practical/lab work help you develop?', 'multi_select', 808, false,
      '[{"label": "Programming / Technical skills", "value": "programming"},
        {"label": "Problem-solving skills",         "value": "problem_solving"},
        {"label": "Analytical thinking",            "value": "analytical_thinking"},
        {"label": "Use of tools/software",          "value": "tools_software"},
        {"label": "Communication skills",           "value": "communication"},
        {"label": "Teamwork / collaboration",       "value": "teamwork"}]'::jsonb, null),
    ('Additional comments on the practical/lab work', 'long_text', 809, false, null,
      'Anything about the lab sessions worth passing on')
  ) as v(question_text, question_type, display_order, is_required, options, placeholder)
where not exists (
  select 1 from public.feedback_questions q where q.section_key = 'practical_work');
