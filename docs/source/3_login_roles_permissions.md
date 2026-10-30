---
kicker: Study Guide 3 of 7
title: Login, Roles and Permissions
subtitle: How the system knows who you are and what you may do
intro: Signing in and being allowed to do something are two different questions. This guide follows both, from typing a password to landing in the right portal with the right menu, and then follows an account through its life: invited, set up, reset, and switched off.
updated: Updated 30 October 2026  ·  describes the feature/UI branch on that date  ·  first written 10 September 2026
footer: PES Study Guide
---

# 1. Two different questions

People often say 'login' when they mean two separate things. The PES keeps them apart, and so should you.

<!-- widths: 27,21,52 -->
| Question | Proper name | Who answers it |
|---|---|---|
| Are you really this person? | Authentication | Supabase Auth. It checks the email and password and issues a token. |
| Are you allowed to do this? | Authorisation | The PostgreSQL database, through its own policies and functions. |

:::why WHY THE SPLIT MATTERS
Supabase Auth knows nothing about students, lecturers or departments. It only knows a user id and an email. Every academic meaning attached to that id is decided by the PES database itself. Confusing the two is the fastest way to write an insecure feature.
:::

# 2. Where identity lives

A signed-in person is one of three things, and the PES stores each in its own table.

<!-- widths: 24,35,40 -->
| Table | Which column links to Auth | Role it produces |
|---|---|---|
| admins | id | dept_admin or super_admin |
| lecturers | auth_user_id | lecturer |
| students | id | student |

## 2.1 Why lecturers are different

For students and admins, the table's `id` is the Auth id. For lecturers there are two separate columns: `id` (the lecturer's own identifier) and `auth_user_id` (their login).

The reason is practical. A lecturer needs to exist in the records — assigned to modules, named on results — before they have ever logged in. Keeping the login separate lets the academic record be built first and the account attached later. The column is nullable, and one of the 41 lecturers currently has no login.

## 2.2 The fixed search order

The three tables are always searched in the same order:

```
admins
lecturers
students
```

This order appears in two places: in the browser, inside `AuthContext.tsx`, and in the database, inside `get_my_role()` and `my_lecturer_id()`. In the database the role function looks in admins and then students; a lecturer is in neither, so their role comes back as empty text, and `my_lecturer_id()` is what recognises them. Either way, an admin row wins over anything else, in both places.

:::why WHY THE ORDER MUST BE IDENTICAL IN BOTH PLACES
If the browser decided you were a student and the database decided you were an admin, the two would disagree about what you may see. The interface would show one thing and the data would allow another. Keeping the order the same in both is what makes them impossible to disagree.
:::

# 3. Signing in, step by step

This is what happens when someone presses Sign In. The code is in `src/app/context/AuthContext.tsx`.

1. The browser sends the email and password to Supabase Auth using `signInWithPassword()`. The password never reaches the PES database.
1. Supabase replies with a session containing an access token. The token is signed, so the database can trust it without asking Auth again.
1. The app looks up the profile in admins, then lecturers, then students, stopping at the first match.
1. If the person is a lecturer, one more query runs against hod_appointments to see whether they currently head a department.
1. Everything is normalised into one shape. Whatever table the person came from, the app ends up with the same object: id, name, email, department, role, status.
1. The user is sent to their portal. A student goes to /app, a lecturer to /staff, an admin to /admin.

## 3.1 One normalised profile

Step 5 is worth pausing on. Rather than every page asking 'am I looking at a student or a lecturer?', the app converts all three into one type. Fields that do not apply are set to null rather than left out.

```
// src/lib/types.ts
export type Role = 'student' | 'lecturer' | 'dept_admin' | 'super_admin'

// A lecturer has no batch_year, so it is null - not missing.
// Every consumer keeps working regardless of who signed in.
```

Lecturers get a second object as well, `StaffContext`, holding their lecturer id, their department, their title, and the department they head if any.

## 3.2 A subtle rule inside the auth listener

There is a comment in AuthContext warning not to call the database inside `onAuthStateChange`. This is a real trap: the Supabase client is still processing the authentication response at that moment, and a database call made there deadlocks. The listener only updates React state; the profile is fetched separately afterwards.

## 3.3 Two checks after signing in

**A temporary password must be changed.** A student brought in with a new intake signs in with a temporary password the faculty handed out. Their account carries a `must_change_password` flag, and until they choose their own password the student portal shows nothing but a dialog asking for one (`FirstSignInPassword.tsx`).

**A deactivated account is signed out at once.** Switching an account off bars its sign-in, but a browser that is already signed in still holds a token that stays valid for up to an hour. So the app asks the database, through `my_account_active()`, whether the account is still allowed in: on sign-in, whenever the tab comes back into view, and every five minutes. If not, it signs out and the sign-in page says why (`lib/accountGuard.ts`). The database does not wait for the browser: every role helper refuses a deactivated account from the moment it is switched off (section 7).

