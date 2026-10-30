---
kicker: Study Guide 2 of 7
title: Database Guide
subtitle: Every table, what it holds, and how they connect
intro: The PES keeps everything in one PostgreSQL 17 database: 49 tables, 248 functions, a view and the files beside them. This guide walks through them area by area, in the order the academic year actually happens: people, then courses, then enrolment, attendance and results, then everything that hangs off them.
updated: Updated 30 October 2026  ·  figures from the live database on that date  ·  first written 10 September 2026
footer: PES Study Guide
---

# 1. How to think about this database

Do not start by reading all 49 tables. Start with the four ideas that shape them.

**Idea 1 — A course is not the same as a course being taught**

A row in `courses` is a module in the catalogue: CO2206 Software Engineering, 3 credits, semester 4. It does not belong to a year or a group of students.

A row in `course_offerings` is that module actually being delivered: CO2206 to the 2023 batch in academic year 2025/2026. Lecturers are assigned to offerings, not to courses, and attendance and results belong to an offering too.

:::why WHY THIS MATTERS
The same module is taught every year to a different group by possibly a different lecturer. If lecturers were attached to the course itself, last year's teaching history would be destroyed every time a new lecturer took over. Keeping offerings separate preserves the record.
:::

**Idea 2 — Identity is split across three tables**

A person is in `students`, `lecturers` or `admins` — never more than one. Their sign-in account lives in Supabase's own `auth.users`, and the row in one of the three tables is what gives that account an academic meaning. Guide 3 explains why, and the fixed order in which they are searched.

**Idea 3 — Nothing is deleted**

When a lecturer stops teaching a module, the assignment row is marked inactive. When a headship ends, the appointment row gets an end date. When a student changes batch, a change row is written. When an account is switched off, it is deactivated, not removed. History is kept because results, feedback and attendance all point back at it. The one deliberate exception is removing a whole batch that has left the faculty (section 2.6), and even that offers an export first.

**Idea 4 — The database decides, and the database derives**

A grade point is never typed: a trigger derives it from the grade. A notification is never written by a page: a trigger writes it. A student's current semester is never stored: a function works it out from their batch. Wherever a value can be derived from another, it is, so the two can never disagree.

# 2. People and accounts

## 2.1 students

167 rows. One per undergraduate.

<!-- widths: 22,78 -->
| Column | What it holds |
|---|---|
| id | Same value as the Supabase Auth user id. This is what makes the whole security model work. |
| reg_number | Registration number, stored as bare digits (`108953`); the app prints it as EN108953. |
| index_number | Index number, e.g. 22/ENG/079. |
| name, email | Personal details. |
| department | One of the four degree departments, or empty for a first-year intake that has not been divided yet. |
| batch_year | The year the student started. Their semester is calculated from this. |
| role | Always the text 'student'. Enforced by a check constraint. |
| status | active, withdrawn, transferred or graduated. |
| avatar_url | Profile picture, stored in the avatars bucket. |

> Notice there is no 'semester' column. A student's current semester is worked out from batch_year by `current_semester_for_batch()`. Storing it would mean updating 167 rows every semester and getting it wrong once.

## 2.2 lecturers

41 rows. Teaching staff.

<!-- widths: 22,78 -->
| Column | What it holds |
|---|---|
| id | The lecturer's own id, used everywhere teaching is recorded. |
| auth_user_id | Their Supabase Auth id. Separate from id, and nullable — a lecturer can exist in the records before they ever get a login. |
| name, title, email, staff_no | Personal and staff details. A lecturer may change their own title and name, nothing else. |
| department | Their home department. |
| status | active or inactive. |
| avatar_url | Their profile photo. |

:::warn A SECURITY NOTE ABOUT THIS TABLE
Until 9 September 2026 every signed-in user could read all 41 rows including auth_user_id. That is now restricted to the person's own row; everyone else reads lecturers through functions that return only what the screen needs. Guide 4 explains what went wrong and how it was fixed.
:::

## 2.3 admins

7 rows. Administrative staff.

<!-- widths: 22,78 -->
| Column | What it holds |
|---|---|
| id | Their Supabase Auth id. |
| role | Either dept_admin or super_admin. Enforced by a check constraint. |
| department | Which department they administer. Empty for the super admin. |
| status | active or inactive. |
| name, email, avatar_url | The name they are shown by and their photo, which they can change themselves (`update_my_admin_profile`). |

## 2.4 hod_appointments

5 rows. Who leads which department, and when.

