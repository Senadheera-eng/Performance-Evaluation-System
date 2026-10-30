---
kicker: Study Guide 4 of 7
title: Security and Row Level Security
subtitle: How the database refuses what it should refuse
intro: Because the browser talks straight to the database, the database has to be the gate. This guide explains how that gate is built, who can see what, how the four Edge Functions guard themselves, what was found wrong in the September 2026 review and since, and how you can test any rule yourself.
updated: Updated 30 October 2026  ·  figures from the live database on that date  ·  first written 10 September 2026
footer: PES Study Guide
---

# 1. The one idea everything rests on

The PES has no backend server. The browser sends queries to PostgreSQL directly. So there is no place in between where you could put a permission check.

:::warn THEREFORE
The database must refuse by itself. Not the React page, not the router, not the menu. If a rule is not written into the database, it does not exist — it is only a suggestion that the browser happens to follow.
:::

PostgreSQL has a feature for exactly this, called Row Level Security, usually shortened to RLS.

## 1.1 What Row Level Security actually does

Normally a table gives every row to anyone who may read the table. RLS changes that. Once RLS is switched on, the table returns nothing at all unless a policy says a particular row may be returned.

A policy is a small piece of SQL attached to a table. Here is a real one:

```
create policy attendance_student_read on public.attendance
  for select to authenticated
  using (student_id = (select auth.uid()));
```

Read it as a sentence: for a signed-in user selecting from the attendance table, allow a row only when its student_id is the same as the caller's own id.

- **for select** — this policy covers reading. Writing needs its own.
- **to authenticated** — it applies to signed-in users. A visitor who is not signed in gets nothing.
- **using (...)** — the test. True means the row is visible; anything else means it is not.
- **auth.uid()** — the id from the caller's signed token. It cannot be faked; it is read from the token the database verified.

## 1.2 Deny by default

A student running SELECT * FROM attendance does not get an error. They get their own rows and nothing else. There is no way to ask for more, because the filter is applied inside the database before the answer is built.

All 49 tables have RLS switched on, with no exceptions, held by 117 policies (and 13 more on stored files). Five tables have RLS on and no policy at all — the three account tables and the two faculty-website tables — which means nobody can read them through the API. The account tables are touched only by server code with the service role; the website is read only through `search_faculty_site()` and `get_faculty_site_status()`. The dated backup tables that used to be the exceptions were dropped on 27 September 2026.

# 2. Who can see what

This is the access model the system is meant to enforce. Every line here is enforced in the database, not in the browser.

## 2.1 Students

<!-- widths: 30,70 -->
| Data | What a student may reach |
|---|---|
| Their own record | Read, and update a small number of profile fields. |
| Any other student | Nothing at all. |
| Their results | Only after the department publishes them. |
| Their attendance | Their own rows only. |
| Their enrolments | Their own rows only, and only insertable while a window is open. |
| The course catalogue | Readable, because every student must browse it to choose electives. |
| Their mentor | Name and contact, plus their own side of the chat. Never the mentor's private notes. |
| Their medical certificates | Their own submissions and files only. |
| Their planner scenarios and aim | Their own rows only; at most ten scenarios. |
| Their minor choice | Their own, set through `set_my_minor()`. |
| The account tables | Nothing — not even their own link or log rows. |

## 2.2 Lecturers

<!-- widths: 30,70 -->
| Data | What a lecturer may reach |
|---|---|
| Their assigned offerings | Full access — roster, attendance, marks. |
| Offerings they do not teach | Nothing. |
| Result editing | Only while the marks are still in draft. After submission the row is locked to them. |
| Their mentees | Academic overview, chat, their own private notes, and a planner scenario only if the student shared it. |
| Other lecturers' rows | Only their own, since 9 September 2026. |
| Feedback about themselves | Only aggregated, and only once the minimum response count exists (see section 4). |

The result-editing rule is worth reading in the policy itself, because the third condition is the interesting one:

```
create policy results_lecturer_update on public.results
  for update to authenticated
  using (
    (select my_lecturer_id()) is not null
    and is_assigned_lecturer(offering_id)
    and status = 'draft'
  );
```

## 2.3 Heads of department

An HOD reads everything in their own department: results, attendance, students, feedback. Together with the department admin, they are the ones who publish results or return a sheet for correction. Approving a lecturer's feedback round is the department admin's alone.

```
create policy results_hod_read on public.results
  for select to authenticated
  using (
    (select my_lecturer_id()) is not null
    and is_active_hod_of(offering_department(offering_id))
  );
```

## 2.4 Department admins and super admins

