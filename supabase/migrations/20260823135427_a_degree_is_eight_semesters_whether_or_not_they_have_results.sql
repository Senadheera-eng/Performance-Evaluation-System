-- a_degree_is_eight_semesters_whether_or_not_they_have_results
-- Applied 20260823135427
-- Exported from the live project; do not edit by hand.

-- The results page showed the semesters that had results in them, so a degree
-- appeared to be however far the student had got. Semester 7 did not exist
-- until the first Semester 7 mark was published, and then appeared complete.
--
-- A degree is eight semesters from the day it starts. This returns all of
-- them, always, and says of each one what is actually true: nothing published
-- yet, some of it published, or finished.
--
-- The distinction matters most in the middle. One published course out of six
-- is a real result and the student should see it. It is not a semester GPA,
-- and showing one computed from a third of the marks would be worse than
-- showing none. So a course result appears the moment it is published, and
-- the SGPA waits until every course the student is enrolled in that semester
-- has been. A semester with no enrolments on record is historic -- the
-- enrolment system is newer than the results in it -- and counts as finished.

create or replace function public.get_my_academic_record()
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_student   record;
  v_total_sem int;
  v_semesters jsonb := '[]'::jsonb;
  s           int;
  v_courses   jsonb;
  v_enrolled  int;
  v_published int;
  v_complete  boolean;
  v_sgpa      numeric;
  v_credits   int;
  v_year      text;
  v_points    numeric := 0;
  v_gpa_creds int := 0;
begin
  select st.id, st.batch_year, st.department into v_student
    from public.students st where st.id = auth.uid();
  if v_student.id is null then
    raise exception 'Only a student has an academic record here';
  end if;

  select coalesce((value #>> '{}')::int, 8) into v_total_sem
    from public.system_settings where key = 'total_semesters';
  v_total_sem := coalesce(v_total_sem, 8);

  for s in 1..v_total_sem loop
    -- Everything published for this student in this semester.
    select coalesce(jsonb_agg(jsonb_build_object(
             'course_id',   c.id,
             'course_code', c.course_code,
             'title',       c.title,
             'credits',     c.credits,
             'grade',       r.grade,
             'gpv',         r.gpv,
             'contributes_to_gpa', c.contributes_to_gpa,
             'published_at', r.published_at)
             order by c.course_code), '[]'::jsonb),
           count(*)::int
      into v_courses, v_published
      from public.results r
      join public.courses c on c.id = r.course_id
     where r.student_id = v_student.id
       and r.is_published
       and c.semester = s;

    -- What the student is on the hook for this semester. Zero means the
    -- semester predates the enrolment system, not that they took nothing.
    select count(*)::int into v_enrolled
      from public.enrollments e
      join public.courses c on c.id = e.course_id
     where e.student_id = v_student.id
       and e.status = 'enrolled'
       and c.semester = s;

    v_complete := (v_enrolled = 0 and v_published > 0)
               or (v_enrolled > 0 and v_published >= v_enrolled);

    select sum(r.gpv * c.credits), sum(c.credits)::int
      into v_sgpa, v_credits
      from public.results r
      join public.courses c on c.id = r.course_id
     where r.student_id = v_student.id
       and r.is_published
       and c.semester = s
       and c.contributes_to_gpa;

    if v_complete and coalesce(v_credits, 0) > 0 then
      v_points    := v_points + v_sgpa;
      v_gpa_creds := v_gpa_creds + v_credits;
      v_sgpa      := round(v_sgpa / v_credits, 2);
    else
      v_sgpa := null;
    end if;

    select max(r.academic_year) into v_year
      from public.results r
      join public.courses c on c.id = r.course_id
     where r.student_id = v_student.id and c.semester = s;

    v_semesters := v_semesters || jsonb_build_object(
      'semester',      s,
      'academic_year', coalesce(v_year,
        (v_student.batch_year + ceil(s / 2.0)::int - 1)::text || '/' ||
        (v_student.batch_year + ceil(s / 2.0)::int)::text),
      'enrolled',      v_enrolled,
      'published',     v_published,
      'complete',      v_complete,
      'gpa_credits',   coalesce(v_credits, 0),
      'sgpa',          v_sgpa,
      'courses',       v_courses);
  end loop;

  return jsonb_build_object(
    'cgpa', case when v_gpa_creds > 0 then round(v_points / v_gpa_creds, 2) end,
    'gpa_credits', v_gpa_creds,
    'semesters', v_semesters);
end;
$$;

-- The official sheet, as it goes on the noticeboard: one course, every
-- student who sat it, index number and grade. Offered only for courses this
-- student took, and only once the department has published them.
--
-- Names are left out on purpose. A published sheet is a list of index numbers
-- against grades; adding names would put more of someone else's record in
-- front of a classmate than the paper version ever did.
create or replace function public.get_my_published_result_sheets()
returns table(offering_id uuid, course_id uuid, course_code text, course_title text,
              semester integer, academic_year text, batch_year integer,
              students integer, published_at timestamp with time zone)
language sql stable security definer set search_path to 'public'
as $$
  select o.id, c.id, c.course_code, c.title, c.semester, o.academic_year, o.batch_year,
         count(*)::int, max(r.published_at)
    from public.results r
    join public.course_offerings o on o.id = r.offering_id
    join public.courses c on c.id = o.course_id
   where r.is_published
     and exists (select 1 from public.results mine
                  where mine.offering_id = o.id
                    and mine.student_id = auth.uid()
                    and mine.is_published)
   group by o.id, c.id, c.course_code, c.title, c.semester, o.academic_year, o.batch_year
   order by c.semester desc, c.course_code;
$$;

create or replace function public.get_published_result_sheet(p_offering_id uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_head record;
  v_rows jsonb;
begin
  -- The sheet is open to the people on it, and to nobody else.
  if not exists (select 1 from public.results r
                  where r.offering_id = p_offering_id
                    and r.student_id = auth.uid()
                    and r.is_published) then
    raise exception 'That result sheet is not one of yours';
  end if;

  select c.course_code, c.title, c.credits, c.semester,
         o.academic_year, o.batch_year, o.department
    into v_head
    from public.course_offerings o
    join public.courses c on c.id = o.course_id
   where o.id = p_offering_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'index_number', st.index_number,
           'grade',        r.grade,
           'is_me',        (st.id = auth.uid()))
           order by st.index_number), '[]'::jsonb)
    into v_rows
    from public.results r
    join public.students st on st.id = r.student_id
   where r.offering_id = p_offering_id and r.is_published;

  return jsonb_build_object(
    'course_code',   v_head.course_code,
    'course_title',  v_head.title,
    'credits',       v_head.credits,
    'semester',      v_head.semester,
    'academic_year', v_head.academic_year,
    'batch_year',    v_head.batch_year,
    'department',    v_head.department,
    'rows',          v_rows);
end;
$$;

grant execute on function public.get_my_academic_record() to authenticated;
grant execute on function public.get_my_published_result_sheets() to authenticated;
grant execute on function public.get_published_result_sheet(uuid) to authenticated;
