-- a_multi_select_answer_has_to_survive_the_write
-- Applied 20260829174515
-- Exported from the live project; do not edit by hand.

-- A multi-select answer has to survive the write.
--
-- The bank learned to ask a question with several answers, and the writer
-- still only knew how to store one. Every skill a student ticked would have
-- been dropped on the way to the table, silently -- the submission would
-- succeed and the answer would be empty.
--
-- The option check follows the same widening. It exists because a chosen
-- value must be one the question actually offers, or a crafted request could
-- write anything it liked into the tallies; that has to hold for each value
-- in a multi-select, not just for a single one.

create or replace function public.write_feedback_answers(
  p_submission_id uuid, p_offering_id uuid, p_answers jsonb)
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_answer   jsonb;
  v_lecturer uuid;
  v_type     text;
  v_values   jsonb;
begin
  delete from feedback_answers where submission_id = p_submission_id;

  for v_answer in select * from jsonb_array_elements(coalesce(p_answers, '[]'::jsonb))
  loop
    v_lecturer := nullif(v_answer->>'lecturer_target_id', '')::uuid;

    -- A lecturer-targeted answer must name someone actually teaching this
    -- delivery. Without this a crafted request could attach ratings to any
    -- lecturer in the faculty.
    if v_lecturer is not null and not exists (
      select 1 from course_lecturers cl
       where cl.offering_id = p_offering_id
         and cl.lecturer_id = v_lecturer
         and cl.is_active
    ) then
      raise exception 'That lecturer does not teach this course offering';
    end if;

    select question_type into v_type
      from feedback_questions where id = (v_answer->>'question_id')::uuid;

    -- And a chosen option must be one the question actually offers.
    if v_type = 'single_choice'
       and coalesce(btrim(v_answer->>'choice_value'), '') <> ''
       and not exists (
         select 1 from feedback_questions fq,
                       lateral jsonb_array_elements(fq.options) o
          where fq.id = (v_answer->>'question_id')::uuid
            and o->>'value' = v_answer->>'choice_value'
       ) then
      raise exception 'That is not one of the available options for this question';
    end if;

    v_values := null;
    if v_type = 'multi_select' then
      -- Keep only values the question offers, and only once each. A repeated
      -- tick would otherwise count as two students picking it.
      select case when count(*) = 0 then null else jsonb_agg(distinct v) end
        into v_values
        from jsonb_array_elements_text(
               case when jsonb_typeof(v_answer->'choice_values') = 'array'
                    then v_answer->'choice_values' else '[]'::jsonb end) v
       where exists (
         select 1 from feedback_questions fq,
                       lateral jsonb_array_elements(fq.options) o
          where fq.id = (v_answer->>'question_id')::uuid
            and o->>'value' = v);
    end if;

    insert into feedback_answers
      (submission_id, question_id, lecturer_target_id, rating_value,
       text_value, choice_value, choice_values)
    values (
      p_submission_id,
      (v_answer->>'question_id')::uuid,
      v_lecturer,
      nullif(v_answer->>'rating_value','')::int,
      nullif(v_answer->>'text_value',''),
      nullif(btrim(v_answer->>'choice_value'),''),
      v_values
    );
  end loop;
end;
$$;