Key columns: `lecturer_id`, `department`, `valid_from`, `valid_to`, `is_active`, plus who assigned and who ended it.

A department can have only one active appointment at a time. Ending one and starting another is done by a single function (`set_department_hod`) so the two can never both be active, and a trigger refuses an appointment to a department the lecturer does not belong to.

## 2.5 The account tables

Added on 2 October 2026 for invitations, password resets and deactivation. Nobody can read them through the API — not even the super admin. Only the `account` Edge Function, which runs with the service role, touches them.

<!-- widths: 28,72 -->
| Table | What it holds |
|---|---|
| account_tokens | One row per emailed link: whose account, what for (`invite` or `reset`), a SHA-256 hash of the token (never the token itself), who issued it, when it expires and when it was used. 72 hours for an invitation, 60 minutes for a reset. |
| account_deactivations | One row per account that is switched off: when, by whom and why. Deleting the row reactivates it. |
| account_request_log | Every reset request, with what was asked for, so requests can be rate limited per account and per address. |

> Storing only a hash means a copy of the table cannot be used to sign in as anyone: the token in the email is the only place the secret exists.

## 2.6 Batches

A batch is not a table of its own. It is every student who shares a `batch_year`. The super admin's tools work on that set as a whole:

- `get_batches()` lists every batch with its size, its semester and how its students divide between departments.
- `assign_batch_departments()` records the faculty's division of a first-year intake, one registration number and department per row.
- `get_batch_footprint()` counts what removing a batch would delete, so the screen can say it before anyone confirms.
- `export_batch_records()` returns the batch's students, results, enrolments and attendance to keep as a spreadsheet first.
- The `manage-batches` Edge Function creates the sign-in accounts for an intake and deletes them for a batch that has left. Course feedback survives the removal anonymously, because `feedback_submissions.student_id` now lets go to empty rather than refusing.

`student_batch_changes` (0 rows) is the audit trail for a single student moving batch, written only through `change_student_batch()`; a trigger refuses any other route.

# 3. Courses and teaching

## 3.1 courses

232 rows. The catalogue.

<!-- widths: 26,74 -->
| Column | What it holds |
|---|---|
| course_code, title | For example CO2206, Software Engineering. |
| credits | Credit value of this course (or of this part of a course). |
| semester, year | Where it sits in the degree. |
| department | Which department owns it. |
| category | Compulsory, Elective, or similar. |
| minor_category | Which minor stream it counts toward, if any (the study plan in section 3.5 is now the authority). |
| contributes_to_gpa | False for modules that are recorded but not counted. |
| ca_weight, ese_weight | How the overall mark is split. Usually 0.30 and 0.70. |
| graded_with | Set on the first part of a course taught over two semesters: the later part that carries the one grade. |
| result_credits | The weight a published result carries in every GPA: the course's own credits, plus those of any earlier part graded with it, and 0 for the earlier part itself. Kept up to date by triggers, never typed. |

:::why A COURSE TAUGHT OVER TWO SEMESTERS (28 OCTOBER 2026)
Some courses are delivered in two parts under one code and graded once at the end. Computer Engineering's minor projects are 3 credits in Semester 6 and 2 in Semester 7 with one grade in Semester 7; the Engineering Project, CO4002, is 4 credits in Semester 7 and 6 in Semester 8 with one grade in Semester 8. The catalogue keeps both parts, because that is how the Handbook prints the curriculum and how students enrol. `graded_with` says the first part never has a result of its own; `result_credits` makes the final grade count for all the credits, once, in the semester it is awarded. For every other course `result_credits` equals `credits`, so no existing figure changed.
:::

## 3.2 course_offerings

131 rows. A course, delivered to a particular batch in a particular year.

Columns: `course_id`, `academic_year`, `semester`, `batch_year`, `department`, `status` (active or archived).

## 3.3 course_lecturers

25 rows. Which lecturer teaches which offering.

<!-- widths: 30,70 -->
| Column | What it holds |
|---|---|
| offering_id, lecturer_id | The link itself. |
| assignment_role | lecturer or coordinator. An offering may have only one active coordinator. |
| is_active | False once the assignment ends. The row is kept. |
| assigned_by, assigned_at, ended_by, ended_at | Who did what, and when. |

## 3.4 curriculum_slots

336 rows. What the Handbook says a department's degree must contain: which module sits in which semester, which basket it belongs to, and how many credits that basket requires. This is what the Graduation Planner and enrolment compare a student against. `elective_credit_norms` (8 rows) holds the credits each department expects from its elective baskets.