A department admin is limited by `get_my_department()`. A super admin has faculty-wide access with a single simple test.

```
-- department admin: their own department's courses only
using (
  (select get_my_role()) = 'dept_admin'
  and course_id in (
    select c.id from courses c
     where c.department = (select get_my_department())
  )
)

-- super admin
using ((select get_my_role()) = 'super_admin')
```

Some things are the super admin's alone, and each is checked by name rather than inferred from 'can see everything': enrolment windows, heads of department, batches, and accounts. The last two run on Edge Functions with the service role, so their check is in the function (section 3A).

> There is one deliberate special case. The Interdisciplinary Studies admin can see students from any department, but only those who are actually linked to an interdisciplinary module. That is what students_is_admin_read does.

# 3. Files

Uploaded files sit in Supabase Storage, which is itself protected by RLS on a table called storage.objects.

<!-- widths: 27,10,63 -->
| Bucket | Public? | Who may read a file |
|---|---|---|
| avatars | Yes | Anyone. A profile picture is not private. |
| medical-certificates | No | The student who owns it, a super admin, or a department admin whose department has a module named on the submission. |
| mentor-attachments | No | Only the two people in that mentoring thread. |
| notice-attachments | No | Whoever may read the notice the document is attached to. |

The rule for medical certificates works from the folder name. Files are stored under a folder named after the student's id, so the policy can compare that folder to the caller.

```
(storage.foldername(name))[1] = auth.uid()::text
  or get_my_role() = 'super_admin'
  or (get_my_role() = 'dept_admin' and ...department check...)
```

Mentor attachments use the same idea with the assignment id as the folder, and the check is a single function call:

```
bucket_id = 'mentor-attachments'
  and is_mentor_thread_participant(
        (storage.foldername(name))[1]::uuid
      )
```

> A deletion rule adds one more condition: an attachment can only be removed while no message still refers to it. This stops a chat history pointing at a file that no longer exists.

# 3A. The Edge Functions are gates too

Four pieces of server code run beside the database. Three of them use the service-role key, which ignores Row Level Security entirely — so for them, the function's own check is the only gate, and it is written first.

