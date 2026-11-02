-- A feedback round the super admin created is the super admin's.
--
-- Until now a department admin could change any round of their own
-- department, whoever created it; a round was the super admin's only when
-- it had no department (faculty-wide). The faculty's rule is about who
-- created it: a round the super admin creates is the super admin's to
-- change, even when it is for one department, and a department admin
-- manages the rounds they (or their department's lecturers, on request)
-- created. A department admin can still see every round of their
-- department, and the super admin can still change every round.
--
-- feedback_periods.created_by is the creator's sign-in account, which is
-- also the admins row's id. Whether that account is a super admin is asked
-- through a security-definer helper, because a department admin cannot read
-- the super admin's admins row and a policy that read it directly would
-- see nothing and wrongly allow the change.

create or replace function public.is_super_admin_account(p_user uuid)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public'
as $$
  select exists (select 1 from public.admins a where a.id = p_user and a.role = 'super_admin');
$$;

revoke all on function public.is_super_admin_account(uuid) from public, anon;
grant execute on function public.is_super_admin_account(uuid) to authenticated, service_role;

-- The round itself: read as before; add, change and delete only what the
-- super admin did not create.
drop policy fp_dept_admin_manage on public.feedback_periods;

create policy fp_dept_admin_read on public.feedback_periods
  for select using (
    (select get_my_role()) = 'dept_admin'
    and department = (select get_my_department()));

create policy fp_dept_admin_insert on public.feedback_periods
  for insert with check (
    (select get_my_role()) = 'dept_admin'
    and department = (select get_my_department())
    and not public.is_super_admin_account(created_by));

create policy fp_dept_admin_update on public.feedback_periods
  for update using (
    (select get_my_role()) = 'dept_admin'
    and department = (select get_my_department())
    and not public.is_super_admin_account(created_by))
  with check (
    (select get_my_role()) = 'dept_admin'
    and department = (select get_my_department())
    and not public.is_super_admin_account(created_by));

create policy fp_dept_admin_delete on public.feedback_periods
  for delete using (
    (select get_my_role()) = 'dept_admin'
    and department = (select get_my_department())
    and not public.is_super_admin_account(created_by));

-- Its courses and questions follow the round: the super admin's round's
-- lists are the super admin's to set. Reading them is unchanged (fpc_read,
-- fpq_read).
drop policy fpc_owner_manage on public.feedback_period_courses;
create policy fpc_owner_manage on public.feedback_period_courses
  for all using (
    exists (
      select 1 from public.feedback_periods p
        join public.courses c on c.id = feedback_period_courses.course_id
       where p.id = feedback_period_courses.feedback_period_id
         and ((select get_my_role()) = 'super_admin'
              or ((select get_my_role()) = 'dept_admin'
                  and p.department = (select get_my_department())
                  and c.department = (select get_my_department())
                  and not public.is_super_admin_account(p.created_by)))))
  with check (
    exists (
      select 1 from public.feedback_periods p
        join public.courses c on c.id = feedback_period_courses.course_id
       where p.id = feedback_period_courses.feedback_period_id
         and ((select get_my_role()) = 'super_admin'
              or ((select get_my_role()) = 'dept_admin'
                  and p.department = (select get_my_department())
                  and c.department = (select get_my_department())
                  and not public.is_super_admin_account(p.created_by)))));

drop policy fpq_owner_manage on public.feedback_period_questions;
create policy fpq_owner_manage on public.feedback_period_questions
  for all using (
    exists (
      select 1 from public.feedback_periods p
       where p.id = feedback_period_questions.feedback_period_id
         and ((select get_my_role()) = 'super_admin'
              or ((select get_my_role()) = 'dept_admin'
                  and p.department = (select get_my_department())
                  and not public.is_super_admin_account(p.created_by)))))
  with check (
    exists (
      select 1 from public.feedback_periods p
       where p.id = feedback_period_questions.feedback_period_id
         and ((select get_my_role()) = 'super_admin'
              or ((select get_my_role()) = 'dept_admin'
                  and p.department = (select get_my_department())
                  and not public.is_super_admin_account(p.created_by)))));

-- The admin list says which rounds the super admin created, so the page can
-- show them as the super admin's instead of offering buttons that would be
-- refused. A new column changes the result type, so the function is
-- recreated with the same body, rows and grants.
drop function public.get_admin_feedback_periods();

create function public.get_admin_feedback_periods()
 returns table(id uuid, title text, academic_year text, semester integer, batch_year integer,
               department text, feedback_type text, opens_at timestamp with time zone,
               closes_at timestamp with time zone, status text, allow_editing boolean,
               created_by_super_admin boolean)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_role text := get_my_role();
  v_dept text := get_my_department();
begin
  if v_role not in ('dept_admin','super_admin') then
    raise exception 'Access denied: admin role required';
  end if;

  return query
  select p.id, p.title, p.academic_year, p.semester, p.batch_year,
         p.department, p.feedback_type, p.opens_at, p.closes_at,
         p.status, p.allow_editing,
         public.is_super_admin_account(p.created_by)
    from feedback_periods p
   where v_role = 'super_admin' or p.department = v_dept or p.department is null
   order by p.created_at desc;
end;
$function$;

revoke all on function public.get_admin_feedback_periods() from public, anon;
grant execute on function public.get_admin_feedback_periods() to authenticated, service_role;