## 3.5 Minors: the study plan

Added on 1 October 2026. The department's "Minors — Study Plan" sets each minor out as a table: for Semesters 5 to 8, a few baskets of courses, each with a minimum number of credits, and in every semester one course (printed in red) the minor cannot do without. Twenty credits claim the minor.

<!-- widths: 28,72 -->
| Table | What it holds |
|---|---|
| minor_requirements (2 rows) | Each minor a department offers, and the credits that claim it. |
| minor_plan_baskets (16 rows) | One basket of one minor in one semester: its place in the table, the minimum credits, and whether it is the mandatory one. |
| minor_plan_courses (25 rows) | The courses in a basket, with the credits the plan counts for them there. |
| student_minor_choices (1 row) | Which minor a student has said they are taking, so enrolment can warn before they leave out its mandatory course. |

Both plan tables hang off `minor_requirements` with cascading keys, so renaming or removing a minor (`rename_minor`, `delete_minor`) carries its plan with it. The head of department edits the plan on the Course Catalogue page.

# 4. Enrolment

## 4.1 enrollment_periods

1 row. An enrolment window: a title, an academic year, a semester, a batch, a department, an opening time, a closing time and optional instructions for students.

Status moves through draft, scheduled, open, closed, archived. Students can only enrol while a window covering their module is open. Only the super admin writes windows; since 29 October 2026 an open window can be extended to a later closing time, and the students it covers are told. `enrollment_period_courses` (0 rows) narrows a window to particular courses when needed.

## 4.2 enrollments

5,656 rows. The single most important table for the academic record after results.

<!-- widths: 26,74 -->
| Column | What it holds |
|---|---|
| student_id, course_id | Who is taking what. |
| academic_year | Which year they are taking it in — the year of the semester that offers it, not the course's nominal year (fixed on 1 October 2026). |
| status | enrolled, dropped or completed. |
| enrollment_kind | regular, repeat_r, repeat_l or repeat_f. This is the interesting one. |
| enrolled_with_batch | Which batch they are sitting with. A repeating student often sits with the batch below. |

**The four enrolment kinds**

<!-- widths: 13,18,51,18 -->
| Kind | Meaning | What the student must do | Grade cap |
|---|---|---|---|
| regular | Normal first attempt | Follow the module normally | None |
| repeat_r | Carrying an R grade | Re-sit the end-of-semester exam only. The continuous assessment mark is carried forward. | C |
| repeat_f | Carrying an F grade | Follow the whole module again, continuous assessment included. | C |
| repeat_l | Carrying an L grade (approved medical) | Take the module again | None |

:::warn A RULE THAT WAS MISSING UNTIL 9 SEPTEMBER
Until 9 September 2026 only R and L had an enrolment path. A student carrying an F had no way to enrol and therefore no way to clear the module. repeat_f was added to close that gap, and the grade cap now applies to R and F but not to L.
:::

# 5. Attendance

Attendance is recorded two ways: a live session students check into, or a register marked by hand. Both end up in the same table.

Attendance belongs to a delivery, not to a course. Every row carries the offering it was taken in, whoever marked it, and every percentage is counted per offering. A student who repeats a course therefore has one register per attempt, and the attempt being sat now is the one that decides eligibility.

## 5.1 attendance

The final record. One row per student, per course, per lecture date.

<!-- widths: 32,68 -->
| Column | What it holds |
|---|---|
| student_id, course_id, lecture_date | Together these are unique. One student cannot have two records for the same lecture. |
| status | present, absent or excused. |
| method | How it was recorded. |
| excused_via_submission_id | Points at the medical submission that excused this absence, if any. |
| offering_id, recorded_by | Which delivery, and who recorded it. A trigger fills the offering when a writer leaves it out. |

## 5.2 The live session tables

<!-- widths: 36,64 -->
| Table | What it is for |
|---|---|
| attendance_sessions | An open window. Holds a secret, a rotation interval, and optionally a location and radius so check-ins can be limited to the lecture hall. |
| attendance_checkins | A student's check-in, with device hash and coordinates. |
| attendance_presence_checks | A surprise 'are you still here?' prompt the lecturer can fire mid-lecture. |
| attendance_presence_responses | Who answered that prompt. |

> The rotating code is why a student cannot send a screenshot of the QR code to a friend outside the hall. The code changes every few seconds, and it is computed from the session secret (`attendance_window_code`) rather than stored, so reading the table would not help either.

