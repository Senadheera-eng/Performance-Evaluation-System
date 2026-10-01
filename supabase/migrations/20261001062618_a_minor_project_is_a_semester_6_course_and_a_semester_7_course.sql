-- A minor project is two courses: its Semester 6 part and its Semester 7 part.
--
-- CO3554 Data Management Project and CO3563 High Performance Computing
-- Project run across two semesters: the curriculum and the department's
-- minor study plan both list them in Semester 6 for 3 credits and in
-- Semester 7 for 2. The catalogue held each as a single Semester 7 row of 2
-- credits, which both semesters' curricula pointed at. So the Semester 6
-- catalogue did not list them at all, a Semester 6 enrolment counted 2
-- credits rather than 3, and its results would have been filed against a
-- Semester 7 course.
--
-- The catalogue already has a shape for this: CO4002 Engineering Project is
-- one row in Semester 7 (4 credits) and another in Semester 8 (6). The
-- projects now follow it. The existing rows stay as the Semester 7 parts --
-- everything recorded against them so far (the 2024/2025 enrolments, the
-- Semester 7 offering, feedback) is Semester 7 -- and each gets a Semester 6
-- row of 3 credits, which the Semester 6 curriculum, the minor plan's
-- Semester 6 baskets and a Semester 6 offering for each batch already past
-- it now point to.
do $$
declare
  r      record;
  v_new  uuid;
begin
  for r in
    select c.* from public.courses c
     where c.department = 'Computer Engineering'
       and c.course_code in ('CO3554', 'CO3563')
       and c.semester = 7
  loop
    select id into v_new from public.courses
     where course_code = r.course_code and department = r.department and semester = 6;

    if v_new is null then
      insert into public.courses
        (course_code, title, credits, semester, year, department, category,
         minor_category, contributes_to_gpa, lecturer_name, ca_weight, ese_weight)
      values
        (r.course_code, r.title, 3, 6, 3, r.department, r.category,
         r.minor_category, r.contributes_to_gpa, r.lecturer_name, r.ca_weight, r.ese_weight)
      returning id into v_new;
    end if;

    update public.curriculum_slots
       set course_id = v_new
     where department = r.department and semester = 6 and course_id = r.id;

    update public.minor_plan_courses mc
       set course_id = v_new
      from public.minor_plan_baskets b
     where b.id = mc.basket_id and b.semester = 6 and mc.course_id = r.id;

    -- A Semester 6 delivery wherever the department's other Semester 6
    -- courses have one, as the backfill gave every course.
    insert into public.course_offerings (course_id, academic_year, semester, batch_year, department, status)
    select distinct on (o.academic_year, o.batch_year)
           v_new, o.academic_year, o.semester, o.batch_year, o.department, o.status
      from public.course_offerings o
      join public.courses c on c.id = o.course_id
     where c.department = r.department and o.semester = 6
       and not exists (select 1 from public.course_offerings x
                        where x.course_id = v_new and x.academic_year = o.academic_year
                          and x.batch_year is not distinct from o.batch_year);
  end loop;
end $$;
