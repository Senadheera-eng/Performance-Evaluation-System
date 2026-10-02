# Performance Evaluation System (PES)

> An academic management platform for the Faculty of Engineering, with an AI assistant grounded in the student's own record and the Faculty Handbook

**Data Management Project (CO3554) — Faculty of Engineering, University of Sri Jayewardenepura**  
**Developer:** K.M.L.N. Senadheera | Index: 22/ENG/079 | Department of Computer Engineering

---

## What is PES?

PES keeps the academic record of every undergraduate in the Faculty — what they enrol in, whether they attend, what marks they get, what grade that becomes, and who is responsible for helping them — and shows each of those things only to the people allowed to see them. The Faculty Handbook 2026 rules are applied by the database itself, not left to the screens.

It is built from the student's perspective: real-time attendance against the 80% rule, published results and GPA, a graduation planner, and warnings before a problem becomes a failure.

---

## Who uses it

| Role          | Portal   | What they can reach                                                        |
| ------------- | -------- | -------------------------------------------------------------------------- |
| `student`     | `/app`   | Only their own record                                                      |
| `lecturer`    | `/staff` | The offerings they teach, the students in them, and their own mentees      |
| `dept_admin`  | `/admin` | Everything in their own department                                         |
| `super_admin` | `/admin` | Everything in the faculty                                                  |

A **Head of Department is not a role.** It is a lecturer with an active row in `hod_appointments`; the staff portal grows extra menu items (mentor allocation, course assignments, enrolment oversight, the department catalogue, students and lecturers), and the database functions behind them check the appointment independently.

---

## Features

### Students
- **Dashboard** — CGPA, credits, attendance, recent results, and insights (attendance risk, GPA change, deadlines, open enrolment windows)
- **Attendance** — per delivery, against the 80% threshold with an 85% early warning; check in to a live lecture by QR or typed code
- **Results** — published grades and GPA; the raw exam mark is never shown, and nothing is visible before the department publishes
- **Enrolment** — the semester's modules as Handbook baskets, plus outstanding R / F / L modules to repeat
- **Graduation Planner** — credits and baskets still owed, and the average needed for each class of honours
- **Medical certificates** — upload against specific modules within the 14-day window; each module is reviewed separately
- **Course feedback** — anonymous or named, on the form each course holds
- **Mentor** — a live chat with the lecturer assigned as their mentor, with attachments
- **Notices and notifications** — a notice board scoped to faculty, department, batch or course, and a record of what changed
- **AI Assistant** — see below

### Lecturers and heads of department
- Live attendance sessions with a rotating code, optional geofence and mid-lecture presence checks
- Result entry as a draft, then submission to the department, which publishes or returns the sheet (the lecturer never publishes)
- Feedback rounds requested per course, with a per-course form editor and analytics once responses exist
- Mentees with an academic overview and private notes the student can never see
- Result sheets and feedback reports exported to PDF, and results imported from Excel

