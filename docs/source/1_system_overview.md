---
kicker: Study Guide 1 of 7
title: System Overview
subtitle: What the PES is, and how the parts fit together
intro: Start here. This guide explains what the Performance Evaluation System does, who uses it, what it is built from, and how one click in the browser turns into an answer from the database. Read it before the other guides; Guide 0 lists them all and suggests an order.
updated: Updated 30 October 2026  ·  describes the feature/UI branch on that date  ·  first written 10 September 2026
footer: PES Study Guide
---

# 1. What the PES is

The Performance Evaluation System (PES) is a web application for the Faculty of Engineering at the University of Sri Jayewardenepura. It keeps the academic record of every undergraduate student and makes that record useful to the people who need it.

In one sentence: the PES records what students enrol in, whether they attend, what grade they are awarded, and who is responsible for helping them — and then shows each of those things only to the people allowed to see them.

## 1.1 The problem it solves

Before the PES, the same information lived in many places. Marks were in spreadsheets. Attendance was on paper. A student who wanted to know their GPA had to work it out by hand from a printed sheet. A head of department who wanted to know which students were at risk had to ask each lecturer separately.

The PES puts all of it in one place, applies the Faculty Handbook rules automatically, and gives every kind of user their own view of it.

## 1.2 What it does today

- **Enrolment** — students enrol in the modules for their semester, including modules they must repeat, inside windows the Super Admin opens (and can extend). Choosing a minor follows the department's published study plan.
- **Attendance** — lecturers open a live session; students check in with a rotating QR code or a short code. The department office can also mark a register by hand, and both write to the same register.
- **Results** — lecturers record the Mid-Sem and CA marks and the grade the examiners awarded, the database derives the grade point, the department (its admin or its head) publishes, and only then can students see it. Sheets can be exported to and imported from Excel.
- **Feedback** — students give anonymous feedback on modules and lecturers. Lecturers shape their own course's form before a round opens, and nobody sees the analytics until a minimum number of students has answered.
- **Medical certificates** — students upload a certificate for specific modules and an admin approves or rejects each module separately; an approval excuses the affected absences.
- **Mentoring** — every student has a lecturer as a mentor, with a live private chat, file attachments, and notes only the mentor can read.
- **Graduation Planner** — a student sees their CGPA, the SGPA each remaining semester needs for every class of honours, what is still left to graduate, and can try expected grades and save the scenario (or share it with their mentor).
- **AI Assistant** — a chat assistant that answers from the student's own record, the Faculty Handbook and the faculty website, using a model the faculty runs itself or Google Gemini.
- **Notices and notifications** — a notice board aimed at the faculty, a department, a batch or one course, and a record of what happened to each person (a result published, a register opened, a mentor message, a semester's results complete).
- **Batches and accounts** — the Super Admin brings a new intake in with sign-in accounts, divides it into departments, invites staff by email, deactivates an account, and removes a batch that has left (after downloading its records). Anyone can reset a forgotten password from an emailed link.

## 1.3 How big it is

These are the real numbers from the live database on 30 October 2026. They matter because they tell you what scale the system is actually designed for.

<!-- widths: 69,31 -->
| What | How many |
|---|---|
| Students | 167 |
| Lecturers | 41 |
| Admins (department and faculty level) | 7 |
| Courses in the catalogue | 232 |
| Course offerings (a course taught to one batch in one year) | 131 |
| Enrolment records | 5,656 |
| Result records | 7,392 |
| Notifications written | 806 |
| Database tables | 49 |
| Database functions written for the app | 248 |
| Database migrations (change history) | 276 |
| Edge Functions (server code beside the database) | 4 |
| TypeScript files in the app (44 pages, 119 components) | 213 |

> This is a faculty-sized system, not a national one. That single fact decides a lot of design choices later in these guides — for example, why long lists are not virtualised and why some queries are allowed to be simple.

# 2. Who uses it

The PES has four roles. A role decides which portal you land in and what the database will let you read and write.

<!-- widths: 17,27,57 -->
| Role | Who they are | What they can reach |
|---|---|---|
| student | An undergraduate | Only their own record. Nothing about any other student. |
| lecturer | Teaching staff | The modules they are assigned to, and the students in those modules. Also their own mentees. |
| dept_admin | Department administrator | Everything belonging to their own department. |
| super_admin | Faculty administrator | Everything in the faculty, plus the things only the faculty does: enrolment windows, batches, accounts, heads of department. |

## 2.1 Head of Department is not a role

This catches people out, so it is worth stating early. A Head of Department (HOD) is a lecturer who currently holds an appointment. It is not a fifth role.

The appointment lives in its own table, `hod_appointments`, with a start date, an end date and an active flag. When someone stops being head, the appointment row is closed. The person's lecturer record is not touched.

:::why WHY IT WAS BUILT THIS WAY
A headship is temporary and a person is not. Keeping the appointment separate means the history of who led a department is preserved, and ending a headship cannot accidentally damage a lecturer's teaching record or their identity.
:::

In practice this means there is one staff portal, not two. A lecturer who is also head of department sees the same portal with extra items in the menu.

# 3. The shape of the system

## 3.1 There is no backend server

This is the most important architectural fact in the whole project, and it is unusual enough to state plainly.

The PES has no Node.js or Java server of its own. There are two parts:

1. **The browser application** — a React app, built with Vite, served as static files from Vercel.
1. **Supabase** — a hosted PostgreSQL database that also exposes itself over HTTPS, handles sign-in, stores uploaded files, and runs a few small server functions (Edge Functions) for the jobs a browser must never do itself.

The browser talks straight to the database over HTTPS. There is no middle layer to check permissions.

```
  Browser (React on Vercel)
        |
        |  HTTPS, carrying the signed-in user's token
        v
  Supabase  (project pes-faculty-engineering, Singapore, PostgreSQL 17)
    +-- Auth        who is this person?  (email + password)
    +-- PostgREST   turns HTTP into SQL: tables and ~190 functions
    +-- PostgreSQL  the data + ALL the rules (row level security)
    +-- Storage     4 buckets: avatars (public), medical-certificates,
    |               mentor-attachments, notice-attachments (private)
    +-- Realtime    live mentor chat, notifications, registers
    +-- Edge Functions (Deno)
          ai-assistant       the assistant: a local model and/or Gemini
          faculty-site-sync  reads eng.sjp.ac.lk every night (pg_cron)
          manage-batches     creates / deletes students' sign-in accounts
          account            invitations, password resets, deactivation
```

:::warn THE CONSEQUENCE YOU MUST REMEMBER
Because the browser talks directly to the database, the database itself has to enforce every rule. If a rule only exists in the React code, a user can bypass it by opening the browser console. Guide 4 is entirely about how the database enforces those rules.
:::

## 3.2 Why there are Edge Functions at all

Four jobs cannot be done from the browser, and each has an Edge Function of its own. Calling a language model needs a secret API key that must never reach a student's browser. Reading the faculty website on a schedule needs something that runs when nobody is signed in. Creating or deleting a sign-in account needs the service-role key, which can do anything. Sending an email needs a mail provider's key.

Each function checks who is calling before it does anything, exactly as a database function does. Guide 7 lists their settings; Guide 4 explains their checks.

## 3.3 What each technology is for

<!-- widths: 29,71 -->
| Technology | What it does here |
|---|---|
| React 18 + TypeScript | Builds the user interface. TypeScript (strict) catches mistakes before the code runs. |
| Vite 6 | Builds and bundles the app, and runs the local development server. |
| React Router 7 | Decides which page shows for which URL, loads each page only when it is needed, and guards the private routes. |
| Tailwind CSS 4 + Radix UI (shadcn/ui) | Styling through design tokens, and accessible interface parts (dialogs, menus, selects, tabs). |
| Motion (framer-motion) | The small animations: cards appearing, numbers counting up, sections opening. Turned off for anyone who asks their device for less motion. |
| Recharts | The charts: GPA trend, attendance by course, grade distribution, the CGPA path. |
| jsPDF and ExcelJS | PDF result sheets and feedback reports; Excel result workbooks and batch spreadsheets, made and read in the browser. |
| Supabase JS client | The one library that talks to the database, auth, storage, realtime and the Edge Functions. |
| PostgreSQL 17 | Stores the data and enforces every access rule through Row Level Security. Extensions: pgvector (search), pg_cron and pg_net (the nightly website read), pgcrypto, Vault (secrets). |
| Deno (Edge Functions) | The four small server functions described above. |
| Google Gemini / Ollama | The language model behind the assistant: Gemini over the internet, or an open model (Qwen 2.5 3B) on a faculty machine. |
| Resend | Sends the invitation and password-reset emails. |
| Vercel | Hosts the built site and rebuilds it automatically when main changes. |

# 4. The folder map

Here is where things live. Only the folders that matter are listed. Guide 6 walks through the code itself.

```
Performance-Evaluation-System/
  pes_app/                       <-- the application
    src/
      main.tsx                   starts React
      app/
        App.tsx                  theme, sign-in, router, toasts
        routes.tsx               the URL map, one lazy chunk per page
        pages/                   the 18 student pages (and shared ones)
          admin/                 the 12 admin pages
          staff/                 the 14 lecturer / head of department pages
        components/
          common/                the design system: cards, tables, charts
          ui/                    shadcn/Radix building blocks
          <feature>/             pieces for one feature (planner, mentor...)
        layouts/                 the frame around each portal
        context/                 AuthContext (who is signed in), theme
        hooks/                   notifications, live chat
      lib/                       logic with no interface (35 modules)
        supabase.ts              the one database client
        settings.ts              the regulation engine's defaults
        graduationPlan.ts        the planner's arithmetic
        *Service.ts              grouped database calls
      styles/theme.css           every colour, radius and shadow
    vercel.json                  what deploys, and caching
  supabase/
    migrations/                  276 files - the full database history
      README.md                  the same history, numbered and described
    functions/                   the four Edge Functions
  docs/                          these guides
    source/                      their Markdown sources, and the build
  pes-scripts/                   one-off data scripts (handbook search)
  Screenshots/                   every screen, before and after the redesign
  Faculty Handbook 2026 new.pdf  the regulations
```

## 4.1 The one rule about lib/

Anything under `src/lib/` is logic with no interface attached. Anything under `src/app/` draws something on the screen. Keeping them apart is what lets the same calculation be used by a page, a PDF and the AI assistant without being written three times.

# 5. How one request travels

This is the part worth understanding properly. Everything else in the system is a variation of it.

Follow a student opening their Results page.

1. The student clicks Results. React Router matches `/app/results` and starts downloading that page's code chunk.
1. ProtectedRoute checks the session. If nobody is signed in, it redirects to the sign-in page. If a lecturer somehow reached this URL, it sends them to their own portal instead.
1. The page calls a database function. It runs `supabase.rpc('get_student_results')`.
1. The browser sends an HTTPS request. Attached to it is the signed-in user's access token — a signed piece of text proving who they are.
1. Supabase verifies the token and starts a database connection acting as that user.
1. The database applies its own rules. Row Level Security filters the rows to the ones this student is allowed to see, and the function itself refuses to return unpublished results.
1. Rows come back as JSON and React draws them.

:::why THE STEP THAT DOES THE REAL WORK
Step 6 is where security actually happens. Steps 2 and 3 are convenience — they make the app pleasant to use. If you deleted them, the system would still be safe, just ugly. If you deleted step 6, nothing would be safe at all.
:::

## 5.1 Two ways the app reads data

You will see both patterns all over the codebase, and it is worth knowing why each is used.

<!-- widths: 21,34,45 -->
| Pattern | Looks like | Used when |
|---|---|---|
| Direct table read | `supabase.from('courses').select(...)` | The rows are simple and Row Level Security alone is enough to decide who sees what. |
| Function call (RPC) | `supabase.rpc('get_my_mentees')` | The answer needs joining, calculating, or a rule that RLS cannot express on its own — for example, hiding a grade until it is published. |

Most of the interesting features use the second pattern. There are 248 functions in the database, of which signed-in users may call 194; the rest are triggers and internal helpers. Guide 2 explains how they are organised.

## 5.2 A third way: things that happen by themselves

Some writes are not made by anybody's click. When a department publishes a result sheet, a trigger on `results` writes one notification per student. When a semester's results are all in, another tells the student their Graduation Planner has moved. Every night at 02:07 Sri Lanka time, `pg_cron` asks the `faculty-site-sync` function to read the faculty website again. Guide 5 lists these.

# 6. The three rule books

The system's academic behaviour comes from three places. Knowing which is which saves a lot of confusion.

### 6.1 The Faculty Handbook 2026

The printed regulations. It defines the grading scale, what an R grade means, what an F grade means, the honours classifications, the Dean's List, the gold medal and the credit requirements. It is the source of truth, but the computer cannot read it.

### 6.2 The system_settings table

The Handbook's rules, written into the database as data rather than as code. There are 18 settings. Because they are data, the faculty can change a threshold without a developer redeploying the app. The most important ones:

<!-- widths: 35,28,37 -->
| Setting | Value today | Meaning |
|---|---|---|
| attendance_threshold | 80 | Minimum attendance percentage. |
| attendance_prewarning_threshold | 85 | Below this, the student gets an early warning. |
| graduation_total_credits | 144 | Credits needed to graduate. |
| total_semesters | 8 | Length of the degree. |
| oa_weights | CA 30%, ESE 70% | The default split for a new course; each course carries its own. Grades are awarded, not computed from marks, so this describes a course rather than driving a calculation. |
| resit_max_grade | C | The best grade obtainable on a re-sit or repeat. |
| gpv_scale | A+ = 4.0 ... F/R/L = 0.0 | Grade point value for each grade. |
| grade_boundaries | A+ from 85, A from 75, ... | Which mark band goes with which grade. |
| honours_classifications | First from 3.70, ... | Class of honours thresholds. |
| medical_submission_deadline_days | 14 | How long a student has to submit a certificate. |
| feedback_min_responses_for_analytics | 1 (5 before release) | Fewer replies than this and nobody may see the analytics. Lowered to 1 while PES is tested by one developer; with one respondent a report names its author, so it goes back to 5 before students use it. |

Guide 2 lists all 18.

> There is a safety net in code: if the settings table cannot be read, src/lib/settings.ts falls back to the same faculty defaults. The system degrades to correct behaviour rather than to zeroes.

### 6.3 Row Level Security policies

The privacy rules, written as SQL attached to each table. These decide who may see which row. There are 117 of them on the application's tables and 13 more on the stored files. They are covered fully in Guide 4.

# 7. How the project is developed and deployed

## 7.1 The branches

<!-- widths: 20,80 -->
| Branch | What it is for |
|---|---|
| `dev` | Day-to-day work. A push here deploys nothing. |
| `main` | Production. `dev` is merged into it when a change is ready, and Vercel builds and publishes the live site from it. |
| `feature/UI` | The October 2026 redesign of every screen. It already contains everything on `dev`; it is merged across once it has been tested. Vercel builds a preview of it, not the live site. |
| `claude/*` | Short-lived working branches for automated changes. vercel.json turns their deployments off. |

## 7.2 Database changes

Database changes are applied to the live Supabase project and saved under `supabase/migrations/` with the same version number, so the repository and the live history stay identical. There are 276 of them, and together they are the history of how the database reached its current shape. `supabase/migrations/README.md` lists them all, numbered, with one line on what each does.

```
20260909150732_a_failed_course_has_to_be_repeatable.sql
20261002082754_accounts_are_invited_reset_and_deactivated.sql
20261028113540_a_course_taught_over_two_semesters_is_graded_once.sql
```

Each file name carries the date and time it was applied, so the order is never ambiguous. A few of the very first tables were made in the SQL editor before migrations were recorded, so the folder alone cannot rebuild the database from empty; Guide 7 explains how to take a full schema dump instead.

## 7.3 Running it on your own machine

```
cd pes_app
npm install
npm run dev        # opens http://localhost:5173

npm run typecheck  # check TypeScript, should print nothing
npm run build      # production build
```

You will need a `pes_app/.env.local` file holding the Supabase project URL and the public (anon) key. It is deliberately not in version control. Guide 7 covers every setting, including the Edge Functions' secrets.

# 8. What is built, and what is next

## 8.1 Complete

- Sign-in and the four roles, with three portals; invitations, password resets and deactivation
- Course catalogue, offerings, lecturer assignment, and courses taught over two semesters
- Enrolment, including repeats for R, F and L grades, minors by study plan, and extendable windows
- Attendance, both live sessions and manual registers, per delivery
- Results, with the full entry to publication workflow, corrections, and Excel import and export
- Feedback, with approval, course-specific forms, anonymity and a privacy threshold
- Medical certificates, reviewed module by module
- Mentoring, with live chat, file attachments and private notes
- Graduation Planner: semester targets, expected grades, scenarios, the Dean's List and gold medal checks
- Batches: intake with accounts, division into departments, removal with an export first
- PDF result sheets and feedback reports
- Notice board with attachments, and notifications with unread badges
- An AI assistant over the student's record, the Handbook and the faculty website
- Profiles and photos for every role; department colours throughout; light and dark themes

## 8.2 The AI Assistant

The assistant sends every message to a language model, which chooses for itself which of fourteen tools to call — twelve database functions over the student's own record and the catalogue, and searches of the Handbook and of the faculty website — and writes the answer from what they return. It may state only what a tool returned, and never does GPA arithmetic itself.

Which model answers is configuration, not code. The faculty can run an open model (Qwen 2.5 3B under Ollama) on an ordinary computer with no graphics card, and the assistant falls back to Google Gemini, with as many API keys as are configured, when that machine is busy or down. The two AI guides describe it in full.

## 8.3 Deliberately not built

- **Time limits on completing the degree** are recorded in the Handbook but not enforced.
- **The Dean's List and the gold medal** are shown in the Graduation Planner as targets and checks (an SGPA of 3.80 for the Dean's List; for the medal, an OGPA of 3.80 in four years with no compulsory or elective course repeated), but the system does not award or record them, and it cannot see the medal's last condition, no disciplinary action.