# 6. Results

## 6.1 results

7,392 rows and 26 columns — the widest table in the system. The width is not carelessness; each group of columns records a different stage of the workflow.

**The marks**

<!-- widths: 22,78 -->
| Column | What it holds |
|---|---|
| mid_sem_mark, ca_mark | Continuous assessment marks. |
| ese_mark | End of semester exam mark. No longer entered since 11 September 2026. |
| oa_mark | Overall mark. No longer entered: the grade is awarded by the examiners, not computed from marks. |
| grade | The letter grade the examiners awarded, chosen from the faculty scale. |
| gpv | The grade point value. Derived from the grade by a trigger on every write, never typed, and a grade off the scale is refused. |

**The workflow**

<!-- widths: 30,70 -->
| Column | What it holds |
|---|---|
| status | draft, submitted or published. |
| offering_id | The delivery the result belongs to. |
| entered_by | The lecturer who entered the sheet. |
| submitted_by, submitted_at | Who sent it for approval, and when. |
| returned_by, returned_at, return_notes | If the department sent it back, who and why. |
| is_published, published_at, published_by | The moment the student can finally see it. |

**Repeats**

A resit of the same delivery updates the row in place and is capped at C. Repeating the course with a later batch is a new delivery and a second row. Both rows stay, but the earlier attempt no longer carries a grade point once a later one exists (the trigger `settle_repeated_attempts`), so the course counts once in every GPA, credit total and risk band. The trigger `results_derive_grade_point` is the one place that decides a grade point, and `results_refuse_ungraded_part` refuses a result for the first part of a two-semester course.

**Corrections**

If a published grade has to change, `correct_result_grade()` keeps the original in `original_grade` and records the change in `corrected_by`, `corrected_at` and `correction_reason`. A correction never silently overwrites history.

:::why THE RULE THIS TABLE EXISTS TO ENFORCE
A student may not see a grade before it is published. That is not a preference — it is the reason results are read through functions rather than straight from the table, and why the `my_published_results` view exists.
:::

## 6.2 The view

<!-- widths: 30,70 -->
| View | What it is |
|---|---|
| my_published_results | The signed-in student's published results only. A security-barrier view, so a cleverly written query cannot see past its filter. |

# 7. Feedback

Feedback has more moving parts than it first appears: a round has to be requested or created, approved, shaped per course, filled in, and then reported on without ever exposing who said what.

<!-- widths: 32,10,58 -->
| Table | Rows | What it is for |
|---|---|---|
| feedback_periods | 1 | A feedback round: title, dates, department (empty for a faculty-wide round), batch, type (mid or end semester), and its approval state. |
| feedback_questions | 49 | The question bank, including each course's own questions once a lecturer has shaped its form. |
| feedback_period_questions | 49 | Which questions this round uses, in which sections and order. |
| feedback_period_courses | 6 | Which courses this round covers. |
| feedback_submissions | 3 | One student's response to one course in one round. Carries the is_anonymous flag. Lets go of the student when a batch is removed. |
| feedback_answers | 155 | The individual answers: rating, text, single choice or multiple choice, per lecturer where the question is about each lecturer. |

**How a feedback round is approved**

A lecturer can request a round. It starts as `status = draft` and `approval_status = pending`. A department admin approves or rejects it (`decide_feedback_period`). A round the department office creates itself needs no approval. Opening the round is also its release.

**How anonymity is protected**

- A submission can be marked anonymous, and the reports never join back to the student.
- The setting `feedback_min_responses_for_analytics` decides how many responses a course needs before anyone can see its analytics. The Faculty value is 5, which stops a class of three being effectively de-anonymised. It is set to 1 while PES is tested by a single developer, and must go back to 5 before students are asked to answer.
- Comments are read through a separate function from the ratings, so releasing one does not release the other.

# 8. Medical certificates

Three tables. The design point is that a certificate is approved per module, not as a whole.

<!-- widths: 34,66 -->
| Table | What it is for |
|---|---|
| medical_submissions | The submission: student, dates missed, reason type, description, deadline, and overall status. |
| medical_submission_courses | One row per module the certificate is claimed against, each with its own review_status, reviewer, notes and department. |
| medical_submission_files | The uploaded certificate files, held in a private storage bucket. |

This is why the parent status can be partially_approved or mixed. An admin can accept the certificate for two modules and reject it for a third.

An approval writes back into attendance: the affected rows become excused and point at the submission through `excused_via_submission_id`.

# 9. Mentoring

