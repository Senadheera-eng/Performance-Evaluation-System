# Performance Evaluation System (PES)

> An Intelligent Academic Management Platform with AI-Powered Insights

**Data Management Project (CO3554) — Faculty of Engineering, University of Sri Jayewardenepura**
**Developer:** K.M.L.N. Senadheera | Index: 22/ENG/079 | Reg: EN108953 | Department of Computer Engineering

---

## What is PES?

PES is a web-based academic management platform built specifically for students of the Faculty of Engineering at USJ. Unlike existing systems that are purely administrative, PES is designed from the student's perspective — giving undergraduates real-time visibility into their academic performance, proactive warnings before problems occur, and (soon) an AI assistant that understands faculty regulations.

The system currently runs on **real Batch 7 student data** — 163 students from the developer's own batch, covering Year 1 (Semester 1 & 2) results and course enrollments.

---

## Key Features

### For Students

- **Academic Dashboard** — Semester-wise CGPA, credit progress, and performance trends
- **Real-Time Attendance Monitoring** — Per-course attendance with 80% CCR threshold warnings
- **Results Viewer** — Published grades, GPV, and semester GPA across all completed semesters
- **Course Management** — View ongoing, completed, and available courses with minor category mapping
- **Course Enrollment** — Enroll in upcoming semester courses with seat availability tracking
- **AI Academic Assistant** _(UI built, API integration pending)_ — Ask academic questions in natural language; get answers grounded in the Faculty Handbook and personal records
- **Result Prediction** _(planned)_ — CART Decision Tree model to predict likely final grades from mid-semester and CA marks
- **Medical Certificate Submission** — Upload and track submissions within the 14-day policy window
- **Student Feedback** — Submit anonymous or non-anonymous course and lecturer feedback

### For Department Admins

- **Attendance Management** — Mark present/absent per course per lecture date
- **Result Entry & Publishing** — Enter marks as draft, review, then publish to students
- **Student Management** — View and search all student academic records
- **Course & Timetable Management** — Add courses, map minor categories, publish semester timetables
- **Analytics Dashboard** — Department-wide performance trends and attendance summaries

---

## Tech Stack

| Layer              | Technology                                             |
| ------------------ | ------------------------------------------------------ |
| Frontend           | React 19 + TypeScript + Vite                           |
| UI                 | Tailwind CSS + shadcn/ui + Framer Motion               |
| Charts             | Recharts                                               |
| Backend / Database | Supabase (PostgreSQL)                                  |
| Authentication     | Supabase Auth (email + password)                       |
| Security           | Row Level Security (RLS) policies                      |
| AI Assistant       | Claude API (Anthropic) + RAG — _planned_               |
| ML Prediction      | Python + Scikit-learn (CART Decision Tree) — _planned_ |
| Deployment         | Vercel (frontend) + Supabase (backend) — _planned_     |

---

## Project Structure

```
pes_app/
├── src/
│   ├── app/
│   │   ├── components/        # Shared UI components
│   │   │   ├── dashboard/     # StatCard, CourseCard, AlertCard
│   │   │   └── ui/            # shadcn/ui components
│   │   ├── context/
│   │   │   ├── AuthContext.tsx
│   │   │   └── ThemeContext.tsx
│   │   ├── layouts/
│   │   │   ├── AppLayout.tsx
│   │   │   └── AdminLayout.tsx
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx
│   │   │   ├── Attendance.tsx
│   │   │   ├── Results.tsx
│   │   │   ├── Courses.tsx
│   │   │   ├── Enrollment.tsx
│   │   │   ├── AIAssistant.tsx
│   │   │   ├── Profile.tsx
│   │   │   ├── Settings.tsx
│   │   │   ├── LoginPage.tsx
│   │   │   └── admin/
│   │   │       ├── AdminDashboard.tsx
│   │   │       ├── AdminAttendance.tsx
│   │   │       ├── AdminResults.tsx
│   │   │       ├── AdminStudents.tsx
│   │   │       └── AdminCourses.tsx
│   │   ├── App.tsx
│   │   └── routes.tsx
│   ├── lib/
│   │   ├── supabase.ts        # Supabase client
│   │   └── types.ts           # TypeScript interfaces
│   └── assets/
├── .env.local                 # Environment variables (not committed)
├── package.json
└── vite.config.ts
```

---

## Database Schema

10 tables in PostgreSQL via Supabase:

| Table                 | Purpose                                         |
| --------------------- | ----------------------------------------------- |
| `students`            | Student profiles and authentication             |
| `courses`             | Course catalogue with department + GPA flag     |
| `enrollments`         | Student ↔ course registration per academic year |
| `results`             | Marks, grades, GPV per enrollment               |
| `attendance`          | Per-lecture attendance records                  |
| `lecturers`           | Lecturer profiles                               |
| `course_lecturers`    | Course ↔ lecturer mapping per year              |
| `feedback`            | Student feedback on courses/lecturers           |
| `medical_submissions` | Medical certificate uploads + status            |
| `timetables`          | Weekly lecture schedule per course              |

All tables have Row Level Security (RLS) enabled — students can only access their own records; admins have elevated access via the `dept_admin` role.

---

## Current Data

The database is seeded with **real Batch 7 data** (not dummy data):

