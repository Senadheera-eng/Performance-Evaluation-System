---
kicker: Study Guide 5 of 7
title: Features and Data Flows
subtitle: What each part of the system does, step by step
intro: This is the practical guide. Each feature is described the same way: who uses it, which pages it lives in, what happens in order, and which rules the system enforces along the way.
updated: Updated 30 October 2026  ·  describes the feature/UI branch on that date  ·  first written 10 September 2026
footer: PES Study Guide
---

# 1. How to read this guide

Every feature below follows the same four-part shape:

- **Who uses it** — the roles involved.
- **Where it lives** — the page files and the database functions.
- **The flow** — what happens, in order.
- **The rules** — what the system will refuse to do, and why.

# 2. Enrolment

**Who:** students enrol; the super admin opens the windows; department admins and heads of department watch them, read-only.

**Where:** Enrollment.tsx (with OutstandingModules, SemesterBaskets, MinorSelection and EnrolmentWindow), AdminEnrollment.tsx, HodEnrollment.tsx.

## 2.1 The flow

1. The super admin creates an enrolment window for a batch, department and semester, with an opening and closing time and optional instructions. It moves from draft to open. Only the super admin can write windows; a window that never opened can be deleted, and an open one can be extended to a later closing time (since 29 October 2026), which tells the students it covers.
1. The student opens the Enrollment page. It calls `get_my_enrolment_options()`, which returns every module they may take right now.
1. The page shows the semester's baskets — the compulsory courses, and each elective basket with the credits it asks for — and, separately, outstanding modules they still owe from an earlier attempt.
1. A student in a semester with minors picks their minor from the department's study plan. The page draws the plan's table for that semester and warns, in red, if the minor's mandatory course is left out (`set_my_minor`, `student_minor_plan`).
1. The student ticks and unticks. Nothing is saved yet; the changes are held in the browser.
1. They press save. One call to `update_my_enrolment(p_add, p_remove)` applies everything at once, recording each course under the academic year of the semester that offers it.

## 2.2 Outstanding modules

A student who did not pass a module has to take it again, normally with the batch below. There are three kinds, and the system keeps them visually separate because the obligations genuinely differ.

<!-- widths: 16,22,43,19 -->
| Kind | Shown as | What the student must do | Best grade |
|---|---|---|---|
| repeat_r | Re-sit Modules (R) | Re-sit the end-of-semester exam only. The continuous assessment mark carries forward. | C |
| repeat_f | Repeat Modules (F) | Follow the whole module again, continuous assessment included. | C |
| repeat_l | L-Grade Modules (L) | Take the module again after an approved medical. | No cap |

:::why WHY THEY ARE KEPT APART ON SCREEN
A student looking at one mixed list cannot tell which rule applies to which module. Re-sitting an exam and repeating a whole course are different amounts of work, and one is capped while the other is not. Separating them is a correctness decision, not a decorative one.
:::

## 2.3 The rules

- A module only appears if a window carrying it is open right now.
- A student may withdraw while the window is open — but not once a mark has been recorded against that sitting.
- The academic year and the batch a repeat is sat with are decided by the window, not by the student.
- The grade cap for R and F is applied by the database when the grade is recorded, not by the interface.
- Department offices and heads of department watch windows and their numbers (`enrolment_oversight`, `get_enrollment_period_summary`) but cannot open, change or extend them.

> Until 9 September 2026 there was no repeat_f. A student carrying an F could not enrol to clear it. This was found by comparing the code against the Faculty Handbook and was fixed the same day.

# 3. Attendance

**Who:** lecturers run sessions; students check in; admins can mark by hand.

**Where:** StaffAttendance.tsx, Attendance.tsx, AdminAttendance.tsx.

## 3.1 The live session flow

1. The lecturer starts a session. `start_attendance_session()` opens a window for a few minutes, optionally fixed to the lecture hall's coordinates with a radius.
1. A code appears, and keeps changing. It is computed from the session's secret and the current time slice, so it rotates every few seconds.
1. Students check in by scanning the QR code or typing the short code. `check_in_with_code()` records it.
1. The lecturer may fire a presence check mid-lecture — a prompt students have about ninety seconds to answer.
1. The lecturer closes the session. Check-ins become attendance rows.

