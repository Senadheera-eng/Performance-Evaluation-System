-- fix_lecturer_period_lifecycle_after_approval
-- Applied 20260808204755
-- Exported from the live project; do not edit by hand.

-- Two defects in the lecturer-created feedback period lifecycle.
--
-- 1. The update policy required approval_status IN ('pending','rejected'),
--    so the moment a department admin approved a form its own author could
--    no longer touch it — including to open it. Approval is meant to unlock
--    opening, and instead it locked the row.
--
-- 2. The course and question policies gated only on status = 'draft'. An
--    approved period stays draft until it is opened, so a lecturer could
--    add courses and questions *after* approval and open a form the
--    department never reviewed.

drop policy if exists fp_lecturer_update_own on public.feedback_periods;
create policy fp_lecturer_update_own on public.feedback_periods
  for update to authenticated
  using      (created_by_lecturer_id = my_lecturer_id()
              and status in ('draft', 'scheduled', 'open', 'closed'))
  with check (created_by_lecturer_id = my_lecturer_id());

-- Content may only change while the form is still being written. Once
-- approved, what was reviewed is what runs.
drop policy if exists fpc_lecturer_manage on public.feedback_period_courses;
create policy fpc_lecturer_manage on public.feedback_period_courses
  for all to authenticated
  using (
    exists (select 1 from public.feedback_periods p
             where p.id = feedback_period_courses.feedback_period_id
               and p.created_by_lecturer_id = my_lecturer_id()
               and p.status = 'draft'
               and p.approval_status in ('pending', 'rejected'))
    and exists (select 1 from public.course_lecturers cl
                  join public.course_offerings o on o.id = cl.offering_id
                 where cl.lecturer_id = my_lecturer_id() and cl.is_active
                   and o.course_id = feedback_period_courses.course_id)
  )
  with check (
    exists (select 1 from public.feedback_periods p
             where p.id = feedback_period_courses.feedback_period_id
               and p.created_by_lecturer_id = my_lecturer_id()
               and p.status = 'draft'
               and p.approval_status in ('pending', 'rejected'))
    and exists (select 1 from public.course_lecturers cl
                  join public.course_offerings o on o.id = cl.offering_id
                 where cl.lecturer_id = my_lecturer_id() and cl.is_active
                   and o.course_id = feedback_period_courses.course_id)
  );

drop policy if exists fpq_lecturer_manage on public.feedback_period_questions;
create policy fpq_lecturer_manage on public.feedback_period_questions
  for all to authenticated
  using (exists (select 1 from public.feedback_periods p
                  where p.id = feedback_period_questions.feedback_period_id
                    and p.created_by_lecturer_id = my_lecturer_id()
                    and p.status = 'draft'
                    and p.approval_status in ('pending', 'rejected')))
  with check (exists (select 1 from public.feedback_periods p
                       where p.id = feedback_period_questions.feedback_period_id
                         and p.created_by_lecturer_id = my_lecturer_id()
                         and p.status = 'draft'
                         and p.approval_status in ('pending', 'rejected')));

-- With the update policy widened, the columns a lecturer must not move are
-- pinned on the row instead. The approval verdict is never theirs, and once
-- approved neither is the content the department signed off — only the
-- status may still move, which is how they open and close their own form.
create or replace function public.protect_lecturer_feedback_period()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if old.created_by_lecturer_id is not null
     and old.created_by_lecturer_id = public.my_lecturer_id() then

    new.approval_status        := old.approval_status;
    new.approved_by            := old.approved_by;
    new.approved_at            := old.approved_at;
    new.approval_notes         := old.approval_notes;
    new.created_by_lecturer_id := old.created_by_lecturer_id;
    new.department             := old.department;

    if old.approval_status = 'approved' then
      new.title         := old.title;
      new.academic_year := old.academic_year;
      new.semester      := old.semester;
      new.batch_year    := old.batch_year;
      new.opens_at      := old.opens_at;
      new.closes_at     := old.closes_at;
      new.feedback_type := old.feedback_type;
      new.allow_editing := old.allow_editing;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists feedback_periods_lecturer_guard on public.feedback_periods;
create trigger feedback_periods_lecturer_guard
  before update on public.feedback_periods
  for each row execute function public.protect_lecturer_feedback_period();

revoke execute on function public.protect_lecturer_feedback_period() from public, anon, authenticated;
