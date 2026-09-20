-- Settling repeats, without fighting the resit cap or itself.
--
-- The first version recomputed the grade point of the attempt that counts.
-- That put it in a tug of war with cap_resit_grade, which caps a resit at C:
-- this trigger pushed the uncapped value back, the cap trigger capped it
-- again, and the two recursed until the stack gave out.
--
-- It now only does the part nothing else does: take the grade point off an
-- attempt that a later one has replaced, and give one back if that later
-- attempt goes away. An attempt that already carries a grade point is left
-- exactly as the grading triggers left it. The depth guard stops it
-- re-entering on the update it makes itself.
create or replace function public.settle_repeated_attempts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Its own update fires this trigger again; once is enough.
  if pg_trigger_depth() > 1 then
    return null;
  end if;

  with touched as (
    select distinct student_id, course_id from changed_rows
  ),
  ranked as (
    select r.id, r.grade, r.gpv,
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
     and (
       -- Replaced by a later attempt: it stops counting.
       (ranked.attempt_rank > 1 and ranked.gpv is not null)
       -- The only attempt again: it counts once more.
       or (ranked.attempt_rank = 1 and ranked.gpv is null and ranked.grade is not null)
     );

  return null;
end;
$$;;
