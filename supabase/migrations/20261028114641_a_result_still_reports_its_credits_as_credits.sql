-- The previous migration renamed c.credits to c.result_credits in the GPA
-- functions. Where a function read it into a CTE or record and later asked
-- for it by name (a.credits, v_head.credits), the column had been renamed
-- with it, and the function failed when it ran: the Results page among them.
-- The column is the weight of the result, so it keeps the name "credits".
do $$
declare
  f     record;
  v_def text;
begin
  for f in
    select * from (values
      ('get_my_academic_record',       'c.title, c.result_credits, c.contributes_to_gpa',        'c.title, c.result_credits as credits, c.contributes_to_gpa'),
      ('get_mentee_academic_overview', E'r.gpv,\n           c.result_credits, c.contributes_to_gpa', E'r.gpv,\n           c.result_credits as credits, c.contributes_to_gpa'),
      ('get_my_mentees',               'c.semester, c.result_credits, c.contributes_to_gpa',     'c.semester, c.result_credits as credits, c.contributes_to_gpa'),
      ('get_student_course_result',    'c.course_code, c.title, c.semester, c.result_credits,',  'c.course_code, c.title, c.semester, c.result_credits as credits,'),
      ('get_student_results',          'c.course_code, c.title, c.semester, c.result_credits, c.contributes_to_gpa', 'c.course_code, c.title, c.semester, c.result_credits as credits, c.contributes_to_gpa'),
      ('get_published_result_sheet',   'select c.course_code, c.title, c.result_credits, c.semester', 'select c.course_code, c.title, c.result_credits as credits, c.semester')
    ) as t(fn, old_text, new_text)
  loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = f.fn;
    -- Already applied: nothing to do.
    if position(f.new_text in v_def) > 0 then
      continue;
    end if;
    if position(f.old_text in v_def) = 0 then
      raise exception '%: select list not found', f.fn;
    end if;
    execute replace(v_def, f.old_text, f.new_text);
  end loop;
end $$;
