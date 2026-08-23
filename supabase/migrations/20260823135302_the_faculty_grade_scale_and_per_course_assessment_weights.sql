-- the_faculty_grade_scale_and_per_course_assessment_weights
-- Applied 20260823135302
-- Exported from the live project; do not edit by hand.

-- Two corrections to things the system assumed on the faculty's behalf.
--
-- First, the grade scale. It carried C-, D+ and D, which this faculty does not
-- award. No result has ever used one -- checked before removing them -- so
-- taking them out changes no record. What it does change is the band below C:
-- with nothing between C and F, a mark under 45 is an F.
--
-- Second, assessment weights. OA = CA + mid-semester + ESE was one global
-- setting applied to every course in the faculty, which is not how courses are
-- built: a laboratory course may carry no mid-semester paper at all, and a
-- project course may be continuous assessment throughout. The split now
-- belongs to the course, seeded from the global setting so nothing computed
-- today computes differently tomorrow. The setting stays on as the default for
-- a newly created course.

update public.system_settings
   set value = value - 'C-' - 'D+' - 'D'
 where key = 'gpv_scale';

update public.system_settings
   set value = '[
     {"grade":"A+","min_oa":85},
     {"grade":"A","min_oa":75},
     {"grade":"A-","min_oa":70},
     {"grade":"B+","min_oa":65},
     {"grade":"B","min_oa":60},
     {"grade":"B-","min_oa":55},
     {"grade":"C+","min_oa":50},
     {"grade":"C","min_oa":45},
     {"grade":"F","min_oa":0}
   ]'::jsonb
 where key = 'grade_boundaries';

alter table public.courses
  add column if not exists ca_weight      numeric(4,3),
  add column if not exists mid_sem_weight numeric(4,3),
  add column if not exists ese_weight     numeric(4,3);

-- Seeded from the setting that governed them until now, so no course changes
-- how it is marked on the day this lands.
update public.courses c
   set ca_weight      = coalesce(c.ca_weight,      (s.value ->> 'ca')::numeric),
       mid_sem_weight = coalesce(c.mid_sem_weight, (s.value ->> 'mid_sem')::numeric),
       ese_weight     = coalesce(c.ese_weight,     (s.value ->> 'ese')::numeric)
  from public.system_settings s
 where s.key = 'oa_weights';

alter table public.courses
  alter column ca_weight      set not null,
  alter column mid_sem_weight set not null,
  alter column ese_weight     set not null;

alter table public.courses
  drop constraint if exists courses_assessment_weights_sum;
alter table public.courses
  add constraint courses_assessment_weights_sum
  check (ca_weight + mid_sem_weight + ese_weight = 1
         and ca_weight between 0 and 1
         and mid_sem_weight between 0 and 1
         and ese_weight between 0 and 1);

comment on column public.courses.ca_weight is
  'Share of the overall mark from continuous assessment. The three weights sum to 1.';
comment on column public.courses.mid_sem_weight is
  'Share from the mid-semester paper. Zero for a course that does not sit one.';
comment on column public.courses.ese_weight is
  'Share from the end-of-semester examination.';

-- What a student is entitled to know about a course they are taking: how it is
-- marked, who runs it, and whether it counts. Readable by anyone signed in,
-- because none of it is private -- it is the course, not a person's record.
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

  -- Whoever currently coordinates it, on whichever deliveries are running.
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
    'mid_sem_weight',   c.mid_sem_weight,
    'ese_weight',       c.ese_weight,
    'coordinators',     coalesce(to_jsonb(v_coordinators), '[]'::jsonb));
end;
$$;

grant execute on function public.get_course_detail(uuid) to authenticated;