:::why WHY THE CODE ROTATES
A fixed code could be photographed and sent to a friend sitting at home. A code that changes every few seconds is useless by the time it arrives. The code is calculated rather than stored, so reading the database would not help either. The optional location radius closes the same hole from a different direction.
:::

## 3.2 The manual register

An admin can mark a whole class by hand. Since September 2026 the entire register is saved in one request rather than one per student.

```
await supabase.from('attendance').upsert(
  marked.map(s => ({
    student_id: s.studentId,
    course_id: selectedCourse.id,
    lecture_date: selectedDate,
    status: s.status,
  })),
  { onConflict: 'student_id,course_id,lecture_date' },
)
```

Marking a class of forty used to mean forty sequential requests. Worse, it was not atomic: a failure halfway through left the register half saved, with nothing to say which half. The table already has a unique key on those three columns, so the insert-or-update decision belongs to the database.

## 3.3 The rules

- The threshold is 80 percent, with an early warning below 85. Both come from system_settings.
- Excused counts toward compliance in the same way as present.
- One student cannot have two records for the same lecture — the database enforces this, not the page.
- A percentage is counted per delivery. A student repeating a course has one register per attempt, and only the attempt being sat now decides eligibility.
- A lecturer and the department office mark the same register. Both write the offering with every row, so a mark entered on either screen appears on both.
- An approved medical certificate rewrites the affected rows to excused automatically.

# 4. Results

**Who:** lecturers enter; the department admin or head of department publishes; students read.

**Where:** StaffResults.tsx, AdminResults.tsx, Results.tsx.

## 4.1 The workflow

```
  draft  --submit-->  submitted  --publish-->  published
    ^                      |
    +-------return---------+
```

1. The lecturer enters marks. The row is in draft. Only they can edit it.
1. The system derives the grade point. The lecturer records the Mid-Sem and CA marks and chooses the grade the examiners awarded. A trigger derives the grade point from that grade on every write and refuses a grade that is not on the faculty scale. The ESE mark is not entered.
1. The lecturer submits. `submit_offering_results()` moves the whole offering to submitted, and the lecturer can no longer edit it.
1. The department reviews. The department admin or the head of department either publishes it, or returns it with notes for correction.
1. Publication makes it visible. `publish_offering_results()` is the exact moment a student can see the grade.

## 4.2 The rules

- A student cannot see any mark before publication. This is enforced in the database, so it holds no matter what the browser does.
- A lecturer cannot edit after submitting. The policy includes the condition status = 'draft'.
- Only the department publishes: its admin or its head of department, or a super admin. The lecturer who entered the marks cannot.
- A correction after publication keeps the original. original_grade, corrected_by, corrected_at and correction_reason are all recorded.
- Students see the mid-semester mark, the CA mark, the grade and the grade point — never the exam or overall mark. The student result functions are written that way; the setting `student_visible_result_fields` describes the same list but nothing reads it (Guide 2, section 13).

:::why THE SEPARATION THAT MATTERS
The person who enters a mark is never the person who publishes it. That is the whole point of the workflow, and it is why status is a column on the row rather than a flag in the interface.
:::

## 4.3 A course graded over two semesters

The first part of such a course (CO3554's Semester 6 part, CO4002's Semester 7 part) never has a result of its own: a trigger refuses one. The grade is entered once, on the final part, and counts for the credits of both parts in the semester it is awarded. Until then the first part shows as in progress on the student's record and in the planner, and it counts towards a minor through the part it is graded with.

## 4.4 Spreadsheets in and out

A department or lecturer can download a sheet as an Excel workbook, fill in the grades offline, and import it again (`resultsWorkbook.ts`, `ResultsImportDialog.tsx`). The import is checked row by row against the roster and the grade scale before anything is written, and it only ever writes a draft — publishing is still a separate, deliberate step. Published sheets can also be printed as the faculty's PDF result sheet (`resultSheetPdf.ts`).

# 5. Feedback

**Who:** the department office creates rounds and approves lecturers' requests; lecturers shape their course's form; students answer; lecturers read their own courses' results and the head of department reads the department's.

**Where:** Feedback.tsx, StaffFeedback.tsx, FeedbackFormEditor.tsx, DepartmentFeedback.tsx, AdminFeedback.tsx.

## 5.1 The flow

