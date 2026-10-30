---
kicker: Study Guide 0  ·  read this first
title: Start Here
subtitle: A map of the guides, a reading order, and the words they use
intro: The Performance Evaluation System is described in seven numbered guides and two feature guides. This one says which guide answers which question, suggests an order for three different readers, and explains the terms every guide assumes you know. It takes ten minutes.
updated: Updated 30 October 2026  ·  describes the feature/UI branch on that date  ·  first written 30 October 2026
footer: PES Study Guide
---

# 1. The guides

<!-- widths: 34,66 -->
| Guide | It answers |
|---|---|
| 1 — System Overview | What PES is, who uses it, what it is built from, how one request travels from a click to the database, how big it is, and what has changed. |
| 2 — Database | Every table and what it holds, how they connect, the rule settings, the views, the storage buckets, the extensions, the scheduled job, and every function by area. |
| 3 — Login, Roles and Permissions | How signing in works, how a role is decided, how routes are guarded, and an account's life: invited, set up, reset, deactivated. |
| 4 — Security and Row Level Security | How the database refuses what it should refuse, who can see what, how the Edge Functions guard themselves, what reviews found, and how to test a rule yourself. |
| 5 — Features and Data Flows | Each feature step by step: enrolment, attendance, results, feedback, medical certificates, mentoring, the Graduation Planner, the assistant, batches and accounts, dashboards and notifications. |
| 6 — Code Structure | How the React app is organised: routes, layouts, contexts, services, the design system and its tokens, conventions, and how to add a page. |
| 7 — Configuration and Operations | Every setting and secret and where it lives, deploying the site and the functions, the nightly job, migrations, scripts, health checks, and the release checklist. |
| The AI Assistant | The assistant end to end: the page, the server, the tool loop, the fourteen tools, the Handbook and website search, the models, the limits, and how to change it. |
| RAG and the 14 tools, explained | The same assistant in plain English, for a reader who has never met the words RAG or tool calling. |

Beside the guides, three Markdown files go deeper on one thing each: `local-llm.md` (running the assistant on a faculty computer), `ui-ux-audit.md` (the audit of every screen behind the October redesign, and what was done) and `README.md` (the same list as this page, for GitHub).

# 2. Three ways to read them

**To understand the system as a whole** — a supervisor, an examiner, a new member of staff:

1. Guide 1, all of it.
1. Guide 5, sections 2 to 8 — the features you know from using it.
1. Guide 4, sections 1 and 2 — why the browser can be trusted with nothing.
1. The RAG guide, for the assistant.

**To work on the code** — a developer joining the project:

1. Guide 1, then Guide 3, then Guide 4 — the ideas the tables only make sense in light of.
1. Guide 2 — the tables and functions, with the database open beside you.
1. Guide 6 — the app — and then Guide 5 for the feature you are changing.
1. Guide 7 before your first deploy, and the AI guide before touching the assistant.

**To run it** — whoever looks after PES once it is live:

1. Guide 1, sections 3 and 7.
1. Guide 7, all of it, with section 11 as a checklist.
1. Guide 3, section 8 — accounts — and Guide 5, section 10 — batches.
1. Guide 4, sections 5 to 8 — what has gone wrong before, and how to check.

# 3. The words the guides use

## 3.1 The academic words

