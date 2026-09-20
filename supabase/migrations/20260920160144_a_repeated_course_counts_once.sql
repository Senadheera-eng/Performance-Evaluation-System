-- A repeated course counts once.
--
-- A resit of the same delivery updates the result in place — cap_resit_grade
-- caps it and original_grade remembers what it was — so there is one row and
-- nothing to reconcile. Repeating the course with a later batch is different:
-- that is a new delivery, a new academic year, and therefore a second results
-- row. Every figure in the system sums the rows it finds, so the student
-- would carry the course's credits twice and the failed attempt would drag
-- their CGPA down for ever.
--
-- The rule the faculty already works to is that the later attempt replaces
-- the earlier one (capped, by the same trigger). So the earlier attempt keeps
-- its grade and its marks — it is still the student's record, and still shown
-- to them — but stops carrying a grade point. Every aggregate in the system
-- already ignores a result with no grade point, so all of them come right at
-- once instead of fifteen of them being taught the same rule separately.
--
-- Nothing in the data has a second attempt today, so this changes no figure
-- now; it decides what happens the first time someone repeats a course.
create or replace function public.settle_repeated_attempts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  with touched as (
    select distinct student_id, course_id from changed_rows
  ),
  ranked as (
    select r.id, r.grade,
           row_number() over (
             partition by r.student_id, r.course_id
             order by r.academic_year desc, r.published_at desc nulls last,
                      r.created_at desc) as attempt_rank
      from public.results r
      join touched t on t.student_id = r.student_id and t.course_id = r.course_id
     where r.is_published
  )
  update public.results r
     set gpv = case when ranked.attempt_rank = 1
                    then public.grade_point_value(ranked.grade)
                    else null end
    from ranked
   where r.id = ranked.id
     and r.gpv is distinct from (case when ranked.attempt_rank = 1
                                      then public.grade_point_value(ranked.grade)
                                      else null end);

  return null;
end;
$$;

/* Statement-level, and after the row triggers that derive the grade point,
   so it settles what those left behind. Insert and update read the new rows;
   a delete or an unpublish has to look at what is left, which the old table
   gives it. */
drop trigger if exists results_90_settle_repeats_ins on public.results;
create trigger results_90_settle_repeats_ins
  after insert on public.results
  referencing new table as changed_rows
  for each statement execute function public.settle_repeated_attempts();

drop trigger if exists results_90_settle_repeats_upd on public.results;
create trigger results_90_settle_repeats_upd
  after update on public.results
  referencing new table as changed_rows
  for each statement execute function public.settle_repeated_attempts();

drop trigger if exists results_90_settle_repeats_del on public.results;
create trigger results_90_settle_repeats_del
  after delete on public.results
  referencing old table as changed_rows
  for each statement execute function public.settle_repeated_attempts();

-- The student's own results, with each attempt numbered so a page can say
-- which one counts. New columns are appended; the existing ones keep their
-- place, because a view cannot reorder what it already has.
create or replace view public.my_published_results as
select r.id,
       r.student_id,
       r.course_id,
       r.offering_id,
       r.academic_year,
       r.mid_sem_mark,
       r.ca_mark,
       r.grade,
       r.gpv,
       r.published_at,
       c.course_code,
       c.title as course_title,
       c.credits,
       c.semester,
       c.year as course_year,
       c.category,
       c.minor_category,
       c.contributes_to_gpa,
       c.department as course_department,
       r.original_grade,
       row_number() over (partition by r.course_id
                          order by r.academic_year, r.published_at nulls first) as attempt_number,
       (count(*) over (partition by r.course_id) > 1) as has_repeat,
       (row_number() over (partition by r.course_id
                           order by r.academic_year desc, r.published_at desc nulls last) = 1)
         as is_latest_attempt
  from results r
  join courses c on c.id = r.course_id
 where r.student_id = auth.uid() and r.is_published = true;;