### Department and faculty administrators
- Manual attendance registers, result review and grade correction (the original grade is kept)
- The course catalogue and minors; enrolment windows and HOD appointments are the super admin's, and department offices watch enrolment read-only
- Medical certificate review, feedback rounds (create, open, close, and approve lecturers' requests), notices, and department-wide dashboards
- **Users** (super admin): add students, lecturers and department admins by **email invitation** — each chooses their own password from a single-use link that expires in 72 hours — and **deactivate** or reactivate anyone below the super admin. Deactivation ends access at once (sign-in barred, admin and lecturer rights refused by the database, open sessions signed out by the app) and deletes nothing: results, attendance, feedback and enrolment history stay. **Forgot password** on the sign-in page sends a single-use reset link, valid 60 minutes, to the email the account is registered with
- **Batches** (super admin): bring a new intake in from the faculty's Excel/CSV list — each student gets a sign-in account and a temporary password, handed out as a sheet and changed at first sign-in — divide a batch into departments from a list, and remove a batch that has left with all its records (results, attendance, enrolments, medical submissions and files, mentoring, sign-in accounts). Course feedback is kept without names unless the super admin chooses otherwise, and the batch's records can be downloaded as a workbook first

---

## AI Assistant

The assistant is a **tool-calling language model with retrieval over the Faculty Handbook (RAG)**. There is no trained prediction model.

- Every message goes to the `ai-assistant` Supabase Edge Function, which calls a language model with a set of tools: a model the faculty runs itself (Llama, Qwen or similar, under Ollama), Google Gemini, or both — tried in order, so a model that is rate limited, busy or down is stepped past to the next. Gemini can take several API keys.
- Each tool is a PostgreSQL function called **with the student's own token**, so row level security decides what it can see — a student cannot ask about anyone else.
- Handbook questions use `search_handbook_hybrid`: 131 Handbook chunks searched by full text (with optional pgvector similarity), cited with a page number.
- Everything the faculty publishes — notices, news, the academic calendar, staff, contacts — comes from its official website, **eng.sjp.ac.lk**. The `faculty-site-sync` Edge Function reads the site every night at 02:07 (a `pg_cron` job, calling through `pg_net` with a key kept in the Supabase vault), splits each page into sections, and keeps them in `faculty_site_chunks`. The assistant searches them with `search_faculty_site` and links the page it answered from. It follows robots.txt, stays on the faculty's host, skips theme placeholder pages, keeps the links to PDFs and Drive folders a notice points to, and reads the academic calendar's embedded Google Sheet as dated runs per batch. The Super Admin's dashboard shows how much of the site is read and has a **Read now** button.
- The model may state only what a tool returned and never does GPA arithmetic itself; that is delegated to the same functions the Graduation Planner uses.

A plain-English explanation of RAG and the assistant's tools is in `docs/PES_Guide_AI_Assistant_RAG_Explained.docx` (written for the first thirteen; the fourteenth, `search_faculty_website`, is described above).

**Which model answers** is set by Supabase secrets, so changing it needs no code change or redeploy:

| Secret | What it does |
| --- | --- |
| `LOCAL_LLM_URL`, `LOCAL_LLM_MODEL`, `LOCAL_LLM_API_KEY` | The faculty's own model, through any OpenAI-compatible server (Ollama, llama.cpp, vLLM). No GPU needed: `qwen2.5:3b` runs in 8 GB of RAM on a CPU. Hardware, measured speeds and setup: [`docs/local-llm.md`](docs/local-llm.md) |
| `LOCAL_LLM_PROFILE` | `small` (default, for a 1.7–4B model on a CPU: short instructions, tables written by code, readable search results) or `full` (a 7B+ model on a GPU) |
| `GEMINI_API_KEYS` (comma-separated) / `GEMINI_API_KEY` | Gemini; a key out of allowance or refused is rested and the next is used |
| `AI_PROVIDERS` | The order, default `local,gemini` |
| `GEMINI_MODEL` | Overrides the Gemini model |
| `AI_DEADLINE_MS` | How long one question may take, default 60 s, at most 140 s |
| `AI_DAILY_QUOTA` / `AI_PER_STUDENT_DAILY` | PES's own usage caps |

**Current limit:** the project runs on one Gemini **free-tier** key, which allows only a few requests a minute, and one question can take three or four of them. Before PES is distributed to students it needs either the faculty's own model or a paid Gemini key. Pooling free keys from several accounts is not a substitute: Google's terms forbid getting around its limits that way, and free-tier prompts — here, students' grades — may be used by Google.

### Before distributing to students

Two settings are relaxed while PES is developed by one person, and both must go back before a real cohort uses it:

1. **A model that is not the free tier**: the faculty's own (see [`docs/local-llm.md`](docs/local-llm.md)) and/or a paid Gemini key, as above.
2. **The feedback anonymity threshold.** `feedback_min_responses_for_analytics` is `1` for testing; with one respondent a course's analytics identify who wrote the comment. Set it back to the Faculty's `5`:
   ```sql
   update system_settings set value = '5' where key = 'feedback_min_responses_for_analytics';
   ```

3. **Email for invitations and password resets.** Create a [Resend](https://resend.com) account, verify a sending domain (e.g. `eng.sjp.ac.lk`, by adding the DNS records Resend gives you), create an API key, and set these Supabase secrets:
   - `RESEND_API_KEY` — the key
   - `PES_EMAIL_FROM` — e.g. `PES <no-reply@eng.sjp.ac.lk>`
   - `PES_APP_URL` — the address the links open, default `https://pes-usj.vercel.app`

   Until then, the Users page shows each invitation link for the super admin to send by hand, and "Forgot password" cannot deliver its email. Resend's test sender (`onboarding@resend.dev`) only delivers to the email the Resend account was opened with.

4. **Turn off public sign-up** under Supabase → Authentication → Sign In / Providers ("Allow new users to sign up"). Accounts are created only by invitation and batch intake; with sign-up on, anyone holding the public key could create a sign-in account (one with no access to any data).

Also enable **leaked password protection** under Supabase → Authentication → Settings (it needs the Pro plan).

---

## Architecture

There is **no backend server of our own.** The browser talks to Supabase directly, so every rule is enforced inside PostgreSQL.

```
React app (Vite, hosted on Vercel)
      │  HTTPS, carrying the signed-in user's token
      ▼
Supabase
  ├── Auth          email + password
  ├── PostgREST     tables and ~170 RPC functions over HTTP
  ├── PostgreSQL    the data and every access rule (row level security)
  ├── Storage       avatars (public); medical-certificates, mentor-attachments, notice-attachments (private)
  ├── Realtime      mentor chat
  ├── Edge Function ai-assistant → the faculty's own model (Ollama) and/or Google Gemini
  ├── Edge Function faculty-site-sync ← nightly pg_cron job; reads eng.sjp.ac.lk
  ├── Edge Function manage-batches    creates and deletes students' sign-in accounts (super admin only)
  └── Edge Function account           invitations, password resets, deactivation; emails through Resend
```

| Layer              | Technology                                          |
| ------------------ | --------------------------------------------------- |
| Frontend           | React 18 + TypeScript + Vite, React Router 7        |
| UI                 | Tailwind CSS 4 + Radix UI (shadcn/ui), Motion       |
| Charts / exports   | Recharts; jsPDF for PDFs; ExcelJS for workbooks     |
| Database           | Supabase PostgreSQL 17 with row level security      |
| Authentication     | Supabase Auth (email + password)                    |
| AI Assistant       | Google Gemini (tool calling) + Handbook and faculty-website RAG (pgvector + full text) |
| Deployment         | Vercel (frontend, `main` only) + Supabase (backend) |

---

## Project Structure

```
pes_app/                       the application
  src/app/pages/               student pages
  src/app/pages/admin/         department / faculty admin pages
  src/app/pages/staff/         lecturer and head-of-department pages
  src/app/components/          interface pieces, grouped by feature
  src/app/context/             AuthContext (who is signed in), theme
  src/app/routes.tsx           the URL map, one lazy chunk per page
  src/lib/                     logic with no interface: services, settings, PDF writers
supabase/
  migrations/                  the database history, one file per change
  functions/ai-assistant/      the Gemini edge function
docs/                          study guides (.docx) and Handbook extraction scripts
pes-scripts/                   one-off data loading scripts (Handbook chunks, accounts)
```

---

## Database

The live schema has **41 tables**, all with row level security enabled. The main groups:

| Area          | Tables                                                                                          |
| ------------- | ----------------------------------------------------------------------------------------------- |
| People        | `students`, `lecturers`, `admins`, `hod_appointments`, `student_batch_changes`                  |
| Courses       | `courses` (catalogue), `course_offerings` (a course taught to one batch in one year), `course_lecturers`, `curriculum_slots`, `minor_requirements` |
| Enrolment     | `enrollment_periods`, `enrollment_period_courses`, `enrollments`                                |
| Attendance    | `attendance`, `attendance_sessions`, `attendance_checkins`, `attendance_presence_checks`, `attendance_presence_responses` |
| Results       | `results` (draft → submitted → published, with correction history)                              |
| Feedback      | `feedback_periods`, `feedback_questions`, `feedback_period_questions`, `feedback_period_courses`, `feedback_submissions`, `feedback_answers` |
| Medical       | `medical_submissions`, `medical_submission_courses`, `medical_submission_files`                 |
| Mentoring     | `mentor_assignments`, `mentor_messages`, `mentor_notes`                                         |
| Communication | `notices`, `notice_categories`, `notice_attachments`, `notifications`                           |
| Rules and AI  | `system_settings` (the regulation engine), `handbook_chunks`, `faculty_site_pages`, `faculty_site_chunks`, `ai_assistant_usage_log` |

Students read results only through the `my_published_results` view and RPCs, never the `results` table directly. Every migration file in `supabase/migrations/` explains in its header why the change was made.

### The first tables predate the migration history

`students`, `courses`, `enrollments`, `attendance`, `results`, `lecturers`, `feedback`, `medical_submissions` and `timetables` were created in the SQL editor before migrations were recorded, so `supabase/migrations/` alone cannot rebuild the database from empty. To produce a complete schema file, run this from a machine with the Supabase CLI and the database password:

```bash
supabase db dump --db-url "postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres" -f supabase/schema.sql
```

---

## Getting Started

Prerequisites: Node.js 18+ and access to the Supabase project.

```bash
cd pes_app
npm install
npm run dev        # http://localhost:5173
npm run typecheck
npm run build
```

Create `pes_app/.env.local` (not committed):

```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

Accounts are created by administrators; there is no self-registration.

---

## Academic Rules Implemented

Taken from the **Faculty Handbook 2026** and stored in `system_settings`, so they can change without a redeploy:

- **Attendance** — 80% minimum per delivery, early warning below 85%; excused absences count as present
- **Grading** — the examiners award the grade and it is entered on the sheet beside the Mid-Sem and CA marks; the grade point follows from the grade (A+/A 4.0 … C 2.0; F, R and L carry 0) and is derived by the database, never typed
- **Course weights** — each course records its CA / ESE split (30% / 70% by default); the mark boundaries (A+ from 85 … C from 45) are kept in settings
- **Repeats** — R re-sits the exam, F repeats the course, both capped at C; L (approved medical) is uncapped; a repeated course counts once
- **Graduation** — 144 credits over 8 semesters; First Class from 3.70, Second Upper 3.30, Second Lower 3.00
- **Medical certificates** — 14-day submission window
- **Feedback** — analytics hidden below `feedback_min_responses_for_analytics` responses

Recorded but not enforced: the Dean's List, and the time limits on completing the degree.

---

## Branches and Deployment

| Branch | Purpose                                                            |
| ------ | ------------------------------------------------------------------ |
| `dev`  | Day-to-day work; a push here does not deploy                       |
| `main` | Production; Vercel builds and deploys it on every push             |

Database changes are applied to the live Supabase project and saved under `supabase/migrations/` with the same version, so the repository and the live history stay identical.

---

## License

Developed as an academic project for the Data Management module (CO3554) at the Faculty of Engineering, University of Sri Jayewardenepura. All rights reserved.

---

_Faculty of Engineering | University of Sri Jayewardenepura | 2026_