<!-- widths: 26,74 -->
| Word | Meaning in PES |
|---|---|
| Batch, intake | Every student who started in the same year (`batch_year`). Batch 1 is the 2015 intake, so the 2022 intake is Batch 8. |
| Semester | One of the degree's eight. A student's current semester is worked out from their batch, never stored. |
| Course, module | A unit in the catalogue, such as CO3554 Data Management Project. The guides use both words. |
| Offering, delivery | A course taught to one batch in one academic year. Lecturers, attendance and results belong to an offering. |
| Credits, GPA credits | A course's weight. GPA credits are those of courses that count towards the GPA; a few courses are recorded but not counted. |
| Grade, grade point | The letter the examiners award (A+ to F, plus R and L), and its value (A+ and A are 4.0 … C is 2.0; F, R and L are 0). |
| SGPA, CGPA, OGPA | The credit-weighted average of grade points: for one semester, for everything so far, and for the whole degree at the end. |
| R, F, L | R: re-sit the exam (continuous assessment carried forward). F: repeat the whole course. L: deferred after an approved medical. R and F are capped at C. |
| Class of honours | First (CGPA 3.70), Second Upper (3.30), Second Lower (3.00), Pass (2.00). |
| Dean's List, gold medal | Handbook honours: an SGPA of 3.80 in a semester; an OGPA of 3.80 in four years with no course repeated. PES shows them as targets and checks; it does not award them. |
| Minor | A specialisation inside a degree, claimed by 20 credits from the department's study plan of baskets. |
| Basket | A group of courses in one semester from which a student must take a minimum number of credits. |
| Course taught over two semesters | A course with two parts under one code and one grade at the end, such as the Engineering Project (CO4002). |
| Enrolment window | The dates a batch may enrol, opened (and extendable) by the super admin. |
| Feedback round | A period in which students answer a course feedback form, mid-semester or end-semester. |

## 3.2 The people

<!-- widths: 26,74 -->
| Word | Meaning in PES |
|---|---|
| Student | An undergraduate; sees only their own record. |
| Lecturer | Teaching staff; sees the offerings they teach and their own mentees. |
| Head of department (HOD) | A lecturer holding an appointment, not a role of its own; sees their department. |
| Department admin | A department office; administers one department. |
| Super admin | The faculty office; everything in the faculty, and the things only the faculty does. |
| Mentor, mentee | Every student has a lecturer as mentor, with a private chat; the mentor's notes are theirs alone. |

## 3.3 The technical words

<!-- widths: 26,74 -->
| Word | Meaning |
|---|---|
| Supabase | The hosted platform PES runs on: a PostgreSQL database with sign-in, file storage, live updates and small server functions. |
| PostgreSQL | The database. PES's version is 17. |
| Row Level Security (RLS) | A database feature that filters each table's rows by who is asking. In PES it is the main security mechanism, because the browser talks to the database directly. |
| Policy | One RLS rule on one table: who may read, add, change or remove which rows. |
| RPC, database function | A function stored in the database and called from the browser by name (`supabase.rpc('get_my_mentees')`). Most screens get their data this way. |
| SECURITY DEFINER | A function that runs with its owner's privileges, so it can read what the caller cannot — and must therefore check the caller itself. |
| Trigger | A function that runs by itself when a table is written: deriving a grade point, writing a notification. |
| Migration | One recorded change to the database, saved as a numbered SQL file in `supabase/migrations/`. |
| Edge Function | A small server function beside the database, for the jobs a browser must never do: holding a secret key, creating accounts, sending email, reading a website on a schedule. |
| Service role | The all-powerful database key that ignores RLS. Only Edge Functions hold it. |
| Anon key | The public key every browser holds. It identifies the project, not a person. |
| Token, JWT | The signed proof of who is signed in, sent with every request. |
| Realtime | Supabase's live channel: a new chat message or notification arrives without a reload. |
| pg_cron, pg_net, Vault | The database's scheduler, its way to make a web request, and its store of secrets — together, the nightly website read. |
| pgvector, embedding | A way to store a passage's meaning as a list of numbers and find passages near in meaning: half of the Handbook search. |
| RAG | Retrieval-augmented generation: looking up relevant passages first and answering from them. |
| Tool calling | Letting a language model ask for a named function to be run and answer from the result. |
| Vite, React, TypeScript | The build tool, the interface library and the typed JavaScript the app is written in. |
| Vercel | The host that builds and serves the app from the `main` branch. |

# 4. What to have open

- **The app**, signed in as a test student and a test lecturer, so each guide's screens can be seen as you read.
- **The repository**, at the `feature/UI` branch, for the code the guides name.
- **The Supabase dashboard** for the project `pes-faculty-engineering`: the Table Editor and SQL editor for Guide 2, Authentication and Edge Functions for Guides 3 and 7.
- **The Faculty Handbook 2026**, for the rules the system enforces.

> The guides describe the system on 30 October 2026, and the `feature/UI` branch in particular: the October redesign is there, and reaches the live site when that branch is merged. Every figure in them was taken from the live database on that date.
