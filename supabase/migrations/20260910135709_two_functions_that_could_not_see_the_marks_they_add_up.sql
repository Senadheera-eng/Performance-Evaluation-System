/*
  calculate_gpa_target and get_upcoming_courses both add up a student's
  published results, and neither could read a single one of them.

  Both were SECURITY INVOKER, so they ran as the student — and a student has
  no row-level policy on `results` at all. That is deliberate and correct:
  marks are read through security-definer functions and the
  my_published_results view, so that the "not until it is published" rule is
  enforced in one place. But it means an invoker function counting rows in
  `results` counts zero, for everyone, always.

  Measured on a real student (index 22/ENG/166, 53 published results):

    get_academic_standing   CGPA 2.89, 125 credits done, next semester 7
    calculate_gpa_target    CGPA 0.00,   0 credits done, 144 remaining
    get_upcoming_courses    next semester 1

  So the Graduation Planner has been telling a student six semesters in that
  they need a 3.70 average across all 144 credits starting from nothing, and
  "what am I taking next semester" has been answering with semester 1.

  Both functions resolve the student from auth.uid() and filter every read on
  it, so running them as definer cannot widen what they return — it can only
  let them see the caller's own marks, which is exactly what
  get_academic_standing already does. The bodies are not touched; only the
  security property changes.
*/

alter function public.calculate_gpa_target(numeric) security definer;
alter function public.get_upcoming_courses() security definer;
