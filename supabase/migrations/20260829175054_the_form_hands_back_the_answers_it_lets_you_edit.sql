-- the_form_hands_back_the_answers_it_lets_you_edit
-- Applied 20260829175054
-- Exported from the live project; do not edit by hand.

-- The form hands back the answers it lets you edit.
--
-- A student may revise their feedback until the round closes, and the form
-- said so: it loaded the existing submission, used it to work out whether
-- editing was still allowed, and set can_edit accordingly. Then it returned
-- everything except the submission itself.
--
-- So the page opened a form it had just been told was editable, with nothing
-- in it. The student's own answers were on the server the whole time; the
-- page had no way to see them. Worse than showing nothing: saving that empty
-- form would have replaced a complete response with a blank one, because the
-- writer takes the answers it is given as the whole truth.
--
-- One key, missing.

do $$
declare
  v_def text;
  v_new text;
begin
  v_def := pg_get_functiondef(
    'public.get_student_feedback_form(uuid,uuid)'::regprocedure);

  v_new := replace(v_def,
    '    ''can_edit'', v_can_edit' || chr(10) || '  );',
    '    ''can_edit'', v_can_edit,' || chr(10) ||
    '    ''submission'', v_submission' || chr(10) || '  );');

  if v_new = v_def then
    raise exception
      'get_student_feedback_form no longer ends the way this migration patches';
  end if;

  execute v_new;
end
$$;
