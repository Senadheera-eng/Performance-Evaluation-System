-- a_course_is_marked_on_ca_and_ese_the_way_the_handbook_says
-- Applied 20260823145849
-- Exported from the live project; do not edit by hand.

-- The overall mark has two parts, not three.
--
-- From the Faculty Handbook 2026, Assessment of a Course:
--
--   "Assessment in respect of each Course consists of CA and ESE."
--
-- and, on what CA is made of:
--
--   "This consists of components such as mid semester examinations, practical
--    work, fieldwork, assignments, quizzes, and mini projects"
--
-- So the mid-semester paper is not a third term standing beside CA and ESE --
-- it is one of the things CA is built from. Treating it as its own share of
-- the overall mark counted it outside the component it belongs to.
--
-- The handbook does not publish the split. It says only that the "contribution
-- to the final grade from CA and ESE may vary from Course to Course. This
-- information will be made available to the students prior to the
-- commencement of academic activities." Searched the whole document: it
-- carries no percentage figures at all. So every course starts on 30/70, and a
-- department sets its own where the course differs -- which is the variation
-- the handbook is describing.
--
-- mid_sem_mark stays on results. It is a real mark a department records and a
-- student is shown; it simply feeds CA rather than the overall mark.

alter table public.courses
  drop constraint if exists courses_assessment_weights_sum;

alter table public.courses
  drop column if exists mid_sem_weight;

update public.courses
   set ca_weight = 0.300,
       ese_weight = 0.700;

alter table public.courses
  add constraint courses_assessment_weights_sum
  check (ca_weight + ese_weight = 1
         and ca_weight between 0 and 1
         and ese_weight between 0 and 1);

comment on column public.courses.ca_weight is
  'Share of the overall mark from continuous assessment, which includes the mid-semester paper. With ese_weight it sums to 1.';
comment on column public.courses.ese_weight is
  'Share of the overall mark from the end-of-semester examination.';

-- The faculty default a new course starts on.
update public.system_settings
   set value = '{"ca": 0.30, "ese": 0.70}'::jsonb
 where key = 'oa_weights';

create or replace function public.get_course_detail(p_course_id uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  c   record;
  v_coordinators text[];
begin
  select * into c from public.courses where id = p_course_id;
  if c.id is null then
    raise exception 'Course not found';
  end if;

  select array_agg(distinct l.name) into v_coordinators
    from public.course_offerings o
    join public.course_lecturers cl
      on cl.offering_id = o.id and cl.is_active
     and cl.assignment_role = 'coordinator'
    join public.lecturers l on l.id = cl.lecturer_id
   where o.course_id = p_course_id;

  return jsonb_build_object(
    'id',               c.id,
    'course_code',      c.course_code,
    'title',            c.title,
    'credits',          c.credits,
    'semester',         c.semester,
    'year',             c.year,
    'department',       c.department,
    'category',         c.category,
    'minor_category',   c.minor_category,
    'contributes_to_gpa', c.contributes_to_gpa,
    'ca_weight',        c.ca_weight,
    'ese_weight',       c.ese_weight,
    'coordinators',     coalesce(to_jsonb(v_coordinators), '[]'::jsonb));
end;
$$;