1. A round is set up, either by the department office, which picks the cohort and courses, or at a lecturer's request. A request starts as draft, pending approval; a round the department created needs none.
1. A department admin approves or rejects a request. `decide_feedback_period()` records the decision and any notes.
1. While the round is a draft, lecturers shape their course's form. Everyone teaching a course in the round, and the sitting head of department, may add, edit, rename and reorder questions and sections for that course. The first edit gives the course its own copy of the round's template, so one lecturer's change never reaches another course. The department's own questions stay fixed.
1. The round opens to the students it covers. Opening it is also the release: since 29 August 2026 there is no separate step where the department forwards results course by course.
1. A student fills in the form. They can save a draft first and submit later, if editing is allowed.
1. Answers are stored as ratings, free text, single choices or multiple choices.
1. Results appear as answers arrive. A lecturer reads their own courses on the Feedback page and the head of department reads the whole department, but only once the minimum number of responses exists (feedback_min_responses_for_analytics).

## 5.2 The rules

- A student may only give feedback on a module they actually took. student_eligible_for_feedback() decides this.
- A submission marked anonymous is never joined back to the student in any report.
- Below the minimum response count, nobody sees the analytics — not the lecturer, not the head of department — only how many replied. The Faculty value is 5; it is 1 while PES is tested by one developer and must go back to 5 before release.
- Ratings and comments come from separate functions, so releasing one does not release the other.
- A lecturer sees feedback about themselves only in aggregate.
- The department office manages rounds (create, open, close) but has no analytics screen of its own since 20 September 2026; reading results belongs to the people teaching and to the head of department.

Reports can be exported to PDF from feedbackReportPdf.ts. The export goes through the same functions as the screen, so it cannot show anything the screen would not.

# 6. Medical certificates

**Who:** students submit; department admins review.

**Where:** MedicalCertificates.tsx, AdminMedical.tsx.

## 6.1 The flow

1. The student creates a submission with the dates missed, a reason and a description.
1. They name the affected modules. One row per module.
1. They upload the certificate into the private medical-certificates bucket.
1. An admin reviews each module separately. `review_medical_submission_course()` approves or rejects one module at a time.
1. Approval updates attendance. The affected rows become excused and point back at the submission.

:::why WHY REVIEW IS PER MODULE
One certificate often covers several days and several modules, and the answer is not always the same for all of them. A certificate might be valid for two modules but arrive after the deadline for a third. Approving per module is the only way to express that honestly — which is why the parent status can be partially_approved or mixed.
:::

## 6.2 The rules

- There is a deadline: medical_submission_deadline_days is 14.
- A student sees only their own submissions and files.
- A department admin sees a submission only if one of its modules belongs to their department.
- Certificate files have no public URL. The app must request a temporary signed link, and the database only issues one to somebody allowed the file.

# 7. Mentoring

**Who:** heads of department assign; lecturers mentor; students talk to their mentor.

**Where:** Mentor.tsx, StaffMentees.tsx, HodMentors.tsx, useThreadChannel.ts.

## 7.1 The flow

1. The head of department assigns a mentor to each student in the department.
1. The student sees their mentor on their own Mentor page, with a chat.
1. The mentor sees their mentees with an academic overview: GPA, credits, attendance and a risk band.
1. Either side sends a message. Files can be attached.
1. The message arrives immediately. A Supabase Realtime subscription pushes it, rather than the page polling.
1. The mentor writes private notes that the student can never see.

## 7.2 Realtime, and why it still respects the rules

The chat subscribes to inserts and updates on `mentor_messages`. Supabase Realtime applies Row Level Security to those pushes too — you are only sent rows you would have been allowed to read.

## 7.3 The rules

- A mentor sees only their own mentees. A lecturer with no mentees sees an empty page rather than an error.
- Messages are visible to both people in the thread. Notes are visible only to the mentor.
- Attachments live in a private bucket, readable only by the two thread participants.
- An attachment cannot be deleted while a message still refers to it.
- A head of department can see who is assigned to whom in their own department, but not the contents of the conversations.

:::warn THE LINE INSIDE THIS FEATURE
Notes and messages are two separate tables with two separate policies. That is deliberate. If they shared a table, one mistake in one query would expose a mentor's private assessment of a student to that student.
:::

# 8. Graduation Planner

**Who:** students; their mentor sees a plan the student shares.