<!-- widths: 26,10,64 -->
| Table | Rows | What it is for |
|---|---|---|
| mentor_assignments | 50 | Which lecturer mentors which student, with start, end and reason. |
| mentor_messages | 17 | The chat. Sender role, body, sent time, read time, and optional file attachment. Streamed live through Realtime. |
| mentor_notes | 1 | The mentor's private notes. The student can never see these. |

:::why THE PRIVACY LINE INSIDE MENTORING
Messages are visible to both people in the thread. Notes are visible only to the mentor who wrote them. These are two separate tables with two separate policies precisely so the line cannot be blurred by a mistake in one query.
:::

# 10. The Graduation Planner's own tables

Added on 28 October 2026. Everything the planner *calculates* comes from results and the curriculum through `get_my_graduation_plan()`; these two tables only remember what a student chose.

<!-- widths: 26,10,64 -->
| Table | Rows | What it holds |
|---|---|---|
| planner_scenarios | 5 | A named what-if: the grades a student expects this semester (`guesses`), the SGPA they plan for later semesters (`plans`), past grades tried differently (`past`), and whether it is shared with their mentor. A student keeps at most ten, enforced by a trigger. |
| planner_aims | 3 | The class of honours the student is aiming for, so the planner opens on it next time. |

A shared scenario is what the mentor sees on the mentee's page (`get_mentee_graduation_plan`). Nothing in either table ever changes a result.

# 11. Communication

<!-- widths: 26,10,64 -->
| Table | Rows | What it is for |
|---|---|---|
| notifications | 806 | One row per event addressed to a person: a result published, a register opened, a mentor message, a semester's results complete. Written only by database triggers and a few functions; read and marked read by the recipient. Carries the department it comes from, so the list can wear its colour. |
| notices | 1 | The notice board. Scope columns (department, batch, offering) are empty when a notice is not narrowed by them, so a notice with no department is faculty-wide. |
| notice_categories | 9 | The categories a notice can carry. Adding a row is enough to add a category. |
| notice_attachments | 1 | Documents attached to a notice, held in the private notice-attachments bucket. |

# 12. The assistant's knowledge

<!-- widths: 26,10,64 -->
| Table | Rows | What it holds |
|---|---|---|
| handbook_chunks | 131 | Pieces of the Faculty Handbook, each with a 384-number vector embedding (pgvector, in the extensions schema), a full-text index and its page number. |
| faculty_site_pages | 67 | The website reader's memory: every page of eng.sjp.ac.lk it has found, whether and when it was read, the HTTP status, and a hash of its text so an unchanged page is not rewritten. |
| faculty_site_chunks | 121 | What is searched: each page's main text in sections, with the page's address so an answer can link to it, and a full-text index. |
| ai_assistant_usage_log | 77 | One row per question asked, used to enforce the daily limits. Readable by the super admin only. |

# 13. The regulation engine: system_settings

18 rows. The Handbook's rules as data. Values are JSON, so a number, a list or a table of thresholds can all live here. A setting is read in one of two places: by database functions (which is what makes it binding), or by the app through `src/lib/settings.ts` (which is what the screens show). The third column says which.

<!-- widths: 33,24,43 -->
| Setting | Value | Read by |
|---|---|---|
| attendance_threshold | 80 | Database: `get_my_attendance_detail`, `get_my_insights`, `get_my_mentees`. App: every attendance screen. |
| attendance_prewarning_threshold | 85 | Database: `get_my_attendance_detail`, `get_my_insights`. App: the amber warnings. |
| graduation_total_credits | 144 | Database: `graduation_plan_for`. App: standing and the planner. |
| total_semesters | 8 | Database: `get_my_academic_record`, `graduation_plan_for`. App: semester lists. |
| gpv_scale | A+ 4.0 … C 2.0, F/R/L 0 | Database: the grade-point trigger, `grade_point_value`, `correct_result_grade`, `cap_resit_grade`. App: the planner. |
| honours_classifications | First 3.70, Second Upper 3.30, Second Lower 3.00, Pass 2.00 | Database: `nudge_semester_complete`, `get_my_mentees`. App: standing, targets, the planner. |
| resit_max_grade | C | Database: `cap_resit_grade`, `graduation_plan_for`. |
| grade_boundaries | A+ from 85 … C from 45 | App: the order of the grade distribution on Results. |
| oa_weights | CA 0.30, ESE 0.70 | App: the default split when a course is created. |
| feedback_min_responses_for_analytics | 1 (5 before release) | Database: `feedback_privacy_threshold`, behind every analytics function. |
| gpa_decline_alert_drop | 0.30 | Database: `get_my_insights`, for the "your SGPA fell" insight. |
| first_batch_intake_year | 2015 | App: batch numbering (Batch 1 is the 2015 intake). |
| student_departments | Civil, Computer, Electrical and Electronic, Mechanical | App: department pickers on the admin screens. |
| interdisciplinary_department | Interdisciplinary Studies | App: the department whose courses every student may take. |
| medical_submission_deadline_days | 14 | Loaded by the app but not used: the Medical Certificates page writes 14 into its own code. |
| feedback_text_max_length | 1500 | Loaded by the app but not used: the feedback form caps a written answer at 1,000 characters in its own code. |
| student_visible_result_fields | mid_sem_mark, ca_mark, grade, gpv | Read by nothing. The student result functions do return only these (never the exam or overall mark), but that is written into each function, not read from here. |
| feedback_release_mode | dept_admin_release | Read by nothing. A remnant: since 29 August 2026 opening a round is its release. |