## 8.4 Before students use it

Three settings are deliberately relaxed for testing and must be put back before distribution: the feedback threshold (1, back to 5), Supabase's leaked-password protection (needs the Pro plan), and the assistant's daily limits (`AI_DAILY_QUOTA`, `AI_PER_STUDENT_DAILY`). Guide 7 has the checklist.

## 8.5 Changed since the first edition

- **Notices and notifications** (13 September) — the notice board, per-person notifications written by database triggers, and sidebar badges that clear when the item is opened.
- **One register, one result sheet** (19–20 September) — lecturers and the department office write to the same delivery.
- **A repeated course counts once** (20 September) — every figure counts the attempt that stands and ignores the one it replaced.
- **Security follow-up** (27 September) — signed-out callers can no longer call the application's functions, the dated backup tables were dropped, and pgvector moved out of the public schema.
- **Department colours, profiles and photos** (27 September) — each department's colour from the Handbook carried through every list; lecturers and admins keep their own profile and photo.
- **The assistant reads the faculty website** (30 September) — a nightly read of eng.sjp.ac.lk, searched beside the Handbook.
- **Minors follow the study plan** (1 October) — baskets per semester, a mandatory course, and a warning at enrolment when it is left out.
- **Batches** (1 October) — bringing an intake in, dividing it into departments, and removing a batch that has left.
- **Accounts and the faculty's own model** (2 October) — invitations, resets and deactivation by email; the assistant on a local model with Gemini behind it.
- **Courses over two semesters, and the new Graduation Planner** (28 October) — a course graded once for both parts; semester targets, scenarios, the gold medal check, sharing with the mentor, and a notification when a semester is complete.
- **Extending an enrolment window** (29 October).
- **Unused database objects removed** (30 October) — the empty `timetables` and legacy `feedback` tables, the never-filled `courses.lecturer_name` column and an unused view, with no data lost.
- **The redesign** (29–30 October, `feature/UI`) — every screen rebuilt on one set of shared components; Guide 6 describes them.

# 9. Where to go next

<!-- widths: 36,64 -->
| Guide | Read it when you want to know |
|---|---|
| 0 — Start Here | Which guide answers which question, the words the guides use, and a reading order. |
| 2 — Database | What every table holds, how the tables connect, and what the functions do. |
| 3 — Login, Roles and Permissions | How signing in works, how a role is decided, and how accounts are invited, reset and deactivated. |
| 4 — Security and Row Level Security | How the database stops people seeing what is not theirs. |
| 5 — Features and Data Flows | How each feature works, step by step, from click to database. |
| 6 — Code Structure | How the React app is organised: routes, layouts, services, the design system. |
| 7 — Configuration and Operations | Every setting and secret, deploying, migrations, the nightly job, and the release checklist. |
| AI Assistant (two guides) | The assistant end to end, and its retrieval and tools in plain English. |

> Suggested order: this guide, then 3, then 4, then 2, then 5, then 6 and 7. Guides 3 and 4 explain the ideas that the table structure in Guide 2 only makes sense in light of.