**Where:** GraduationPlanner.tsx, with the arithmetic in `lib/graduationPlan.ts` and `lib/splitCourses.ts`, scenarios in `lib/plannerScenarios.ts`, and the chart in `components/planner/CgpaPathChart.tsx`. The data comes from one call, `get_my_graduation_plan()`.

The planner answers the question a student actually has — "what do I need from here?" — and does all of its arithmetic from one formula: the CGPA is the credit-weighted average of grade points, over every course that counts. Rebuilt in October 2026, it has two tabs.

## 8.1 Current Standing

1. **The CGPA first.** The current CGPA, large, with its class, the GPA credits on the record against the degree's final total, how many are still to go, and the best possible CGPA (an A+ in everything left).
1. **What you need each semester.** Four chips — First, Second Upper, Second Lower, Pass — each showing the SGPA it needs from here, or "Secured", or "Out of reach". Picking one lists every remaining semester with the SGPA it needs, its GPA credits and its share of what is left, so a heavier semester's weight is visible; a typical mix of grades that would make that SGPA; and the Dean's List marker where the SGPA reaches 3.80. "How is this worked out?" shows the sum.
1. **Graduation requirements.** Credits passed towards 144, modules still to clear (an F, R or L not being sat now), Industrial Training, the chosen minor's progress, and — only for a student whose best possible CGPA reaches it — the gold medal.
1. **Your CGPA path.** A chart of the record so far and the dashed line the chosen class needs, folded away until opened.

## 8.2 What-If Simulator

1. **A scenario.** A student can keep up to ten named scenarios, synced to their account, and share one with their mentor.
1. **The projected CGPA** stays pinned at the top while grades are picked below it, with the change from now and a Reset.
1. **Expected grades** for each course being sat now, each showing how far one grade moves the CGPA (a 5-credit project moves it five times as far as a 1-credit course).
1. **Planned SGPAs** for later semesters: plan one semester higher and the others' targets drop, each weighted by its credits.
1. **Past grades tried differently** — folded away unless one has actually been changed — and a comparison when there are several scenarios.

:::why WHY NOTHING HERE CAN CHANGE A RESULT
Everything on the What-If tab is a projection. The scenario tables hold guesses, never grades, and the planner's arithmetic runs in the browser on copies of the record. A repeated course's guess replaces the attempt on the record, exactly as the record itself does, so a projection never counts a course twice.
:::

## 8.3 After results come in

When the last GPA course of a student's semester is published, `nudge_semester_complete` writes them a notification: their new SGPA, and the SGPA they now need for the class they are aiming at (or that it is secured, or out of reach). It links to the planner.

> The Dean's List and the gold medal are checks and targets, not awards: the system does not record either. The time limits on completing the degree are not enforced. Both were left for a decision rather than guessed at.

# 9. The AI Assistant

**Who:** students.

**Where:** AIAssistant.tsx and chatbotEngine.ts in the browser, and the ai-assistant Edge Function, which is where the real work happens. The two AI guides cover it end to end; this is the summary.

## 9.1 The shape of it

Every message goes to a language model with fourteen tools described to it, and the model decides which to call. Twelve tools are database functions over the student's own record and the catalogue; two search the Faculty Handbook and the faculty website. Every tool runs on the student's own token, so row-level security decides what it can see — a student cannot ask about anyone else.

```
  message + recent conversation
        |
        v
  ai-assistant Edge Function
        |
        +--> a model, with 14 tools described to it
        |      |
        |      +--> calls the ones it needs  <---------+
        |                                              |
        +<-- tool results (through the student's own token)
        |
        v
  an answer written from what came back, with its sources
```

## 9.2 The fourteen tools

<!-- widths: 36,64 -->
| Tool | Answers |
|---|---|
| get_academic_standing | CGPA, credits done and remaining, current classification. |
| calculate_gpa_target | The average SGPA needed for a target CGPA, and whether it is still reachable. |
| get_student_results | Published results, filtered by semester or course. |
| get_student_course_result | The grade for one named course. |
| get_upcoming_courses | The student's own next semester. |
| get_courses_by_semester | Any named semester, regardless of progress. |
| get_course_info | Catalogue details for a module. |
| get_my_attendance | Overall and per-course attendance against the 80% rule. |
| get_my_minor_progress | Which minors exist, what they require, which courses count, what is passed. |
| my_outstanding_modules | Modules still owed on an R, F or L. |
| get_my_insights | What the system has noticed: attendance risk, a GPA drop, a medical deadline, an open window. |
| get_my_medical_submissions | Each certificate and its per-module decision. |
| search_handbook | The Faculty Handbook, cited with a page number. |
| search_faculty_website | The faculty website (eng.sjp.ac.lk), read every night, cited with a link. Added on 30 September 2026. |

