-- the_form_reads_back_what_the_student_ticked
-- Applied 20260829174556
-- Exported from the live project; do not edit by hand.

-- The form reads back what the student ticked.
--
-- A student may edit their feedback until the round closes, which means the
-- form has to hand back everything it stored. It handed back the rating, the
-- text and the single choice, and not the several choices -- so reopening a
-- submitted form showed the skills question blank, and saving again would
-- have wiped an answer the student never touched.
--
-- Patched by rewriting the one line rather than restating the whole function,
-- so nothing else in it can drift by accident. The guard makes a failed match
-- loud: if the shape it is looking for is not there, the migration stops
-- rather than leaving the function silently unchanged.

do $$
declare
  v_def text;
  v_new text;
begin
  v_def := pg_get_functiondef(
    'public.get_student_feedback_form(uuid,uuid)'::regprocedure);

  v_new := replace(v_def,
    '''choice_value'', fa.choice_value))',
    '''choice_value'', fa.choice_value,' || chr(10) ||
    '        ''choice_values'', fa.choice_values))');

  if v_new = v_def then
    raise exception
      'get_student_feedback_form no longer has the answer shape this migration patches';
  end if;

  execute v_new;
end
$$;