# 4. The four roles

<!-- widths: 18,14,68 -->
| Role | Portal | Scope of what they may reach |
|---|---|---|
| student | /app | Only their own record. |
| lecturer | /staff | Modules they are assigned to, students in those modules, and their own mentees. |
| dept_admin | /admin | Everything belonging to their own department. |
| super_admin | /admin | Everything in the faculty. |

## 4.1 Head of Department, again

HOD is not in that list, and that is deliberate. A head of department is a lecturer whose id appears in an active row of hod_appointments.

The effect on the interface is that the staff portal grows extra menu items. The effect on the database is that certain functions and policies start returning more rows for that person. The person's role is still 'lecturer'.

```
// src/lib/staffScope.ts
// HOD is not a role, it is an appointment: hodDepartment being set
// is the only thing that separates a head of department from any
// other lecturer. That is why there is one StaffLayout rather than
// a Lecturer layout and an HOD layout - the navigation grows,
// the identity does not change.
```

# 5. Guarding the routes

## 5.1 ProtectedRoute

Every private page sits inside `ProtectedRoute`, which does four checks in order.

1. Still loading? Show a spinner and wait.
1. Nobody signed in? Send them to the login page.
1. Signed in but the profile has not arrived yet? Show a spinner and wait.
1. Signed in with the wrong role? Send them to their own portal.

The fourth check is a small piece of good design. A lecturer who types /app in the address bar is not shown an error — they are sent to /staff, where they belong.

```
export function homeFor(role) {
  switch (role) {
    case 'dept_admin':
    case 'super_admin': return '/admin'
    case 'lecturer':    return '/staff'
    default:            return '/app'
  }
}
```

> homeFor lives next to the guard on purpose, so a new role can never be added to the Role type without somebody deciding where that role lands.

## 5.2 The route map

<!-- widths: 29,71 -->
| Portal | Routes |
|---|---|
| /app (student) | dashboard, courses, attendance, results, enrollment, medical, feedback, mentor, planner, ai-assistant, notifications, notices, notices/:noticeId, profile, settings |
| /admin (dept_admin, super_admin) | dashboard, attendance, results, students, courses, medical, feedback, enrollment, notices, notifications, profile, and for the super admin: hods, batches, users |
| /staff (lecturer, including HOD) | dashboard, courses, attendance, results, feedback, feedback/:periodId/:courseId/form, mentees, notices, notifications, profile, and HOD-only: mentors, assignments, enrollment, catalogue, students, lecturers |
| / and /account (no sign-in) | the sign-in page; /account/setup and /account/reset, where an emailed link sets a password |

## 5.3 Pages load one at a time

Every page is loaded only when someone navigates to it. This was changed in September 2026 and it made a large difference.

<!-- widths: 29,35,36 -->
|  | Before | After |
|---|---|---|
| Main bundle | 2,853 kB | 674 kB |
| Login page image | 2.4 MB PNG | 202 KB WebP |
| Total first load | about 5.3 MB | about 876 kB |

Before the change, a student signing in downloaded the admin screens, the head of department's mentor allocation, the PDF writer and the charting library before the login form could appear — and then used none of them.

# 6. Interface gates are not security

This is the most commonly misunderstood point in the codebase, and both scope files say so in their own comments.

There are two helpers, `adminScope.ts` and `staffScope.ts`, that decide what the interface shows: which dropdowns are filtered, which menu items appear, which buttons are drawn.

:::warn SAY THIS OUT LOUD ONCE
These helpers decide what is SHOWN. They do not decide what is ALLOWED. A user who edits the JavaScript in their browser can defeat every one of them in a few seconds — and will still get nothing, because the database refuses independently.
:::

```
// src/lib/staffScope.ts
// These are presentation gates only. Every rule here is
// independently enforced by RLS and by the SECURITY DEFINER
// functions the pages call, so a lecturer who edits the client
// cannot reach anything this hides.
```

## 6.1 A worked example

Consider the HOD-only pages: /staff/mentors, /staff/assignments, /staff/enrollment, /staff/catalogue, /staff/students, /staff/lecturers.

1. The menu hides them from a lecturer who is not head of department.
1. The pages themselves refuse to render for a lecturer who types the URL directly.
1. The database functions behind them refuse regardless of what the browser does.

Three layers. The first two are courtesy. The third is the actual protection. If you only had time to build one, you would build the third.

This is not theoretical. On 21 September 2026 two of the department-wide reads behind these pages were found to be scoped to "the caller's own department" rather than "the department the caller heads", so any lecturer could read their whole department's teaching assignments and staff directory by calling the function directly. The menu had hidden it perfectly. The fix went into the database (department_wide_teaching_is_the_heads_to_see), not the menu.

# 7. get_my_role, and a bug worth remembering