:::why WHY EVERY ANSWER STILL COMES FROM A DATABASE FUNCTION
The model may state only what a tool returned, and it is forbidden from doing GPA arithmetic itself even when the sum looks trivial. That is delegated to the same functions the Graduation Planner uses, so there is one source of truth for the maths rather than two.
:::

## 9.3 Which model answers

Configuration, not code. The function can use a model the faculty runs itself — an open model such as Qwen 2.5 3B under Ollama, which answers in seconds on an ordinary CPU — and Google Gemini with one or more API keys. It tries them in the order `AI_PROVIDERS` sets (local first, by default), and a provider that is rate limited, busy, down or too slow is stepped past to the next. On a small local model it uses shorter instructions and a hint naming the lookup the question probably needs. Guide 7 lists the settings; `docs/local-llm.md` sets up the faculty machine.

## 9.4 Limits

- Gemini's free tier allows only a few requests a minute, and one question costs several (every tool turn is a request). A local model has no such allowance; its only limit is the machine.
- PES's own daily caps (`AI_DAILY_QUOTA`, default 5,000 a day; `AI_PER_STUDENT_DAILY`, default 1,000) are deliberately loose while one developer tests; tighten them before release.
- A question stops after 60 seconds (`AI_DEADLINE_MS`) so it can still answer rather than being killed.
- It reads records; it never submits, enrols or withdraws. It has no tool for course feedback or for whether an enrolment window is open today, and it says so rather than guessing.

# 10. Batches and accounts

**Who:** the super admin.

**Where:** AdminBatches.tsx (with IntakeDialog, DepartmentsDialog, RemoveBatchDialog and `lib/batchIntake.ts`), AdminUsers.tsx (with AddUserDialog), the `manage-batches` and `account` Edge Functions.

## 10.1 A batch's life

1. **Intake.** The super admin uploads the faculty's spreadsheet of a new batch: names, registration and index numbers, emails. `manage-batches` creates a sign-in account and a student row for each, with a random temporary password, and returns the passwords once, as a sheet to hand out. They are not stored anywhere. A long list is sent in chunks.
1. **First sign-in.** Each student must choose their own password before anything else (Guide 3, section 3.3).
1. **Division into departments.** A first-year intake belongs to the faculty, not a department. When the faculty divides it, the super admin uploads the list — registration number and department — and `assign_batch_departments` records it for the whole batch at once.
1. **Leaving.** For a batch that has left, the page first shows what removing it would take with it (`get_batch_footprint`) and offers its records as a spreadsheet (`export_batch_records`). Removal then deletes the students — their results, attendance, enrolments, medical submissions, mentoring and minor choice go with them — their stored files and their sign-in accounts. Course feedback is kept anonymously unless the super admin chooses otherwise.

## 10.2 Accounts

The Users page lists every account with its state — active, invited, invitation expired, deactivated, or no account — and the super admin invites, resends, cancels, deactivates and reactivates from there. Anyone can ask for a password-reset link from the sign-in page. Guide 3, section 8 follows each step and Guide 4, section 3A explains the checks.

# 11. Dashboards and notifications

## 11.1 The three dashboards

<!-- widths: 19,81 -->
| Portal | Shows |
|---|---|
| Student | The CGPA in a soft brand card with its class and trend, then GPA trend and attendance by course side by side, the things needing attention in their colours (an open enrolment window in blue, a warning in amber, something urgent in red), this semester's courses, and the latest notices. |
| Staff | A "waiting on you" list (unclosed registers, sheets to submit, requests to answer), the lecturer's own offerings, mentee alerts, and for a head of department the pending approvals. |
| Admin | Department or faculty totals, a department breakdown for the super admin, recent results and pending reviews, and the faculty website reader's status with its Refresh button. |

## 11.2 Badges

One function, `get_my_notification_counts()`, returns every badge count in a single call — unread mentor messages, pending approvals, unclosed registers. One request rather than one per badge.

## 11.3 Notifications

