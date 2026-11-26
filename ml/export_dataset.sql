-- The training data for ml/train.py, anonymised.
--
-- Run in the Supabase SQL editor. It returns one row per file; save each
-- `content` as ml/data/<file> (ml/data is git-ignored). A long results list
-- may be split across several files named results_*.txt; train.py reads
-- every results*.txt in ml/data.
--
-- Students and courses are numbered 1, 2, 3... in id order. No id, name,
-- index number or other personal detail leaves the database: a student is a
-- number and a department, and a result is a course number and a grade.
-- fingerprint.json records which lists the numbers came from, and
-- ml_load_predictions refuses predictions made from lists that have since
-- changed.
--
-- Formats (records separated by ";"):
--   courses.txt   number,department,semester,credits,category (C/E/O),in GPA (1/0),
--                 graded here (1/0: 0 for the earlier part of a course taught over
--                 two semesters, whose grade is given with its later part)
--   students.txt  number,department
--   results.txt   student=<course number in two base-36 digits><grade code>...
--                 grade codes: 1 A+, 2 A, 3 A-, 4 B+, 5 B, 6 B-, 7 C+, 8 C, R, F, L
with dept(name, code) as (values
  ('Civil Engineering', 'CE'), ('Computer Engineering', 'CO'),
  ('Electrical and Electronic Engineering', 'EE'), ('Mechanical Engineering', 'ME'),
  ('Interdisciplinary Studies', 'IS')),
s as (select id, department, (dense_rank() over (order by id))::int si
        from public.students where role = 'student'),
c as (select id, department, semester, credits, category, contributes_to_gpa, graded_with,
             (dense_rank() over (order by id))::int ci
        from public.courses),
k as (select ci, id,
             substr('0123456789abcdefghijklmnopqrstuvwxyz', ci / 36 + 1, 1) ||
             substr('0123456789abcdefghijklmnopqrstuvwxyz', ci % 36 + 1, 1) as code
        from c),
r as (select s.si,
             string_agg(k.code || case r.grade when 'A+' then '1' when 'A' then '2' when 'A-' then '3'
                                               when 'B+' then '4' when 'B' then '5' when 'B-' then '6'
                                               when 'C+' then '7' when 'C' then '8' else r.grade end,
                        '' order by k.ci, r.id) as codes
        from public.results r
        join s on s.id = r.student_id
        join k on k.id = r.course_id
       where r.is_published
       group by s.si)
select 'courses.txt' as file,
       (select string_agg(ci || ',' || d.code || ',' || semester || ',' || credits || ',' ||
                          left(category, 1) || ',' || (case when contributes_to_gpa then 1 else 0 end) || ',' ||
                          (case when graded_with is null then 1 else 0 end),
                          ';' order by ci)
          from c join dept d on d.name = c.department) as content
union all
select 'students.txt',
       (select string_agg(si || ',' || d.code, ';' order by si) from s join dept d on d.name = s.department)
union all
select 'results.txt', (select string_agg(si || '=' || codes, ';' order by si) from r)
union all
select 'fingerprint.json',
       json_build_object(
         'students', (select md5(string_agg(id::text, ',' order by id)) from public.students where role = 'student'),
         'courses', (select md5(string_agg(id::text, ',' order by id)) from public.courses))::text;
