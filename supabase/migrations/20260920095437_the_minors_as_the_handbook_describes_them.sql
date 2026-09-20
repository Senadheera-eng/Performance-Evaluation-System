-- Computer Engineering minors, as the 2026 Faculty Handbook describes them.
--
-- The handbook's curriculum tables carry no minor column; the only place it
-- says what a minor covers is the department page (p. 42):
--
--   "Students who follow Data Management shall explore the topics of natural
--    language processing, quality engineering, and machine learning ...
--    Students who follow High-Performance Computing shall study topics such
--    as cloud computing and applications, advanced computer architecture,
--    and GPU programming."
--
-- The tags in this table came from the original seed data and matched only
-- one course per minor. This sets them to the courses the handbook actually
-- names, and clears the two it does not (CO4351 Advanced Database Systems,
-- CO4361 Concurrent Processing).
--
-- CO4352 Advanced Algorithms stays unassigned on purpose: the handbook lists
-- it in Elective (3) and names it under neither minor.
--
-- The two project courses keep their tags — CO3554 Data Management Project
-- and CO3563 High Performance Computing Project are named for the minors in
-- the handbook's own course titles, and the same paragraph says students
-- gain experience in those areas "by involving in multiple projects".

update public.courses set minor_category = 'Data Management'
 where department = 'Computer Engineering'
   and course_code in ('CO3251', 'CO3256', 'CO4254');

update public.courses set minor_category = 'High-Performance Computing'
 where department = 'Computer Engineering'
   and course_code in ('CO3261', 'CO3262', 'CO4362');

update public.courses set minor_category = null
 where department = 'Computer Engineering'
   and course_code in ('CO4351', 'CO4361');