/*
  Two things the last migration walked into.

  The head of department may now publish, and could not. results.published_by
  carried a foreign key to admins(id), and a head of department is a lecturer —
  they hold no admins row. Publishing set published_by = auth.uid() and the
  insert died on the constraint: "violates foreign key constraint
  results_published_by_fkey". Every other actor column on this table already
  points at auth.users — entered_by, submitted_by, returned_by, corrected_by —
  because every other one of them can be a lecturer. published_by was the
  odd one out from when only an admin could publish.

  And trigger order. Triggers of the same timing fire in name order, which put
  results_cap_resit_grade ahead of the new grade-point trigger. The cap decides
  whether to apply by reading new.gpv — and now that gpv is derived rather than
  supplied, new.gpv is null when the cap looks at it. coalesce(null,0) > 2.0 is
  false, so a student resitting a failed module would have kept the A they
  scored instead of the C the handbook caps it at. Nothing failed; the grade
  would simply have been wrong.

  Deriving first fixes it: the cap then reads a real grade point, and whatever
  it decides it sets both halves itself. The name carries the ordering, so the
  next person to add a trigger here can see where theirs has to go.
*/

alter table public.results
  drop constraint if exists results_published_by_fkey;

alter table public.results
  add constraint results_published_by_fkey
    foreign key (published_by) references auth.users(id) on delete set null;


/*
  Fires on every write, not only when the grade column is named: an update that
  touched gpv alone would otherwise slip past and leave gpv disagreeing with
  the grade beside it. 01 in the name is load-bearing — it must run before
  results_cap_resit_grade, which reads the grade point this sets.
*/
drop trigger if exists trg_results_derive_grade_point on public.results;
drop trigger if exists results_01_derive_grade_point on public.results;
create trigger results_01_derive_grade_point
  before insert or update on public.results
  for each row execute function public.results_derive_grade_point();
