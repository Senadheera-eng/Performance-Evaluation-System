---
kicker: Study Guide 7 of 7
title: Configuration and Operations
subtitle: Every setting, where it lives, and how to run the system
intro: Where PES is configured, what each setting and secret does, how a change reaches the live site and the live database, how the nightly job runs, which scripts are still useful, how to check that everything is healthy, and what must be done before students are given it. No secret values appear here — only their names and where to set them.
updated: Updated 30 October 2026  ·  describes the live project and the feature/UI branch on that date  ·  first written 30 October 2026
footer: PES Study Guide
---

# 1. Where things are configured

PES is configured in six places. Knowing which setting lives where saves most of the confusion.

<!-- widths: 26,74 -->
| Place | What is set there |
|---|---|
| `pes_app/.env.local` (your machine) and the Vercel project | The two values the browser needs: the Supabase project URL and its public (anon) key. |
| The Supabase project | Auth, storage buckets, Realtime, extensions, the database itself, and the Edge Functions with their secrets. |
| The Supabase Vault | Three secrets the nightly database job presents to an Edge Function. |
| The `system_settings` table | The academic rules (Guide 2, section 13). Changed by an UPDATE, not a deploy. |
| `vercel.json` (in the repository) | Which branches deploy, the single-page rewrite, and caching. |
| A faculty machine (optional) | The open model the assistant can use, under Ollama (`docs/local-llm.md`). |

# 2. The Supabase project

<!-- widths: 30,70 -->
| Property | Value |
|---|---|
| Name | pes-faculty-engineering |
| Reference | `cktbxkxhthoqeyvzspav` (the subdomain of its URL) |
| Region | ap-southeast-1 (Singapore), the closest to Sri Lanka |
| Database | PostgreSQL 17 |
| Created | 11 May 2026 |

## 2.1 Auth

- **Email and password only.** There is no self-registration: the migration `remove_student_self_registration` (July 2026) removed it, and every account is made by the super admin (Guide 3, section 8).
- **Password emails come from PES, not from Supabase.** Invitations and resets are sent by the `account` Edge Function through Resend, with links to `PES_APP_URL`. Supabase Auth's own email templates are not used for them.
- **A deactivated account is banned** in Auth by the `account` function, besides being refused by the database.
- **Leaked-password protection is off.** It checks new passwords against known breaches and needs the Pro plan. Turn it on before release.

## 2.2 Storage

<!-- widths: 26,12,62 -->
| Bucket | Public | Limits |
|---|---|---|
| avatars | yes | none set in the bucket; the app refuses a photo over 2 MB, and each person may write only their own path (`avatars/<their id>`) |
| medical-certificates | no | none set |
| mentor-attachments | no | 10 MB; images, PDF, text, CSV, Word, Excel, PowerPoint, ZIP |
| notice-attachments | no | 20 MB; PDF, images, Word, Excel, CSV, text |

Access to every file is decided by the 13 policies on `storage.objects` (Guide 4, section 3).

## 2.3 Realtime, extensions, the Vault

- **Realtime** publishes three tables: `mentor_messages`, `notifications`, `attendance`.
- **Extensions:** vector, pg_cron, pg_net, supabase_vault, pgcrypto, uuid-ossp, pg_stat_statements (Guide 2, section 15.2).
- **The Vault** holds `project_url`, `anon_key` and `faculty_site_sync_key`, which the nightly job reads (section 5). The sync key was generated inside the database when the job was created; nobody needs to know it.

# 3. The Edge Functions and their secrets

Four functions, in `supabase/functions/`, written in TypeScript for Deno. Supabase gives every function `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` automatically; everything else is a secret you set.

<!-- widths: 22,16,62 -->
| Function | Verifies the sign-in token | What it is for |
|---|---|---|
| ai-assistant | yes | The assistant (Guide 5, section 9; the AI guides). |
| faculty-site-sync | yes | Reads eng.sjp.ac.lk into the database, nightly or on demand. |
| manage-batches | yes | Creates and deletes students' sign-in accounts for a batch. |
| account | no — it serves people who cannot sign in | Invitations, password resets, deactivation; its admin actions check the token themselves. |

## 3.1 The secrets

<!-- widths: 30,18,52 -->
| Secret | Used by | What it sets |
|---|---|---|
| `GEMINI_API_KEYS` | ai-assistant | Comma-separated Gemini keys, tried in turn. `GEMINI_API_KEY` (one key) still works. |
| `GEMINI_MODEL` | ai-assistant | Overrides the Gemini model name. |
| `LOCAL_LLM_URL` | ai-assistant | The faculty model's OpenAI-compatible address. Unset means Gemini only. |
| `LOCAL_LLM_MODEL` | ai-assistant | Its model name; default `qwen2.5:3b`. |
| `LOCAL_LLM_API_KEY` | ai-assistant | A key for that server, if it asks for one. |
| `LOCAL_LLM_PROFILE` | ai-assistant | `small` (default, for a CPU) or `full` (a 7B+ model on a GPU). |
| `AI_PROVIDERS` | ai-assistant | The order to try: `local,gemini` (default), `gemini,local` or `local`. |
| `AI_DAILY_QUOTA` | ai-assistant | Faculty-wide questions per day; default 5,000. |
| `AI_PER_STUDENT_DAILY` | ai-assistant | One student's questions per day; default 1,000. |
| `AI_DEADLINE_MS` | ai-assistant | How long one question may take; default 60,000, capped at 140,000. |
| `RESEND_API_KEY` | account | The Resend key that sends the emails. |
| `PES_EMAIL_FROM` | account | The sender, on a domain verified in Resend. |
| `PES_APP_URL` | account | The app's address. Every emailed link points here and nowhere else. |