<!-- widths: 20,14,66 -->
| Function | Sign-in required? | Who it lets in, and how it checks |
|---|---|---|
| ai-assistant | Yes | Any signed-in student. It runs every tool through the caller's own token, never the service role, so RLS decides what each tool may read. Its health check answers operators only. |
| faculty-site-sync | Yes | The super admin (the dashboard's Refresh button), the service role, or the nightly schedule, which presents a key kept in the Vault and checked by `faculty_site_sync_key_ok()`. It reads only the faculty's own website and follows robots.txt. |
| manage-batches | Yes | The super admin only, checked from the caller's token before anything else. Then the service role creates or deletes accounts. |
| account | No (it must serve people who cannot sign in) | Three public actions — request a reset, check a link, set a password from a link — each rate limited and answering the same whether or not an account exists. Every other action checks that the caller's token belongs to the active super admin. |

:::warn THE RULE FOR SERVER CODE WITH THE SERVICE ROLE
The service role can do anything, so a function holding it must decide who the caller is from their verified token before it touches the database, must never take an address or an id it will act on from the request without checking it, and must hand back only what that caller is entitled to. The account function's links always point at the configured app address (PES_APP_URL), never one taken from the request, so a reset email cannot be made to point elsewhere.
:::

## 3A.1 Deactivation is enforced in the database

Switching an account off (Guide 3, section 8.3) is a security control, not only an interface one. `account_is_active()` sits at the start of `get_my_role()`, `is_super_admin()` and `my_lecturer_id()`, so from the moment the row is written every policy and function treats the account as nobody, whatever token its browser still holds. Supabase Auth also bans the sign-in, and the app signs the browser out within minutes.

# 4. Feedback privacy

Feedback needs stronger protection than most data, because the harm from getting it wrong is a student being identified as the author of a criticism.

Three separate mechanisms protect it.

1. **The anonymous flag.** A submission marked anonymous is never joined back to the student in any report.
1. **The response threshold.** The setting feedback_min_responses_for_analytics is 5 in the Faculty rule (it is 1 while PES is tested by one developer, and goes back to 5 before release). Below that many responses, nobody may see the analytics at all — not the lecturer, not the head of department. A class of three cannot be de-anonymised by arithmetic.
1. **Separate functions for ratings and comments.** Free-text comments come from a different function than the numbers, so releasing one does not release the other.

:::why WHY THE THRESHOLD IS THE IMPORTANT ONE
Anonymity is not just about removing a name. If only two people answered and one said the module was badly organised, the lecturer can often work out who. A minimum response count is the only real defence against that, and it has to be enforced in the database rather than left to a report writer to remember.
:::

# 5. What the September 2026 review found

A full security review was carried out on 9 September 2026. Seven issues were found and fixed. They are recorded here because the reasoning is more useful than the fixes.

## 5.1 Guards that failed open

Several privileged functions checked the caller like this: `if get_my_role() <> 'super_admin' then raise ...`.

In PostgreSQL, `NULL <> 'super_admin'` evaluates to NULL, not to true. So when the role came back as NULL, the exception never fired and the function did the privileged work anyway.

Fixed by making `get_my_role()` return empty text instead of NULL, and wrapping the remaining comparisons in `coalesce(...)`.

## 5.2 Functions callable by anyone

PostgreSQL grants EXECUTE on every new function to PUBLIC by default, and PUBLIC includes the anonymous, not-signed-in role. Combined with the previous issue, an anonymous caller could reach privileged functions.

Fixed by revoking execute from PUBLIC and anon across every function, re-granting only where it had genuinely been held, and then changing the default so new functions do not repeat the mistake:

```
alter default privileges in schema public
  revoke execute on functions from public;
```

## 5.3 A cross-role data leak

A lecturer could read all 167 student rows rather than only the students they taught. This was proved by running the real query as a real lecturer, then proved closed the same way.

## 5.4 Three tables readable before signing in

Three policies were written `to public` rather than `to authenticated`, so a visitor with no account could read them. Corrected, and write permissions were revoked from the anonymous role across every table.

## 5.5 A feedback table that accepted forged rows

A legacy insert policy did not check that the student_id being written matched the caller, so a signed-in user could insert feedback attributed to somebody else. Replaced with a policy that checks it.

## 5.6 The lecturers table

The read policy was `using (true)`, so every signed-in user — including every student — could read all 41 staff rows with every column, including `auth_user_id`, the identifier the whole security model compares against. Narrowed to the caller's own row on 9 September 2026.

## 5.7 Results were readable through an unguarded view

The `my_published_results` view did not have the security_barrier option set, which in some cases lets a cleverly written query see rows the view was meant to filter. The option was set, and the search path was pinned on three functions that had been left unpinned.

## 5.8 The results, in numbers

<!-- widths: 40,27,34 -->
| Check | Before | After |
|---|---|---|
| Student can read lecturer rows | 41 | 0 |
| Lecturer can read student rows | 167 | only their own students |
| Tables readable when signed out | 3 | 0 |
| Functions callable by anonymous callers | many | 0 |
| RLS query time on a large results read | 1,014 ms | 220 ms |
| Pages of data read for that query | 96,768 | 710 |

> The last two lines are a performance result, not a security one, but they came from the same work. Rewriting the policies so the caller's identity is decided once per query instead of once per row made the query 136 times cheaper in pages read, with identical output.

## 5.9 A follow-up on 27 September 2026

The Supabase security advisor, run against the live project, showed that the fix in 5.2 had not held. Thirty-seven SECURITY DEFINER functions were callable by the anonymous role again — every one of them written after 9 September: the notice board, notifications, the grade-point and repeat triggers.

The reason is a lesson in its own right. Revoking EXECUTE from PUBLIC only removes the grant to PUBLIC. Supabase's own default privileges for the postgres role grant EXECUTE to anon, authenticated and service_role by name, so every new function still arrived with an explicit anon grant that the PUBLIC revoke never touched. The guards inside those functions all failed closed, so nothing leaked, but the door was open.

The fix, in a_signed_out_caller_calls_nothing, removes EXECUTE from anon on every function the application owns, keeps exactly what signed-in users already had, removes it from trigger functions altogether (a trigger fires regardless of the caller's EXECUTE privilege), and changes the default by name:

```
alter default privileges for role postgres in schema public
  revoke execute on functions from anon;
```

The same day, the eleven dated backup tables were dropped (one had Row Level Security off), two functions that still resolved names through the caller's search_path were pinned, and the pgvector extension was moved from the public schema into extensions so its hundred-odd functions are no longer exposed beside the application's. After the change the anonymous role could call 0 functions and signed-in users could still call every one of the application's 169 functions they could call before, proved by counting both before and after, and by calling a function as anon and getting "permission denied".

## 5.10 Where things stand on 30 October 2026

The same counts, taken again for this edition: 248 application functions, 194 callable by signed-in users, every SECURITY DEFINER function with its search path pinned — and **5 callable by the anonymous role**. All five are trigger functions added in October: `check_course_graded_with`, `courses_default_result_credits`, `refresh_result_credits` and `results_refuse_ungraded_part` (two-semester courses) and `planner_scenarios_guard` (saved scenarios). They arrived with Supabase's default grant again, despite the default being changed by name in September.

They are harmless as they stand: PostgreSQL refuses to run a trigger function except as a trigger, so calling one through the API only returns an error. But they break the rule this section exists for, and the fact that the default did not hold for them is worth knowing. The tidy-up is one migration that revokes EXECUTE on the five from anon (and, like the other triggers, from authenticated), followed by the count in section 6 run again.

# 6. How to test a rule yourself

You do not have to trust any of the above. You can check any policy directly, safely, without changing anything.

The trick is to run inside a transaction, pretend to be a particular user, measure, and then roll back.

```
begin;

-- become a signed-in user with this id
set local role authenticated;
set local request.jwt.claims to
  '{"sub":"<the user id>","role":"authenticated"}';

-- now ask the question as them
select count(*) from public.lecturers;

reset role;
rollback;   -- nothing was changed
```

## 6.1 Testing a change before you keep it

The same technique can prove a policy change is safe before you commit to it. Apply the change inside the transaction, measure every role, then roll back.

```
begin;
  -- measure the old behaviour as each role
  -- apply the new policy
  -- measure the new behaviour as each role
  -- compare
rollback;
```

:::warn TEST THE FAILURE, NOT ONLY THE SUCCESS
When a probe returns nothing, do not assume the rule worked. Run the same probe against the unchanged policy first. During this review one test returned 'nothing found' and looked like a broken feature — it was actually a mistyped query path, proved by running it both ways and getting the same empty answer.
:::

## 6.2 Counting who can call what

The September and October findings were both found by counting. This query is safe to run at any time; it changes nothing.

```
select
  count(*) filter (where has_function_privilege('anon', p.oid, 'execute'))
    as signed_out_can_call,
  count(*) filter (where has_function_privilege('authenticated', p.oid, 'execute'))
    as signed_in_can_call
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
left join pg_depend d on d.objid = p.oid and d.deptype = 'e'
where n.nspname = 'public' and d.objid is null;   -- the app's own functions
```

On 30 October 2026 it returns 5 and 194 (section 5.10). The answer to aim for in the first column is 0.

# 7. Things deliberately left alone

A review is only honest if it says what it chose not to change. These were examined and left, with reasons.

<!-- widths: 33,67 -->
| Item | Why it was left |
|---|---|
| 40 foreign keys without indexes | Almost all are audit columns on tables with fewer than 100 rows. An index would cost more than it saves. |
| A 3 ms course join | Not a bottleneck at 230 courses. Optimising it would add complexity for no measurable gain. |
| Long lists are not virtualised | The largest realistic list is 230 rows. React handles that comfortably; virtualisation would break Ctrl-F and add a dependency. |
| my_published_results stays SECURITY DEFINER | Making it run as the caller would break the student Results page, which is the only thing it exists for. |
| R, F and L grades count as 0 in the GPA | Confirmed as intended behaviour under the Faculty Handbook. |
| Four mentor policies apply to PUBLIC not authenticated | Not a leak — an anonymous caller has no id, so every branch fails. Inconsistent, but harmless. |
| Leaked-password protection is off | A Supabase Auth setting that checks passwords against known breaches. It needs the Pro plan; switch it on before release. |
| 185 SECURITY DEFINER functions callable by signed-in users | The advisor lists them as a warning, but they are the application's API: the screens call them. Each one checks its caller. |
| Account tables with RLS on and no policies | Intended: the advisor notes it, but it is exactly how a table is made readable to server code only. |

# 8. Rules to follow when adding a feature

1. Switch RLS on for any new table, before you put data in it.
1. Write policies for every command you need — select, insert, update and delete are separate.
1. Write them to authenticated, not to public, unless you truly mean anonymous visitors.
1. In a SECURITY DEFINER function, check the caller's role yourself, and make the check fail closed.
1. Revoke execute from public and anon on any new function, triggers included. The default is meant to do this, but check with `has_function_privilege('anon', ...)` rather than trusting it: sections 5.9 and 5.10 are what happened the last two times a default was trusted.
1. Never rely on a check that only exists in the React code.
1. In an Edge Function, decide who the caller is from their verified token before anything else; use the caller's own token for reads wherever you can, and the service role only for what truly needs it.
1. Prove the rule with the transaction recipe in section 6 — measure both the allowed case and the refused one.

> Rule 4 is the one that has caused real problems in this system twice. A guard that cannot answer the question must refuse.
