# Performance Evaluation System (PES)

> An Intelligent Academic Management Platform with AI-Powered Insights

**Data Management Project (CO3554) — Faculty of Engineering, University of Sri Jayewardenepura**  
**Developer:** K.M.L.N. Senadheera | Index: 22/ENG/079 | Department of Computer Engineering

---

## What is PES?

PES is a web-based academic management platform built specifically for students of the Faculty of Engineering at USJ. Unlike existing systems that are purely administrative, PES is designed from the student's perspective — giving undergraduates real-time visibility into their academic performance, proactive warnings before problems occur, and an AI assistant that understands faculty regulations.

---

## Key Features

### For Students

- **Academic Dashboard** — Semester-wise CGPA, credit progress, and performance trends
- **Real-Time Attendance Monitoring** — Per-course attendance with 80% CCR threshold warnings
- **Results Viewer** — Published grades, GPV, and semester GPA across all completed semesters
- **Course Management** — View ongoing, completed, and available courses with minor category mapping
- **Course Enrollment** — Enroll in upcoming semester courses with seat availability tracking
- **AI Academic Assistant** — Ask academic questions in natural language; get answers grounded in the Faculty Handbook and your personal records
- **Result Prediction** — CART Decision Tree model predicts likely final grades from mid-semester and CA marks
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

| Layer              | Technology                                 |
| ------------------ | ------------------------------------------ |
| Frontend           | React 19 + TypeScript + Vite               |
| UI                 | Tailwind CSS + shadcn/ui + Framer Motion   |
| Charts             | Recharts                                   |
| Backend / Database | Supabase (PostgreSQL)                      |
| Authentication     | Supabase Auth (email + password)           |
| Security           | Row Level Security (RLS) policies          |
| AI Assistant       | Claude API (Anthropic) + RAG pipeline      |
| ML Prediction      | Python + Scikit-learn (CART Decision Tree) |
| Deployment         | Vercel (frontend) + Supabase (backend)     |

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
│   │   │   └── AppLayout.tsx
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx
│   │   │   ├── Attendance.tsx
│   │   │   ├── Results.tsx
│   │   │   ├── Courses.tsx
│   │   │   ├── Enrollment.tsx
│   │   │   ├── AIAssistant.tsx
│   │   │   ├── Profile.tsx
│   │   │   ├── Settings.tsx
│   │   │   └── LoginPage.tsx
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

| Table                 | Purpose                                |
| --------------------- | -------------------------------------- |
| `students`            | Student profiles and authentication    |
| `courses`             | Course catalogue with minor categories |
| `enrollments`         | Student-course enrollment records      |
| `attendance`          | Per-lecture attendance logs            |
| `results`             | Marks, grades, GPV per course          |
| `lecturers`           | Academic staff profiles                |
| `course_lecturers`    | Lecturer-course assignments            |
| `feedback`            | Student course/lecturer feedback       |
| `medical_submissions` | Medical certificate uploads            |
| `timetables`          | Semester timetable per course          |

Row Level Security (RLS) enforces that students can only access their own data.

---

## Getting Started

### Prerequisites

- Node.js 18+
- A Supabase project

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/performance-evaluation-system.git
cd performance-evaluation-system/pes_app

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Add your Supabase URL and anon key to .env.local
```

### Environment Variables

Create `.env.local` in the project root:

```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### Database Setup

Run the SQL scripts in Supabase SQL Editor in this order:

1. `sql/01_create_tables.sql` — Creates all 10 tables
2. `sql/02_rls_policies.sql` — Enables RLS and sets access policies
3. `sql/03_gpa_view.sql` — Creates the GPA summary view
4. `sql/04_dummy_data.sql` — Inserts sample data for testing

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

---

## Academic Rules Implemented

Rules are taken directly from the **Faculty Handbook 2026**, Faculty of Engineering, USJ:

- **80% CCR Attendance Requirement** — Students with less than 80% attendance are flagged as non-eligible
- **14-Day Medical Certificate Window** — Automated deadline tracking for excused absence submissions
- **GPA Computation** — Credit-weighted SGPA and CGPA using the faculty's exact grade point values
- **Minor Categories** — Data Management and High Performance Computing mapped to correct courses
- **Add/Drop Period** — 14-day enrollment window enforced

---

## Branches

| Branch                 | Purpose                 |
| ---------------------- | ----------------------- |
| `main`                 | Production-ready code   |
| `feature/admin-panel`  | Admin panel development |
| `feature/ai-assistant` | AI integration          |

---

## Project Status

| Phase                               | Status         |
| ----------------------------------- | -------------- |
| Database schema + RLS               | ✅ Complete    |
| Authentication + role-based routing | ✅ Complete    |
| Student dashboard                   | ✅ Complete    |
| Attendance page                     | ✅ Complete    |
| Results page                        | ✅ Complete    |
| Courses page                        | ✅ Complete    |
| Enrollment page                     | ✅ Complete    |
| Profile page                        | ✅ Complete    |
| Admin panel                         | 🔄 In Progress |
| AI assistant                        | ⏳ Planned     |
| CART prediction model               | ⏳ Planned     |
| Deployment                          | ⏳ Planned     |

---

## Faculty Reference

This system is built in accordance with the regulations set out in the **Faculty Handbook 2026**, Faculty of Engineering, University of Sri Jayewardenepura. All grading scales, attendance policies, GPA computation formulas, and course structures are aligned with the official handbook.

---

## License

This project is developed as an academic project for the Data Management module (CO3554) at the Faculty of Engineering, University of Sri Jayewardenepura. All rights reserved.

---

_Faculty of Engineering | University of Sri Jayewardenepura | 2026_
