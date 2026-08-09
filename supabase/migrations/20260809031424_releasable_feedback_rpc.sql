-- releasable_feedback_rpc
-- Applied 20260809031424
-- Exported from the live project; do not edit by hand.

/** Closed feedback periods in the caller's department, one row per course
 *  offering, with who the results would go to and whether they have gone
 *  yet. This is the department admin's release queue. */
create or replace function public.get_releasable_feedback()
returns table (
  period_id       uuid,
  period_title    text,
  period_status   text,
  offering_id     uuid,
  course_code     text,
  course_title    text,
  semester        integer,
  batch_year      integer,
  response_count  integer,
  eligible_count  integer,
  is_released     boolean,
  lecturers       text
)
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_department text;
  v_is_super   boolean;
begin
  v_is_super := coalesce(public.get_my_role(), '') = 'super_admin';
  v_department := coalesce(public.my_hod_department(), public.get_my_department());

  if not v_is_super and v_department is null then
    raise exception 'Feedback release requires a department admin or an active HOD appointment';
  end if;

  return query
  select p.id, p.title, p.status, o.id, c.course_code, c.title, c.semester, o.batch_year,
         (select count(*)::int from public.feedback_submissions fs
           where fs.feedback_period_id = p.id and fs.course_id = c.id
             and fs.status = 'submitted'),
         (select count(*)::int from public.students s
           where s.role = 'student' and s.status = 'active'
             and s.batch_year = o.batch_year
             and public.student_took_course(s.id, c.id)),
         exists (select 1 from public.feedback_releases fr
                  where fr.feedback_period_id = p.id and fr.offering_id = o.id),
         -- NULL rather than an empty string when nobody is assigned: the
         -- release button then has nobody to release to, and the UI says so.
         (select string_agg(coalesce(l.title || ' ', '') || l.name, ', ' order by l.name)
            from public.course_lecturers cl
            join public.lecturers l on l.id = cl.lecturer_id
           where cl.offering_id = o.id and cl.is_active)
    from public.feedback_periods p
    join public.feedback_period_courses fpc on fpc.feedback_period_id = p.id
    join public.courses c                   on c.id = fpc.course_id
    join public.course_offerings o          on o.course_id = c.id
                                           and (p.batch_year is null or o.batch_year = p.batch_year)
   where p.status in ('closed', 'archived')
     and (v_is_super or o.department = v_department)
   order by p.closes_at desc, c.course_code;
end;
$$;

revoke execute on function public.get_releasable_feedback() from public, anon;
grant  execute on function public.get_releasable_feedback() to authenticated;
