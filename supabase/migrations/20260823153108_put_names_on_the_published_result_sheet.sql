-- put_names_on_the_published_result_sheet
-- Applied 20260823153108
-- Exported from the live project; do not edit by hand.

-- Names on the sheet, at the faculty's direction.
--
-- The first cut carried index numbers and grades only, on the reasoning that
-- a narrower sheet exposes less of a classmate's record. The faculty publishes
-- names, so the sheet does: this is a document the department releases, and
-- what belongs on it is theirs to decide, not the system's.
--
-- The scope is unchanged and still narrow: a student sees the sheet only for a
-- course they themselves sat, and only after the department has published it.

create or replace function public.get_published_result_sheet(p_offering_id uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_head record;
  v_rows jsonb;
begin
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
           'name',         st.name,
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
