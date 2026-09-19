-- pin_search_path_on_feedback_answer_provided
-- Applied 20260808213454
-- Exported from the live project; do not edit by hand.

-- Missed a `set search_path` on this one. Every other function in the schema
-- pins it; without it the function resolves names against whatever the
-- caller's search_path happens to be, which is the whole shape of a
-- search-path hijack even when — as here — the body only calls built-ins.
create or replace function public.feedback_answer_provided(
  p_question_type text,
  p_answer jsonb
)
returns boolean
language sql
immutable
set search_path to 'public'
as $$
  select case p_question_type
    when 'rating' then coalesce(p_answer->>'rating_value', '') <> ''
    when 'single_choice' then coalesce(btrim(p_answer->>'choice_value'), '') <> ''
    when 'yes_no' then coalesce(btrim(p_answer->>'choice_value'), '') <> ''
    else coalesce(btrim(p_answer->>'text_value'), '') <> ''
  end;
$$;

revoke execute on function public.feedback_answer_provided(text, jsonb) from public, anon;
grant  execute on function public.feedback_answer_provided(text, jsonb) to authenticated;
