-- Computer Engineering's Engineering Project (CO4002) runs over the final
-- year: 4 credits in Semester 7 and 6 in Semester 8, with one grade, in
-- Semester 8, for all 10. The Semester 7 part is graded with the Semester 8
-- part, the same way as the minor projects; result_credits follows from the
-- link (0 for Semester 7, 10 for Semester 8).
do $$
declare
  v_n int;
begin
  update public.courses p
     set graded_with = f.id
    from public.courses f
   where p.course_code = 'CO4002'
     and p.department = 'Computer Engineering'
     and p.semester = 7
     and f.course_code = p.course_code
     and f.department = p.department
     and f.semester = 8
     and p.graded_with is null;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'Expected to link 1 Semester 7 part of CO4002, linked %', v_n;
  end if;
end $$;