- **163 students** — Index numbers `22/ENG/001`–`172` and 10 repeater students (`21/ENG/xxx`) studying with Batch 7
- **16 Year 1 courses** — 9 in Semester 1, 7 in Semester 2, correctly mapped to departments by course code prefix (`CE`→Civil, `CO`→Computer, `EE`→Electrical & Electronic, `ME`→Mechanical, `IS`→Interdisciplinary Studies)
- **Enrollments & Results** — Full Year 1 (Semester 1 & 2) grades and GPV for all students, sourced from the official results sheet
- **Department** — All Year 1 students are recorded as `Inter-departmental` since department selection happens after Year 1 GPA ranking
- Year 2 & 3 department-wise data (Civil / Electrical / Mechanical / Computer) is **pending upload**

---

## Getting Started

### Prerequisites

- Node.js 18+
- A Supabase project (PostgreSQL + Auth)

### Installation

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Add your Supabase URL, anon/publishable key, and service role key to .env.local
```

### Environment Variables

Create `.env.local` in the project root:

```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_publishable_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key   # server-side scripts only, never expose to client
```

> **Note:** Supabase has migrated to new `sb_publishable_...` / `sb_secret_...` key formats. If your project shows these in **Project Settings → API Keys**, use them instead of the legacy `eyJ...` JWT keys. Double-check for accidental trailing characters (e.g. a stray `/`) when copy-pasting — a single extra character will cause silent 401 authentication failures.

### Database Setup

Run the SQL scripts in the Supabase SQL Editor in this order:

1. `sql/01_create_tables.sql` — Creates all 10 tables
2. `sql/02_rls_policies.sql` — Enables RLS and sets access policies
3. `sql/03_gpa_view.sql` — Creates the GPA summary view
4. `batch7_real_data.sql` — Inserts real Batch 7 students, courses, enrollments, and results
5. `fix_course_departments.sql` — Assigns correct department per course code prefix

### Creating Student Login Accounts

Supabase Auth accounts must be created via the **Admin API**, not raw SQL inserts (manual `auth.users` inserts are unreliable across Supabase versions due to internal password-hashing requirements).

```bash
npm install @supabase/supabase-js dotenv
node create_auth_users.cjs   # creates all student logins, password: pes@123
node sync_ids.cjs            # syncs students.id to match the UUIDs Supabase assigned
```

> Node scripts must use the `.cjs` extension in this project since `package.json` has `"type": "module"`.

After running both scripts, also run `fix_fk_after_sync.sql` in the SQL Editor to re-link `enrollments` and `results` to the synced student IDs.

### Run Locally

```bash
npm run dev
```

Visit `http://localhost:5173`

---

## Authentication

The system uses university email and password for authentication via Supabase Auth. Role-based routing redirects:

- `student` → `/app` (student dashboard)
- `dept_admin` → `/admin` (admin panel)

**Test accounts:**

| Role    | Email                    | Password    |
| ------- | ------------------------ | ----------- |
| Student | `en108953@foe.sjp.ac.lk` | `pes@123`   |
| Admin   | `admin@foe.sjp.ac.lk`    | `admin1234` |

All 163 Batch 7 students share the email format `en{registrationNumber}@foe.sjp.ac.lk` and the password `pes@123`.

---

## Academic Rules Implemented

Rules are taken directly from the **Faculty Handbook 2026**, Faculty of Engineering, USJ:

- **80% CCR Attendance Requirement** — Students with less than 80% attendance are flagged as non-eligible
- **14-Day Medical Certificate Window** — Automated deadline tracking for excused absence submissions
- **GPA Computation** — Credit-weighted SGPA and CGPA using the faculty's exact grade point values
- **Department Assignment Post Year 1** — Students remain `Inter-departmental` through Year 1; department selection occurs after Year 1 GPA ranking
- **Minor Categories** — Data Management and High Performance Computing mapped to correct courses
- **Add/Drop Period** — 14-day enrollment window enforced

---

## Branches

| Branch                 | Purpose                           |
| ---------------------- | --------------------------------- |
| `main`                 | Production-ready code             |
| `feature/admin-panel`  | Admin panel development (current) |
| `feature/ai-assistant` | AI integration                    |

---

## Project Status

| Phase                                | Status      |
| ------------------------------------ | ----------- |
| Database schema + RLS                | ✅ Complete |
| Real Batch 7 data migration          | ✅ Complete |
| Student auth accounts (163 students) | ✅ Complete |
| Authentication + role-based routing  | ✅ Complete |
| Student dashboard                    | ✅ Complete |
| Attendance page                      | ✅ Complete |
| Results page                         | ✅ Complete |
| Courses page                         | ✅ Complete |
| Enrollment page                      | ✅ Complete |
| Profile page                         | ✅ Complete |
| Admin panel (5 pages)                | ✅ Complete |
| Year 2 & 3 department data           | ⏳ Pending  |
| AI assistant (Claude API)            | ⏳ Planned  |
| CART prediction model                | ⏳ Planned  |
| Deployment                           | ⏳ Planned  |

---

## Faculty Reference

This system is built in accordance with the regulations set out in the **Faculty Handbook 2026**, Faculty of Engineering, University of Sri Jayewardenepura. All grading scales, attendance policies, GPA computation formulas, and course structures are aligned with the official handbook.

---

## License

This project is developed as an academic project for the Data Management module (CO3554) at the Faculty of Engineering, University of Sri Jayewardenepura. All rights reserved.

---

_Faculty of Engineering | University of Sri Jayewardenepura | 2026_
