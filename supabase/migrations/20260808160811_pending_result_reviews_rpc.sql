-- pending_result_reviews_rpc
-- Applied 20260808160811
-- Exported from the live project; do not edit by hand.

/** Result sheets a lecturer has submitted and the department has not yet
 *  acted on. Without this the submit step is a dead end: a lecturer can hand
 *  a sheet over, but nothing tells the department admin it is waiting. */
create or replace function public.get_pending_result_reviews()
returns table (
  offering_id     uuid,
  course_id       uuid,
  course_code     text,
  course_title    text,
  semester        integer,
  academic_year   text,
  batch_year      integer,
  department      text,
  submitted_count integer,
  draft_count     integer,
  total_count     integer,
  submitted_at    timestamptz,
  submitted_by    text
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
    raise exception 'Result review requires a department admin or an active HOD appointment';
  end if;

  return query
  select o.id, c.id, c.course_code, c.title, c.semester, o.academic_year,
         o.batch_year, o.department,
         count(*) filter (where r.status = 'submitted')::int,
         count(*) filter (where r.status = 'draft')::int,
         count(*)::int,
         max(r.submitted_at),
         -- Who handed it over. Resolved through lecturers rather than left as
         -- a bare uuid, since the reviewer needs to know who to talk to.
         (select coalesce(l.title || ' ', '') || l.name
            from public.lecturers l
           where l.auth_user_id = (
             select r2.submitted_by from public.results r2
              where r2.offering_id = o.id and r2.submitted_by is not null
              limit 1))
    from public.results r
    join public.course_offerings o on o.id = r.offering_id
    join public.courses c          on c.id = o.course_id
   where r.status = 'submitted'
     and (v_is_super or o.department = v_department)
   group by o.id, c.id, c.course_code, c.title, c.semester,
            o.academic_year, o.batch_year, o.department
   order by max(r.submitted_at) desc nulls last;
end;
$$;

revoke execute on function public.get_pending_result_reviews() from public, anon;
grant  execute on function public.get_pending_result_reviews() to authenticated;
