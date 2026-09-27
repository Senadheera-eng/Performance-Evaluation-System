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
- **Results** — published grades and GPA; the raw exam mark is never shown, and nothing is visible before the head of department publishes
- **Enrolment** — the semester's modules as Handbook baskets, plus outstanding R / F / L modules to repeat
- **Graduation Planner** — credits and baskets still owed, and the average needed for each class of honours
- **Medical certificates** — upload against specific modules within the 14-day window; each module is reviewed separately
- **Course feedback** — anonymous or named, on the form each course holds
- **Mentor** — a live chat with the lecturer assigned as their mentor, with attachments
- **Notices and notifications** — a notice board scoped to faculty, department, batch or course, and a record of what changed
- **AI Assistant** — see below

### Lecturers and heads of department
- Live attendance sessions with a rotating code, optional geofence and mid-lecture presence checks
- Result entry as a draft, submission to the head of department, and publication by the head only
- Feedback rounds requested per course, with a per-course form editor and analytics once responses exist
- Mentees with an academic overview and private notes the student can never see
- Result sheets and feedback reports exported to PDF, and results imported from Excel

### Department and faculty administrators
- Manual attendance registers, result review and grade correction (the original grade is kept)
- Enrolment windows, the course catalogue and minors, HOD appointments
- Medical certificate review, feedback round approval, notices, and department-wide dashboards

---

## AI Assistant

The assistant is a **tool-calling language model with retrieval over the Faculty Handbook (RAG)**. There is no trained prediction model.

- Every message goes to the `ai-assistant` Supabase Edge Function, which calls **Google Gemini** with a set of tools.
- Each tool is a PostgreSQL function called **with the student's own token**, so row level security decides what it can see — a student cannot ask about anyone else.
- Handbook questions use `search_handbook_hybrid`: 131 Handbook chunks searched by full text (with optional pgvector similarity), cited with a page number.
- The model may state only what a tool returned and never does GPA arithmetic itself; that is delegated to the same functions the Graduation Planner uses.

**Current limit:** the project runs on the Gemini **free tier**, which allows only a few requests a minute, and one question can take three or four of them. A paid Gemini API key is required before PES is distributed to students. The key is a Supabase secret (`GEMINI_API_KEY`), so changing it needs no code change or redeploy; `GEMINI_MODEL` overrides the model, and `AI_DAILY_QUOTA` / `AI_PER_STUDENT_DAILY` set PES's own usage caps.

### Before distributing to students

Two settings are relaxed while PES is developed by one person, and both must go back before a real cohort uses it:

1. **A paid Gemini API key** in the `GEMINI_API_KEY` secret, as above.
2. **The feedback anonymity threshold.** `feedback_min_responses_for_analytics` is `1` for testing; with one respondent a course's analytics identify who wrote the comment. Set it back to the Faculty's `5`:
   ```sql
   update system_settings set value = '5' where key = 'feedback_min_responses_for_analytics';
   ```

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
  ├── PostgREST     tables and ~290 RPC functions over HTTP
  ├── PostgreSQL    the data and every access rule (row level security)
  ├── Storage       avatars (public); medical-certificates, mentor-attachments, notice-attachments (private)
  ├── Realtime      mentor chat
  └── Edge Function ai-assistant → Google Gemini
```

| Layer              | Technology                                          |
| ------------------ | --------------------------------------------------- |
| Frontend           | React 18 + TypeScript + Vite, React Router 7        |
| UI                 | Tailwind CSS 4 + Radix UI (shadcn/ui), Motion       |
| Charts / exports   | Recharts; jsPDF for PDFs; ExcelJS for workbooks     |
| Database           | Supabase PostgreSQL 17 with row level security      |
| Authentication     | Supabase Auth (email + password)                    |
| AI Assistant       | Google Gemini (tool calling) + Handbook RAG (pgvector + full text) |
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
| Rules and AI  | `system_settings` (the regulation engine), `handbook_chunks`, `ai_assistant_usage_log`          |

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
- **Grading** — A+ from 85 down to C from 45; GPV A+/A 4.0 … C 2.0; F, R and L carry 0
- **Overall mark** — CA 30% / ESE 70% by default, with each course carrying its own weights
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
