-- fix_null_unsafe_feedback_question_constraints
-- Applied 20260809034904
-- Exported from the live project; do not edit by hand.

-- Both of these constraints were written as an OR of two branches and both
-- let the case they exist to catch straight through.
--
--   single_choice with options = NULL:
--     branch 1 -> true AND jsonb_typeof(NULL)='array' AND ...  ->  NULL
--     branch 2 -> 'single_choice' <> 'single_choice' AND ...   ->  false
--     NULL OR false -> NULL, and a CHECK only rejects on false.
--
-- The same shape let a half-written dependency (a gate question with no
-- values to match) through. A single_choice question with no options renders
-- as an unanswerable form, and a dangling dependency hides a question
-- forever, so these are worth holding at the table rather than trusting the
-- editor to be the only writer.
--
-- CASE returns a definite boolean for every input, which is what these
-- needed all along.

alter table public.feedback_questions drop constraint if exists feedback_questions_options_shape;

alter table public.feedback_questions
  add constraint feedback_questions_options_shape check (
    case when question_type = 'single_choice'
         then coalesce(jsonb_typeof(options), '') = 'array'
              and coalesce(jsonb_array_length(options), 0) > 0
         else options is null
    end
  );

alter table public.feedback_questions drop constraint if exists feedback_questions_dependency_shape;

alter table public.feedback_questions
  add constraint feedback_questions_dependency_shape check (
    case when depends_on_question_id is null
         then depends_on_values is null
         else coalesce(jsonb_typeof(depends_on_values), '') = 'array'
              and coalesce(jsonb_array_length(depends_on_values), 0) > 0
    end
  );