Almost every security rule in the database starts by asking who the caller is. That question is answered by one function.

```
create or replace function public.get_my_role()
returns text
language plpgsql stable security definer
set search_path = public
as $$
declare v_role text;
begin
  -- a deactivated account is nobody, at once
  if not public.account_is_active(auth.uid()) then return ''; end if;

  select role into v_role from public.admins
   where id = auth.uid() and status = 'active';
  if v_role is not null then return v_role; end if;

  select role into v_role from public.students where id = auth.uid();
  if v_role is not null then return v_role; end if;

  return '';        -- a lecturer, or nobody: empty text, never NULL
end;
$$;
```

The first line was added on 2 October 2026 with deactivation. Because every admin policy and function goes through this function (and `is_super_admin()` and `my_lecturer_id()` make the same check), switching an account off takes effect on the very next query, not when its login token expires.

## 7.1 Why it returns empty text and not NULL

This one line was a genuine security hole until 9 September 2026.

Guard clauses in the database were written like this:

```
if get_my_role() <> 'super_admin' then
  raise exception 'not allowed';
end if;
```

In PostgreSQL, comparing NULL to anything gives NULL, not true. So when `get_my_role()` returned NULL — which happened for any caller who was in none of the tables — the condition was NULL, the exception never fired, and the function carried on and did the privileged work.

:::warn THE GENERAL LESSON
A guard that cannot answer the question must refuse, not continue. This class of bug is called failing open, and it is dangerous exactly because it is invisible: nothing errors, nothing is logged, the protected action simply happens for the wrong person.
:::

The fix had two halves: make the function return empty text so the comparison is always a real true or false, and wrap the remaining calls in coalesce so an unexpected NULL still fails closed. Guide 4 describes how the fix was proved.

# 8. An account's life

Until October 2026 accounts were made by scripts. They are now managed in the app by the super admin, through the `account` Edge Function, which holds the service-role key the browser must never have.

## 8.1 Invited

1. The super admin adds a person on the Users page: a student, lecturer or department admin, with their email.
1. The `account` function creates the sign-in account with no password and writes the person's row in students, lecturers or admins. A lecturer who is already in the records without a login keeps their row: the new account is attached to it. Then it emails a link through Resend.
1. The link opens `/account/setup` and lasts 72 hours. The person chooses a password and is signed in.
1. Until then the Users page shows the invitation as pending, and it can be resent or cancelled. An account with no password is how the function tells an invitation from an account in use.

A whole intake is brought in differently, from the Batches page: the `manage-batches` function creates every student's account with a random temporary password, returns the passwords once for the faculty to hand out, and stores them nowhere. The first sign-in then asks for a new one (section 3.3).

## 8.2 Reset

Anyone can press **Forgot password?** on the sign-in page and give their email, registration number or index number. If an account matches, a link goes to the email registered on it and lasts 60 minutes (`/account/reset`).

:::why HOW THE LINKS ARE KEPT SAFE
A link carries a random 256-bit token, and only its SHA-256 hash is stored, so the table cannot be used to sign in as anyone. It works once: setting the password claims the token in one conditional update, so two uses cannot both succeed, and issuing a new link cancels the older ones. The token travels after the # in the address, so it is never sent to the web server or kept in its logs, and an email scanner that opens the link does not use it up. The link always points at the configured app address, never one taken from the request. And asking for a reset always gets the same answer, whether or not the account exists, and is rate limited per account and per address.
:::

## 8.3 Deactivated

Any account below the super admin can be switched off from the Users page, with a reason, and switched back on. Nothing is deleted. Deactivation does three things at once: it records the row in `account_deactivations`; it bans the sign-in in Supabase Auth; and it makes every role helper in the database treat the account as nobody. A browser still signed in is signed out within minutes (section 3.3). The super admin's own account cannot be switched off here, and nobody can switch off their own.

## 8.4 Their own profile

Every role keeps a profile: a student's photo and contact details, a lecturer's title, name and photo (`update_my_lecturer_profile`), an admin's name and photo (`update_my_admin_profile`). Role, department and email are not editable by their owner — they decide what a person may see, so the faculty keeps them. Anyone can change their own password from the profile page.

# 9. Adding a new role

If a fifth role is ever needed, these are the places that must change. Missing one leaves either a broken menu or an open door.

1. `src/lib/types.ts` — add it to the Role type.
1. `ProtectedRoute.tsx` — add it to homeFor() so it has a home.
1. `routes.tsx` — add the portal and its routes.
1. `AuthContext.tsx` — decide which table it is looked up in, and where in the order.
1. `get_my_role()` in the database — the same order, or the two will disagree.
1. The Row Level Security policies on every table the role must reach.
1. The SECURITY DEFINER functions whose guards name specific roles, and the Edge Functions' own checks.

> Steps 5, 6 and 7 are the ones that actually matter. Steps 1 to 4 only change what people see.