Secrets are set in the Supabase dashboard (Edge Functions → Secrets) or with the CLI:

```
supabase secrets set AI_PER_STUDENT_DAILY=40 --project-ref cktbxkxhthoqeyvzspav
supabase secrets list --project-ref cktbxkxhthoqeyvzspav     # names only
```

A changed secret takes effect on the next request; nothing needs redeploying.

## 3.2 Deploying a function

```
supabase functions deploy ai-assistant --project-ref cktbxkxhthoqeyvzspav
supabase functions deploy account --no-verify-jwt --project-ref cktbxkxhthoqeyvzspav
```

`account` must keep `--no-verify-jwt`, or a person who cannot sign in could never reset their password; the other three keep the default. Each function's code is in the repository, so the repository is the source of truth: deploy from a clean checkout of the branch that is live.

## 3.3 Is the assistant healthy?

The assistant has an operator health check that reports which configured models and keys actually answer, and a fingerprint of the instructions it is running. It only answers a request made with the service-role key, with the body `{ "diagnose": true }`; the AI guide (section 12.1) shows the call.

# 4. The front end

## 4.1 The two variables

```
VITE_SUPABASE_URL=https://cktbxkxhthoqeyvzspav.supabase.co
VITE_SUPABASE_ANON_KEY=<the project's anon / publishable key>
```

They go in `pes_app/.env.local` on your machine (never committed) and in the Vercel project's environment variables for the live site. The anon key is public by design — it is in every browser that opens PES — which is exactly why every rule lives in the database.

## 4.2 Running it on your machine

```
cd pes_app
npm install
npm run dev          # http://localhost:5173
npm run typecheck    # must print nothing
npm run build        # the production build, into dist/
```

You need Node.js 18 or newer. The dev server talks to the live Supabase project — there is no separate test database — so sign in with a test account and remember that anything you save is real.

## 4.3 How the live site is built

Vercel watches the GitHub repository. On a push to `main` it runs `npm run build` and publishes `dist/` as the live site. `vercel.json` turns deployments off for `dev` and `claude/*`; other branches, `feature/UI` among them, can get preview deployments, which are not the live site.

<!-- widths: 30,70 -->
| vercel.json rule | Why |
|---|---|
| Every path rewrites to `/index.html` | It is a single-page app: `/app/results` is a route in React, not a file. |
| `/assets/*` cached for a year, immutable | Their names change whenever their contents do, so they never go stale. |
| `/index.html` never cached | So a deploy is picked up on the next load. A tab already open can still hold old chunk names; `routes.tsx` reloads it once when that happens (Guide 6, section 3.1). |

# 5. The nightly job

One scheduled job keeps the assistant's copy of the faculty website current.

```
job:      faculty-site-sync-nightly
schedule: 37 20 * * *          (20:37 UTC = 02:07 in Sri Lanka)
does:     net.http_post(project_url || '/functions/v1/faculty-site-sync',
                        headers: Bearer anon_key, x-sync-key: faculty_site_sync_key)
```

The function reads a round of pages — those never read first, then the stalest — within its time budget, and the next run carries on where it stopped. The super admin can also start a round with the Refresh button on the dashboard's website card, which shows when the site was last read.

To check it ran, in the SQL editor:

```
select d.start_time, d.status, d.return_message
  from cron.job_run_details d
  join cron.job j on j.jobid = d.jobid
 where j.jobname = 'faculty-site-sync-nightly'
 order by d.start_time desc limit 5;

select max(fetched_at) from public.faculty_site_pages;   -- last page read
```

On 30 October 2026 it had run 30 times; the last run, the night before, succeeded and read pages within seconds.

# 6. The database

## 6.1 Making a change