:::warn FOUR SETTINGS THAT DO NOT DO WHAT THEIR NAMES SAY
Changing the last four rows changes nothing today. Two are written into page code (and one disagrees with it: 1,500 here, 1,000 on the form), and two are not read at all. Either wire them up or delete them; until then, change the code, not the setting.
:::

# 14. The function layer

There are 248 functions written for this application, on top of the tables. They are the reason the browser can talk to the database directly without the rules leaking.

<!-- widths: 24,12,64 -->
| Kind | How many | What it means |
|---|---|---|
| SECURITY DEFINER | 237 | Runs with the privileges of the function's owner, not the caller. It can see everything, so it must check for itself who is asking. Every one has its search path pinned. |
| SECURITY INVOKER | 11 | Runs as the caller. Row Level Security still applies to everything it touches. |
| Of which triggers | 37 | Fire on a write to a table; never called directly. |
| Callable by signed-in users | 194 | The application's API. |

**Why so many are DEFINER**

Because most useful answers need data the caller may not read directly. A student may see their own published grade but not the results table. A definer function can read the table, apply the publication rule, and hand back only what is allowed.

:::warn THE DANGER OF DEFINER, AND THE RULE THAT FOLLOWS
A definer function is powerful, so it must check the caller's role itself — and that check must fail closed. In September 2026 several of these checks were found to fail open when the role came back as NULL. Guide 4 explains the problem and the fix in detail. Since 27 September 2026 no application function can be called by a signed-out caller; the only exceptions today are five trigger functions added in October, which PostgreSQL will not run outside a trigger anyway (Guide 4, section 5.10).
:::

**The helper functions you will see everywhere**

<!-- widths: 40,60 -->
| Function | Answers |
|---|---|
| `get_my_role()` | What role is the caller? Returns empty text, never NULL. |
| `get_my_department()` | Which department does the caller administer? |
| `my_lecturer_id()` | Which lecturer row is the caller, if any? |
| `my_hod_department()` | Which department does the caller head, if any? |
| `is_active_hod_of(dept)` | Does the caller currently head that department? |
| `is_assigned_lecturer(offering)` | Does the caller teach that offering? |
| `is_my_mentee(student)` | Is that student the caller's mentee? |
| `can_view_student_record(student)` | May the caller see that student at all? |
| `my_account_active()` | Is the caller's account switched on? |
| `current_semester_for_batch(year)` | Which semester is that batch in now? |

## 14.1 Every function, by area

This is the whole list, so a name met in the code can be placed. The functions a page calls start with `get_` (reads) or a verb (writes); the `my_` ones answer about the caller.

