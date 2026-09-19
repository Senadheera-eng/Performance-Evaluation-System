-- create_ai_assistant_usage_log
-- Applied 20260719061401
-- Exported from the live project; do not edit by hand.

-- Tracks LLM-tier calls (the Gemini escalation path) so the shared free-tier
-- daily quota (1,500 requests/day across the whole project) can't be
-- exhausted by one student. The Edge Function checks today's row count
-- before calling Gemini and refuses gracefully once near the cap. Written
-- via the service-role client inside the Edge Function (bypasses RLS by
-- design — this is an internal accounting table, not user-facing data).
create table public.ai_assistant_usage_log (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.students(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.ai_assistant_usage_log enable row level security;

-- No client-side access at all — only the Edge Function's service-role
-- client (which bypasses RLS) reads/writes this. dept_admin can view it
-- for monitoring.
create policy ai_usage_log_admin_read
  on public.ai_assistant_usage_log
  for select
  using (get_my_role() = 'dept_admin');

create index ai_assistant_usage_log_created_at_idx
  on public.ai_assistant_usage_log (created_at);
