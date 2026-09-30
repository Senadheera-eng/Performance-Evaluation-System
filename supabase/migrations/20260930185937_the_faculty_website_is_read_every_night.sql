-- The faculty website is read again every night, so the assistant hears of a
-- new notice the day after it is posted.
--
-- pg_cron starts the round; pg_net calls the faculty-site-sync function. The
-- call proves itself with a key only the vault holds: the function asks
-- faculty_site_sync_key_ok, which only the service role may call.
--
-- The call also needs the project's address and its anon key (both public)
-- in the vault as `project_url` and `anon_key`. They differ per project, so
-- they are set outside this migration:
--   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
--   select vault.create_secret('<anon key>', 'anon_key');
-- Without them the job runs and does nothing.

create extension if not exists pg_cron;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'faculty_site_sync_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'faculty_site_sync_key',
      'Lets the nightly schedule run faculty-site-sync'
    );
  end if;
end $$;

create or replace function public.faculty_site_sync_key_ok(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_key, '') <> '' and exists (
    select 1 from vault.decrypted_secrets
    where name = 'faculty_site_sync_key' and decrypted_secret = p_key
  );
$$;

revoke all on function public.faculty_site_sync_key_ok(text) from public, anon, authenticated;
grant execute on function public.faculty_site_sync_key_ok(text) to service_role;

-- 02:07 in Sri Lanka (20:37 UTC), when nobody is using the site.
select cron.schedule(
  'faculty-site-sync-nightly',
  '37 20 * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
      || '/functions/v1/faculty-site-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key'),
      'x-sync-key', (select decrypted_secret from vault.decrypted_secrets where name = 'faculty_site_sync_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  )
  where exists (select 1 from vault.decrypted_secrets where name = 'project_url')
    and exists (select 1 from vault.decrypted_secrets where name = 'anon_key');
  $job$
);