<!-- widths: 24,76 -->
| Area | Functions |
|---|---|
| Who is asking | academic_year_for, account_has_password, account_is_active, batch_currently_in_semester, can_view_student_record, current_semester_for_batch, department_admin_ids, department_head_id, department_owns_student, get_avatar_urls, get_my_department, get_my_role, is_active_hod_of, is_assigned_lecturer, is_my_mentee, is_offering_staff, is_super_admin, my_account_active, my_current_semester, my_hod_department, my_lecturer_id, my_offering_ids, my_staff_department, set_my_avatar, student_department, student_has_is_course_link |
| Accounts, batches, profiles | admin_list_users, assign_batch_departments, change_student_batch, export_batch_records, get_batch_footprint, get_batches, get_student_batch_history, update_my_admin_profile, update_my_lecturer_profile |
| Courses and teaching | curriculum_gpa_credits, delete_course, end_department_hod, get_admin_offerings, get_assignable_lecturers, get_course_detail, get_course_enrolled_students, get_course_enrolment_counts, get_course_info, get_course_roster, get_courses_by_semester, get_department_students, get_department_teaching, get_faculty_lecturers, get_hod_history, get_my_teaching, get_offering_roster, get_upcoming_courses, my_coordinated_offering, offering_department, offering_for_student_course, offering_label, offering_lecturer_ids, offering_roster_ids, offering_student_count, offering_student_ids, set_department_hod |
| Minors | delete_minor, get_department_minor_plan, get_department_minors, get_my_minor_progress, may_manage_minors, rename_minor, set_my_minor, student_minor_plan |
| Enrolment | can_read_enrollment_period, delete_enrollment_period, enrollment_period_visible, enrollment_window_open_for_me, enrolment_kind_for_course, enrolment_oversight, get_enrollment_period_course_stats, get_enrollment_period_summary, get_my_enrolment_options, get_my_enrolment_plan, my_outstanding_modules, update_my_enrolment |
| Attendance | attendance_session_state, attendance_session_token, attendance_window_code, attendance_window_signature, check_in_to_lecture, check_in_with_code, close_attendance_session, confirm_presence, extend_attendance_session, get_admin_attendance_overview, get_my_attendance, get_my_attendance_detail, get_offering_attendance_summary, metres_between, my_open_attendance_sessions, my_pending_presence_check, my_unclosed_registers, open_register_for_offering, start_attendance_session, trigger_presence_check |
| Results and standing | calculate_gpa_target, correct_result_grade, get_academic_standing, get_admin_recent_results, get_all_students_academic_stats, get_my_academic_record, get_my_insights, get_my_published_result_sheets, get_pending_result_reviews, get_published_result_sheet, get_student_academic_record, get_student_course_result, get_student_results, grade_point_value, publish_offering_results, return_offering_results, submit_offering_results |
| Graduation Planner | get_mentee_graduation_plan, get_my_graduation_plan, graduation_plan_for, nudge_semester_complete, share_planner_scenario |
| Feedback | add_course_feedback_question, assert_can_edit_course_form, course_form_questions, decide_feedback_period, feedback_answer_provided, feedback_privacy_threshold, fork_course_form, get_admin_course_feedback_analytics, get_admin_feedback_comments, get_admin_feedback_periods, get_admin_feedback_summary, get_admin_question_feedback_analytics, get_course_feedback_report, get_course_form_editor, get_department_feedback_detail, get_department_feedback_overview, get_department_lecturer_feedback, get_my_coordinated_feedback, get_my_feedback_overview, get_pending_feedback_approvals, get_student_active_feedback_period, get_student_eligible_feedback_courses, get_student_feedback_catalogue, get_student_feedback_form, may_manage_round_form, missing_required_feedback, my_editable_feedback_offering, period_covers_course, remove_course_feedback_question, reorder_course_form_sections, save_course_form_question, save_feedback_draft, save_form_section, student_eligible_for_feedback, student_took_course, submission_belongs_to_me_fb, submit_course_feedback, write_feedback_answers |
| Medical certificates | get_admin_medical_submissions, get_my_medical_submissions, review_medical_submission_course, student_has_medical_submission_in_my_department, submission_belongs_to_me, submission_has_course_in_my_department |
| Mentoring | assign_student_mentor, clear_student_mentor, delete_mentor_note, get_department_mentor_allocations, get_department_mentor_roster, get_mentee_academic_overview, get_mentor_message, get_mentor_notes, get_mentor_thread, get_my_mentees, get_my_mentor, get_student_mentor_history, is_mentor_thread_participant, mark_mentor_thread_read, my_mentee_note_counts, my_mentee_unread, my_mentor_thread, my_unread_mentor_messages, save_mentor_note, send_mentor_message |
| Notices and notifications | can_edit_notice, can_publish_notice_scope, get_manageable_notices, get_my_notice_publishing_scope, get_my_notices, get_my_notification_counts, get_my_notifications, get_my_unread_notice_counts, get_my_unread_notification_count, get_notice, mark_notice_read, mark_notifications_read, notice_row_readable, notice_visible_to_me, notify_user, notify_users |
| Assistant and search | faculty_site_sync_key_ok, get_faculty_site_status, search_faculty_site, search_handbook, search_handbook_hybrid, search_handbook_text |
| Operations | export_migrations (writes the applied history out as migration files) |
| Triggers (37) | attendance_fill_offering, block_course_delete_with_history, cap_resit_grade, check_course_graded_with, courses_default_result_credits, enforce_batch_change_through_rpc, enforce_feedback_period_approval, hod_appointment_department_matches, notices_touch_updated_at, notify_course_assigned, notify_draft_form_ready, notify_enrolment_window, notify_feedback_changes, notify_medical_reviewed, notify_medical_submitted, notify_mentor_assigned, notify_mentor_message, notify_notice_created_published, notify_notice_published, notify_register_open, notify_register_reopened, notify_result_changes, pin_course_identity_columns, planner_scenarios_guard, prevent_lecturer_self_escalation, prevent_self_privilege_escalation, protect_lecturer_feedback_period, refresh_result_credits, results_derive_grade_point, results_fill_offering, results_refuse_ungraded_part, set_enrollment_period_updated_at, set_medical_submission_course_department, set_results_published_at, settle_repeated_attempts, sync_result_publication_state, validate_feedback_period_transition |