A badge says how many things are waiting now. A notification says what happened: a result was published, a register opened, a mentor wrote, a medical certificate was reviewed, an enrolment window opened. Each one is a row in notifications, addressed to one person.

They are written only by database triggers and a few functions, never by the browser; each carries the department it comes from. When the department publishes a sheet, the trigger on results writes one notification per student on it. The browser cannot forge one, and a screen that forgets to announce a change cannot cause one to be missed. The Notifications page and the bell in the header read them with `get_my_notifications()`, update live through Realtime, and clear them with `mark_notifications_read()`.

<!-- widths: 36,64 -->
| Trigger | Tells whom, when |
|---|---|
| notify_result_changes | The department office and head, when a sheet is submitted; the lecturer, when it is returned; every student on it, when it is published. |
| nudge_semester_complete | A student, when the last GPA course of their semester is published (section 8.3). |
| notify_register_open, notify_register_reopened | Students, when a register is opened for a class they are in. |
| notify_mentor_message, notify_mentor_assigned | The other person in the thread; a student and their new mentor. |
| notify_medical_submitted, notify_medical_reviewed | The department office; then the student, per module. |
| notify_enrolment_window | The students a window covers, when it opens or is extended. |
| notify_feedback_changes | The students a round covers, when it opens; the department office, when a lecturer requests a round; that lecturer, when it is approved or not. |
| notify_draft_form_ready | The lecturers of each course in a draft round ("set up your feedback form"), and the head of department. |
| notify_course_assigned | A lecturer, when they are assigned to teach an offering. |
| notify_notice_published, notify_notice_created_published | Everyone a notice is aimed at. |

## 11.4 Notices

The notice board is for announcements someone chooses to make: exam timetables, deadlines, events. A notice is scoped by department, batch, and optionally one course offering; a scope left empty means "not narrowed by this", so a notice with no department is faculty-wide.

Who may publish is decided by the database: a super admin anywhere, a department admin or head of department in their department, a lecturer for the courses they teach. Some categories are further restricted to certain desks: a lecturer may post a lab schedule for their own class, never a faculty examination timetable. Whether a student may read a notice is a separate question from whether it is relevant to them, and get_my_notices() answers both, ranking the ones aimed at their batch and courses first. Attachments go in the private notice-attachments bucket, and opening a notice is what clears its badge.

# 12. Patterns worth copying

Four habits appear throughout this codebase. If you add a feature, follow them.

### Ask the database once for what it can answer once

Do not fetch rows to count them in the browser. Besides the wasted transfer, the API caps how many rows it returns — so past that cap the page does not fail, it quietly reports a number that is too low. That was a real bug on the course management page, fixed in September 2026.

### Let the database decide insert or update

If a unique key already exists, use one upsert instead of a loop. It is faster and, more importantly, it is atomic.

### Fetch shared data once and pass it on

The student dashboard used to read the enrolment list twice — same student, same filter, different columns. One read, handed to both consumers, cannot disagree with itself.

### Put the calculation in lib, not in the page

Attendance percentages, batch descriptions and grade maths all live in src/lib/. That is what lets the same number appear on a page, in a PDF and in the AI assistant without being written three times and drifting apart.

# 13. Quick reference

<!-- widths: 38,62 -->
| I want to understand... | Start with this file |
|---|---|
| Who is signed in | src/app/context/AuthContext.tsx |
| Which page shows for which URL | src/app/routes.tsx |
| How a role is stopped at the door | src/app/components/ProtectedRoute.tsx |
| The academic rules and thresholds | src/lib/settings.ts |
| The AI assistant | supabase/functions/ai-assistant/index.ts |
| Mentoring | src/lib/mentorService.ts |
| Lecturer and HOD operations | src/lib/staffService.ts |
| Attendance maths | src/lib/attendanceMath.ts |
| The Graduation Planner's arithmetic | src/lib/graduationPlan.ts |
| Results spreadsheets | src/lib/resultsWorkbook.ts |
| Batches and accounts | src/lib/batches.ts, src/lib/accounts.ts, supabase/functions/manage-batches, supabase/functions/account |
| Minors and their study plan | src/lib/minorPlan.ts |
| The shared interface pieces | src/app/components/common/ (Guide 6) |
| Why a table looks the way it does | supabase/migrations/ — read in date order |

> The migration folder is the most underrated source of explanation in this project. Every file says what changed and, in its comment header, why.