1. Write the change as SQL with a comment header that says why — the files are read later as the history of every decision.
1. Apply it to the live project as a migration (the Supabase dashboard, the CLI's `supabase db push`, or `supabase migration` tooling), so it is recorded in `supabase_migrations.schema_migrations` with a version.
1. Save the same SQL as `supabase/migrations/<version>_<name>.sql`, with the version the live history recorded, and add its line at the end of `supabase/migrations/README.md`.
1. Prove any rule it changes with the recipe in Guide 4, section 6, and run the counting query in Guide 4, section 6.2.

`pes_app/export_migrations.cjs` writes the live history out as files (it needs the service-role key in `.env.local`), which is how the folder was first filled and how it can be checked against the live database.

## 6.2 A full copy of the schema

The very first tables predate the migration history, so the folder cannot rebuild the database from empty. A complete schema comes from a dump, made from a machine with the database password:

```
supabase db dump --db-url "postgresql://postgres:<password>@db.cktbxkxhthoqeyvzspav.supabase.co:5432/postgres" \
  -f supabase/schema.sql
```

## 6.3 Changing a rule

An academic rule in `system_settings` is changed with one UPDATE and takes effect at once, everywhere that reads it:

```
update public.system_settings
   set value = '5'::jsonb, updated_at = now()
 where key = 'feedback_min_responses_for_analytics';
```

Check Guide 2, section 13 first: four settings are not read by anything yet, and changing them changes nothing.

# 7. The scripts in the repository

<!-- widths: 36,64 -->
| Script | Status |
|---|---|
| `pes_app/export_migrations.cjs` | Still useful: writes the live migration history to `supabase/migrations/`. |
| `pes_app/create_auth_users.cjs`, `create_lecturer_auth_users.cjs`, `pes-scripts/create_missing_ce_students.cjs` | Superseded by the Users and Batches pages. Kept as a record of how the first accounts were made. |
| `pes_app/sync_ids.cjs`, `reset_password.cjs` | One-off repairs from July 2026. Do not run. |
| `pes-scripts/rag/` | The Handbook pipeline: extract the text (`extract_handbook.py`), cut and embed it (`chunk_and_embed_v2.mjs`), load it (`reload_chunks_v2.mjs`), and measure the search (`benchmark_retrieval.mjs`). Run again only if the Handbook changes. |
| `pes-scripts/intent/` | The old question classifier the assistant no longer uses. |
| `docs/parse_handbook_curriculum.py` | Read the curriculum tables out of the Handbook into `docs/handbook_curriculum_extract.tsv`, the source of `curriculum_slots`. |
| `docs/source/build_guides.py` | Builds these guides from their Markdown sources (section 10). |

# 8. Branches and commits

<!-- widths: 20,80 -->
| Branch | Use |
|---|---|
| `dev` | Day-to-day work. Deploys nothing. |
| `main` | Production. `dev` is merged into it when ready; Vercel publishes it. |
| `feature/UI` | The October 2026 redesign, tested locally before it is merged. |
| `claude/*` | Automated working branches; no deployments. |

The repository's `CLAUDE.md` asks that commits be authored as the repository owner, with the committer recorded separately, so GitHub shows the owner as the author.

# 9. Keeping an eye on it

<!-- widths: 30,70 -->
| Check | How |
|---|---|
| Security and performance advisors | Supabase dashboard → Advisors. Expect the notes in Guide 4, section 7; anything new is worth reading. |
| Who can call what | The counting query in Guide 4, section 6.2. The first number should be 0. |
| Edge Function errors | Supabase dashboard → Edge Functions → a function → Logs. |
| The nightly website read | Section 5, or the website card on the super admin's dashboard. |
| The assistant | The health check (section 3.3), and `ai_assistant_usage_log` for how much it is used. |
| Build health | `npm run typecheck` and `npm run build` on the branch before any merge. |

# 10. The guides themselves

The guides in `docs/` are built from Markdown files in `docs/source/`, one per guide, which read well on GitHub too. To change a guide, edit its Markdown and rebuild:

```
python3 docs/source/build_guides.py               # every guide
python3 docs/source/build_guides.py 2_database    # one guide
```

The build needs only Python 3. Its header comment lists the small Markdown dialect it understands (headings, lists, tables, notes, the "why" and warning boxes, code). Keep the "Updated" line on a guide's title page honest.

# 11. Before students are given PES

<!-- widths: 42,58 -->
| Item | Do |
|---|---|
| Feedback threshold | Set `feedback_min_responses_for_analytics` back to 5 (it is 1 for testing). |
| Leaked-password protection | Turn on in Supabase Auth (needs the Pro plan). |
| The assistant's limits | Set `AI_DAILY_QUOTA` and `AI_PER_STUDENT_DAILY` to faculty-sized values. |
| The assistant's model | Configure the faculty's own model, a paid Gemini key, or several keys; the free tier answers only a few questions a day. |
| Five trigger functions callable by anon | Revoke EXECUTE on them (Guide 4, section 5.10), then run the count again. |
| Four settings that do nothing | Wire up or delete them (Guide 2, section 13), so nobody changes one expecting an effect. |
| Email | Confirm `PES_APP_URL` is the live address and `PES_EMAIL_FROM`'s domain is verified in Resend; send yourself an invitation and a reset. |
| The redesign | Merge `feature/UI` into `dev` and then `main` once tested. |
| Test data | Remove test feedback answers, test notices and test accounts made during development. |
| Backups | Confirm the project's backup schedule on its plan, and keep a schema dump (section 6.2). |