> To read any one of them: in the Supabase SQL editor, `select pg_get_functiondef('public.get_my_graduation_plan'::regproc);`. Its comment header in the migration that created it says why it exists.

# 15. Beyond the tables

## 15.1 File storage

Uploaded files do not go in the database. They go in Supabase Storage, which has four buckets.

<!-- widths: 24,12,64 -->
| Bucket | Public? | Holds |
|---|---|---|
| avatars | Yes | Profile pictures. Public because a profile picture is not private. Removing a photo removes the file too. |
| medical-certificates | No | Medical certificate files. Reachable only through a signed, expiring link. |
| mentor-attachments | No | Files sent inside a mentoring chat, up to 10 MB, of the common document and image types. Same protection. |
| notice-attachments | No | Documents attached to a notice, up to 20 MB. Readable by whoever may read the notice. |

> A private bucket means the file has no public URL at all. The application asks for a temporary signed link, and storage only issues one if the caller is allowed the file.

## 15.2 Extensions

<!-- widths: 26,20,54 -->
| Extension | Schema | Why it is here |
|---|---|---|
| vector (pgvector 0.8) | extensions | The Handbook embeddings and their similarity search. |
| pg_cron 1.6 | pg_catalog | The nightly faculty-website read. |
| pg_net 0.20 | extensions | Lets that nightly job make an HTTP call to the Edge Function. |
| supabase_vault | vault | Keeps the secrets the nightly job presents (the project URL and the sync key). |
| pgcrypto, uuid-ossp | extensions | Random ids, tokens and hashes. |
| pg_stat_statements | extensions | Query statistics for tuning. |

## 15.3 The scheduled job

One `pg_cron` job, `faculty-site-sync-nightly`, runs at `37 20 * * *` (UTC) — 02:07 in Sri Lanka. It reads the project URL and the sync key from the Vault and posts to the `faculty-site-sync` Edge Function, which reads the next round of pages. Guide 7 shows how to check it ran.

## 15.4 Realtime

Three tables are published to Supabase Realtime: `mentor_messages` (the live chat), `notifications` (the bell updates without a reload) and `attendance` (a register fills in while the lecturer watches). Realtime applies Row Level Security to what it pushes, so nobody is sent a row they could not have read.

# 16. Migrations

Every database change is a numbered file under `supabase/migrations/`. There are 276. The name is the date and time it was applied, followed by a short description of what it did, and `supabase/migrations/README.md` numbers them 001 to 276 with a line each.

```
20260830144759_a_mentors_notes_are_their_own.sql
20260909143200_a_guard_that_cannot_answer_must_refuse.sql
20260920160144_a_repeated_course_counts_once.sql
20260927052832_a_signed_out_caller_calls_nothing.sql
20261001055233_a_minor_is_the_study_plan_the_faculty_publishes.sql
20261028113540_a_course_taught_over_two_semesters_is_graded_once.sql
20261028202537_a_student_keeps_their_planner_scenarios.sql
```

Read in order, these files are the honest history of the database — including the mistakes and the fixes. If you ever wonder why a table looks the way it does, the answer is in one of these files, usually in its comment header.

> The very first tables (students, courses, enrollments, attendance, results, lecturers, medical_submissions, and two since removed) were made in the SQL editor before migrations were recorded, so the folder alone cannot rebuild the database from empty. Guide 7 shows how to take a full schema dump.
