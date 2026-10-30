# PES UI/UX audit and plan

> **Status, 30 October 2026.** Phase 2 is done on `feature/UI`: every student,
> lecturer, head-of-department and admin screen has been rebuilt on the shared
> design system in `pes_app/src/app/components/common/`, with after-screenshots
> in `Screenshots/after/<Role>/`. After the first review four things changed
> from this plan: the hero card became a soft brand wash instead of solid
> crimson (on every dashboard); the student Dashboard's GPA and attendance
> charts went back side by side near the top, with its notices in their
> colours; the Results page shows its two insight charts straight under the
> CGPA; and the Graduation Planner was simplified further (CGPA first, one card
> of semester targets, a pinned projected CGPA on What-If). No native
> dropdowns remain. Nothing in the data layer changed. Study Guide 6 describes
> the design system as built; this document is kept as the audit and plan
> that led to it.

Branch: `feature/UI`. Phase 1 only: nothing in the app has changed yet. This
document records what each screen does today, what gets in the way, and how
each one will be restructured. It also defines the shared design system and
the order of the work. Phase 2 starts only after approval.

Scope rule for everything below: presentation only. Supabase queries, RPCs,
RLS logic, auth, routes, GPA/SGPA/CGPA maths, Graduation Planner and What-If
logic, attendance thresholds, medical rules and data transforms stay exactly
as they are. Information that moves somewhere new is listed under each screen
("Where things go"), so no student finds something "missing".

---

## 0. Ground truth (differences from the brief)

| Brief says | The code says | Effect on the plan |
|---|---|---|
| React 19 | React **18.3.1** | No React 19 APIs (`use`, actions). Nothing in the plan needs them. |
| Framer Motion | The `motion` 12 package, imported as `framer-motion` (24 files) | Same API. Variants and `MotionConfig` are available. |
| Tailwind config | Tailwind **v4**, CSS-first: tokens live in `src/styles/theme.css` (`@theme`). There is no `tailwind.config.*` | Design tokens go into `theme.css` as CSS variables and `@theme` entries, which generate utilities such as `rounded-card`. |
| PillTabs | No component of that name. The animated pill tabs are **`SegmentedTabs`** (`components/common/SegmentedTabs.tsx`): a sliding `layoutId` indicator with a spring (bounce 0.15, 0.4 s) | This is the motion reference. I'll export a `PillTabs` alias so both names work, and use it everywhere tabs appear. |
| `screenshots/` | The folder is **`Screenshots/`**, split by role: Student (23), Leturer (11), HOD (9), Department Admin (11), Super Admin (11). Total 65 | New screenshots go to `Screenshots/after/<Role>/<n>.png`, with the same names as the originals. |
| Run the linter | **No ESLint is configured** (no config, no `lint` script, and `eslint` is not installed). `tsc` is strict (`strict`, `noUnusedLocals`, `noUnusedParameters`) | Needs your decision; see §6. |
| — | `fonts.css` is **empty**. The CSS asks for `Inter`, which is never loaded, so users see system fonts | Needs your decision; see §6. |
| — | Some screenshots are older than the code: Graduation Planner (Student 18 and 23, before semester targets, path chart and scenarios), the semester chips on Minor (removed yesterday), and the loading screen | The audit follows the current code. Where a screenshot is stale, the screen section says so. |
| — | Student/11 is a staff screen (the HOD's live sign-in register QR), filed with the students | Handled with the staff Attendance screen. |

Existing `any`: 53 occurrences, all from before this work. I won't add any, and
I'll type the ones in code I touch for presentation.

---

## 1. Screenshot → route → component

| Shot | Route | Page / component |
|---|---|---|
| Student 1, 22 | `/` | `LoginPage` (22: the reset-password panel open) |
| Student 2, 4 | `/app` | `Dashboard` (2: the `NotificationBell` dropdown open) |
| Student 3 | `/app/notifications` | `Notifications` |
| Student 5, 6 | `/app/courses` | `Courses` (6: the Minor tab → `MyMinor`) |
| Student 7, 8, 9 | `/app/enrollment` | `Enrollment` → `EnrolmentWindow`, `MinorSelection`, `SemesterBaskets` (9: the pending-change save bar) |
| Student 10 | `/app/attendance` | `Attendance` → `AttendanceOverview` |
| Student 11 | `/staff/attendance` | `StaffAttendance` → `LectureRegister` (QR) |
| Student 12 | `/app/medical` | `MedicalCertificates` |
| Student 13 | `/app/results` | `Results` |
| Student 14, 15 | `/app/notices` | `Notices` (15: filtered to a category) |
| Student 16 | `/app/feedback` | `Feedback` |
| Student 17 | `/app/mentor` | `Mentor` |
| Student 18, 23 | `/app/planner` | `GraduationPlanner` (stale screenshots) |
| Student 19 | `/app/profile` | `Profile` |
| Student 20 | `/app/settings` | `Settings` |
| Student 21 | `/app/ai-assistant` | `AIAssistant` |
| Lecturer 1 / HOD 4 | `/staff` | `StaffDashboard` (lecturer with nothing running / HOD) |
| Lecturer 2 | `/staff/courses` | `StaffCourses` |
| Lecturer 3 | `/staff/attendance` | `StaffAttendance` (course picker open) |
| Lecturer 4, 5 | `/staff/results` | `StaffResults` (5: the submit confirmation) |
| Lecturer 6, 7, 8 | `/staff/feedback` | `StaffFeedback` (7: the request-a-form dialog; 8: a course report) |
| Lecturer 9 / Dept Admin 10 | `/staff/notices`, `/admin/notices` | `ManageNotices` |
| Lecturer 10 | `/staff/mentees` | `StaffMentees` |
| Lecturer 11 | `/staff/profile` | `StaffProfile` |
| HOD 1 | `/staff/lecturers` | `StaffLecturers` |
| HOD 2 | `/staff/students` | `StaffStudents` |
| HOD 3 | `/staff/enrollment` | `HodEnrollment` |
| HOD 5 | `/staff/assignments` | `HodAssignments` |
| HOD 6 | `/staff/mentors` | `HodMentors` |
| HOD 7, 8, 9 | `/staff/catalogue` | `HodCourseCatalogue` → the shared catalogue (`AdminCourses` parts, `MinorSpecifications`) |
| Dept Admin 1 / Super Admin 1, 2 | `/admin` | `AdminDashboard` |
| Dept Admin 2 | `/admin/attendance` | `AdminAttendance` (by lecture date) |
| Dept Admin 3, 4 | `/admin/results` | `AdminResults` |
| Dept Admin 5 | `/admin/students` | `AdminStudents` |
| Dept Admin 6 / Super Admin 6 | `/admin/courses` | `AdminCourses` (6: the new-course dialog) |
| Dept Admin 7 | `/admin/medical` | `AdminMedical` |
| Dept Admin 8 | `/admin/feedback` | `AdminFeedback` |
| Dept Admin 9 / Super Admin 4, 5 | `/admin/enrollment` | `AdminEnrollment` (4: the new-period form) |
| Dept Admin 11 | `/admin/profile` | `AdminProfile` |
| Super Admin 3 | `/admin/hods` | `AdminHods` |
| Super Admin 7, 10, 11 | `/admin/batches` | `AdminBatches` + `IntakeDialog`, `RemoveBatchDialog` |
| Super Admin 8, 9 | `/admin/users` | `AdminUsers` (9: the add-user dialog) |

---

## 2. What is wrong across the app (cross-cutting)

1. **No hero, everything equal.** Almost every page opens with four (or
   five) identical `StatCard`s. On Dashboard, Results, Planner and Profile the
   CGPA has the same weight as "Enrolled now: 8". Students have to read every
   card to find the one number that matters.
2. **Controls before content.** Courses shows four rows of controls before
   the first course: view tabs, six department chips, search plus semester,
   and status tabs. Notices has nine "Quick access" buttons over two rows.
   Feedback gives half the screen to eight semester tiles, seven of them
   "Not available".
3. **Empty or near-empty widgets take full space.** Attendance by course on
   the Dashboard is a full chart with one bar ("7 courses awaiting their first
   recorded lecture"). On Attendance, six "No records yet" rows are the same
   size as the one real row.
4. **Inconsistent building blocks.**
   - Five admin pages (`AdminEnrollment`, `AdminFeedback`, `AdminMedical`,
     `AdminResults`, `AdminStudents`) hand-roll an `<h1>`, use shadcn `Card`
     and native `<select>`. The rest use `PageHeader` and `SectionCard`.
   - There are four tab or filter styles: `SegmentedTabs`, outlined chips on
     Notifications, dark-filled pills on Users ("Any state"), and department
     chips.
   - Buttons vary: full-width primary bars (Save changes, Publish, Submit for
     Review, Sign In, Submit for review), the off-brand **blue** "Go to
     enrolment" button, and two-tone outline bars ("Download Excel sheet" /
     "Upload filled sheet").
   - Radii are mixed: `rounded-xl` 101×, `rounded-lg` 34×, `rounded-2xl` 4×.
     In this theme `rounded-2xl` (16 px) is actually *smaller* than
     `rounded-xl` (20 px).
   - Shadows are mixed: `shadow-elevation-*` 16×, plain `shadow-*` 27×.
5. **Wide merged-cell tables.** The Enrollment semester table and the minor
   study plan use row-spanning "Category / Contributing to GPA / Minimum"
   columns. That is mostly empty space at desktop width and hard to scan.
   There are no sticky headers on long tables (Results sheets, Students,
   Mentor Allocation).
6. **Navigation.**
   - The sidebar is one flat list of 11 items (student), up to 13 (HOD) or
     12 (super admin). At 900 px height it needs its own scrollbar (visible
     in every screenshot).
   - The active item is a filled pill with no motion. The rest of the app
     uses the sliding indicator, so the sidebar feels static by comparison.
   - HOD has two identical `BookOpen` icons (My Courses, Course Catalogue),
     and "Enrolment" is spelled differently from "Enrollment" in the other
     portals.
7. **Numbers that matter are small.** CGPA, attendance % and credits are
   `text-2xl` (22 px). The type scale tops out early for a data product.
8. **Feedback states.** Skeletons are flat pulse blocks. Success is shown in
   several ways: green inline banners, Sonner toasts (mounted bottom-right,
   but used in only a few places), and a "Saved" text. There's no count-up,
   no progress-bar animation, and no animated open/close for most
   expandables. The Planner has some; Courses rows use chevrons that snap.
9. **Charts lack a takeaway.** The GPA trend, attendance and grade
   distribution charts are styled well, but none says in one line what the
   student should conclude.
10. **What already works, and stays.**
    - `SegmentedTabs` with its spring indicator.
    - The `ChartContainer` fade-and-lift plus Recharts' draw-in.
    - The page transition (`AnimatePresence` in `AppShell`).
    - Staggered `StatCard`s (`useListMotion`) and the hover lift
      (`useHoverLift`).
    - Reduced-motion handling (`motion.ts` and the CSS block in `theme.css`).
    - The department identity colours, the semantic `--status-*` tokens, and
      dark mode.

---

## 3. Per-screen audit and plan

Each screen lists: **Jobs** (the 1–2 things people come to do), **Now** (what
is above the fold and what competes), **Proposed** (a text wireframe),
**Where things go** (nothing is removed) and **Enhance** (polish and
feedback).

### 3.1 Student screens (Phase 2, in this order)

#### Dashboard — `/app` (Student 2, 4)
- **Jobs:** "How am I doing?" (CGPA and class); "What needs me now?"
  (enrolment window, open feedback, attendance risk).
- **Now:**
  - Four equal stat cards.
  - A full-width blue info banner with an off-brand blue button.
  - A large GPA chart next to an attendance chart holding one bar.
  - "This semester" and "Latest notices" below the fold.
  - `InsightsPanel` sits between, unstyled relative to the rest.
- **Proposed:**
  ```
  ┌ Welcome back, Senadheera · Computer Engineering ──────────────┐
  ┌──────── HERO (brand gradient) ─────────┐ ┌ Needs your attention ┐
  │ CGPA 3.61 (count-up, 48px)              │ │ • Enrolment closes   │
  │ Second Class (Upper) · Sem 7            │ │   in 20 days  [Go]   │
  │ ▓▓▓▓▓▓▓░░ 100 of 144 credits            │ │ • 5 feedback forms   │
  │ mini GPA sparkline     [Planner →]      │ │ • Insights (n)       │
  └─────────────────────────────────────────┘ └──────────────────────┘
  ┌ This semester · 8 courses ── attendance chip per course ─[All →]┐
  ┌ Trends  [GPA trend | Attendance]  (PillTabs) ───────────────────┐
  │ chart + one-line takeaway                                       │
  ┌ Latest notices (3) ─────────────────────────────────[View all →]┐
  ```
- **Where things go:**
  - "Enrolled now", "Avg attendance" and "Credits completed" go into the
    hero. Credits shows as the progress bar; attendance and enrolled become
    small inline stats in the hero footer.
  - The enrolment banner and `InsightsPanel` items are merged into one
    "Needs your attention" list. Same data, same links.
  - The two charts move into one tabbed card.
- **Enhance:** count-up on the CGPA, an animated credits bar, staggered
  reveal, hover lift on attention items, and a takeaway under each chart
  (e.g. "Your SGPA has stayed above 3.3 for five semesters.").

#### Results — `/app/results` (Student 13)
- **Jobs:** see grades for a semester; know the CGPA; download the
  transcript.
- **Now:** four stat cards, then a GPA trend chart (a duplicate of the
  Dashboard's) and a grade-distribution chart, then the semester tabs and
  table.
- **Proposed:**
  ```
  ┌ HERO: CGPA 3.61 · class · 100 credits · Dean's List ×1 ─[Download transcript]┐
  ┌ Semester results ─ PillTabs Sem1…Sem8 (existing, scrollable) ─────────────┐
  │ Semester header: SGPA 3.81 (large), Dean's List badge, credit split chips │
  │ Table: Code · Course · Credits · Grade chip · GPV (sticky header)         │
  │ phone: stacked course cards                                              │
  ┌ ▸ Insights (collapsed): [GPA trend | Grade distribution] + takeaways ────┐
  ```
- **Where things go:**
  - "Courses Graded" becomes a hero sub-stat.
  - Both charts move into a collapsible "Insights" card. It opens with
    animation, and its state is remembered per device.
  - Download Transcript moves into the hero as its primary action.
- **Enhance:**
  - Tab content cross-fades when the semester changes.
  - Grade chips use status tones.
  - Rows get a hover state.

#### Attendance — `/app/attendance` (Student 10)
- **Jobs:** "Am I above 80 %?" overall and per course; which course is at
  risk.
- **Now:** five equal cards (Overall 100 %, Total lectures, Meeting
  requirement, Needs attention, Awaiting records), then one row per course.
  Six of the seven say "No lectures recorded yet".
- **Proposed:**
  ```
  [Attendance | Calendar view]  (existing PillTabs)
  ┌ HERO: ring 100% (animated) · "Above 80% in 1 of 1 recorded courses" ┐
  │ chips: 1 lecture · 0 missed · 0 excused · 7 awaiting records       │
  ┌ Courses ─ sorted lowest first (existing) ──────────────────────────┐
  │ CO4204 Computer Vision … 100% ▓▓▓▓▓▓▓▓▓▓|  Excellent  ›           │
  │ ▸ 7 courses awaiting their first lecture (expand)                  │
  ```
- **Where things go:**
  - The five stat cards become one hero plus a chip strip; every number is
    kept.
  - Courses with no records fold into one expandable row (it opens with an
    animation).
  - The course calendar and per-course detail are unchanged.
- **Enhance:** animated ring and bars, a status colour that follows the
  existing thresholds (no logic change), and an at-risk course highlighted
  first.

#### Courses — `/app/courses` (Student 5, 6)
- **Jobs:** find a course and see its status; see the minor plan.
- **Now:** four control rows before content; every semester expanded, so 90
  rows.
- **Proposed:**
  ```
  [My courses | Minor]  (PillTabs)
  ┌ Toolbar: [Search……] [All 90|Ongoing 8|Completed 49|Upcoming 9|Not recorded 24] [Filters ⋯2] ┐
  │ Filters popover: department chips + semester select (badge = active count)              │
  ┌ ▾ Semester 7 · 12 courses · in progress ── two-column course rows (existing) ┐
  ┌ ▸ Semester 8 · 9 courses · upcoming                                          ┐
  ┌ ▸ Semester 6 · 10 courses · SGPA 3.81                                        ┐
  ```
- **Where things go:**
  - Department chips and the semester select move into a "Filters" popover
    (a bottom sheet on phones). The button shows how many filters are
    active, and chips for active filters stay visible under the toolbar.
  - Semester groups become collapsible: the current semester is open, the
    others collapsed with a summary line.
- **Minor tab:** a summary hero (credits ring 14/20, "You're taking this
  minor", Compare and Stop actions), then the existing plan table with a
  sticky header. On phones it uses the existing stacked layout.
- **Enhance:** collapse and expand animation, a list-item stagger the first
  time a group opens, and active filter chips that animate in and out.

#### Enrollment — `/app/enrollment` (Student 7, 8, 9)
- **Jobs:** choose this semester's courses before the deadline; satisfy the
  minor.
- **Now:**
  - A long single column: open banner, Minor selection, the semester table
    (wide merged cells, with a "Contributing to GPA" column that is mostly
    empty), then Outstanding modules.
  - Changes appear in a full-width red "Save changes" bar.
- **Proposed:**
  ```
  ┌ HERO strip: Enrolment open · closes 21 Oct 2026 (countdown) · 18 credits selected ┐
  ┌ Semester 7 courses ───────────────────────────────────────────────────────┐
  │ group header: Compulsory · all required                     ✓ 12 credits │
  │   ☑ CO4002 Engineering Project · 4 cr  [Enrolled]                         │
  │ group header: Elective (1) · choose ≥1 credit               ✓ 2 of 1     │
  │   ☐ IS3173 Sinhala · 1 cr · Not in GPA                                    │
  ┌ ▾ Minor: Data Management (open when taking a minor; shortfall alert on top)┐
  ┌ ▸ Modules to clear (n)                                                     ┐
  ╔ floating action bar (slides up on change): "−CO4352 · 15 credits"  [Discard] [Save changes] ╗
  ```
- **Where things go:**
  - The Category and Minimum columns become group header rows with a basket
    progress tick.
  - "Contributing to GPA: No" becomes a small "Not in GPA" tag on the course.
    Yes is the default, so it isn't repeated.
  - The open/closed banner becomes the hero strip.
  - The save bar becomes a compact floating bar: right-aligned buttons on
    desktop, full width on phones. Same actions, same confirmation.
- **Enhance:** checkbox press feedback, an animated basket tick when a
  minimum is met, the bar sliding in and out, and a success toast on save.

#### Graduation Planner — `/app/planner` (Student 18, 23: stale; audit follows current code)
- **Jobs:** "What SGPA do I need for my class?"; try what-ifs.
- **Now (code):** stat cards, requirements, semester targets with class
  tabs, the CGPA path chart, the "What you need for each class" list, and the
  simulator with scenarios, expected grades and compare. It is rich, but
  every section has the same weight.
- **Proposed (Current Standing):**
  ```
  ┌ HERO: Aiming for [First|Second Upper|Second Lower|Pass] (PillTabs, existing)       ┐
  │ "SGPA 3.93 in Semester 7 and 8" (large) · Challenging badge · grade mix line       │
  │ CGPA 3.61 now · best possible 3.73                                                  │
  ┌ Requirements checklist (existing tiles, tighter)  ┐ ┌ Your CGPA path (chart+takeaway) ┐
  ┌ ▸ What you need for each class (collapsed)                                          ┐
  ┌ ▸ How is this worked out? (existing details)                                        ┐
  ```
- **Simulator tab:**
  - The scenario bar becomes sticky under the header.
  - Expected grades stay the main card.
  - "Edit past module grades" becomes an accordion per semester (closed by
    default), and Compare becomes a collapsible card.
- **Where things go:** the four stat cards go into the hero; the per-class
  list becomes collapsible. Nothing is removed, and no logic is touched.
- **Enhance:** count-up on the required SGPA when the class changes,
  cross-fade between classes, and accordion animations.

#### Medical Certificates — `/app/medical` (Student 12)
- **Jobs:** submit a certificate; check its status.
- **Now:** a long form fills the left half; submissions sit on the right
  with lots of empty space.
- **Proposed:**
  ```
  PageHeader ·························· [＋ New submission]
  ┌ status strip: Pending 0 · Approved 1 · Rejected 0 ┐
  ┌ Your submissions (status cards, per-course decisions, file chip) ┐
  Sheet (right on desktop, bottom on phone): the existing form, unchanged fields
  ```
- **Where things go:** the form opens in a side sheet from the primary
  button. With no submissions yet, the empty state shows the same button.
  Validation and upload are unchanged.
- **Enhance:** a sheet slide-in, an upload drop-zone hover state, a success
  toast, and the new submission animating to the top of the list.

#### AI Assistant — `/app/ai-assistant` (Student 21)
- **Jobs:** ask a question.
- **Now:** a right column of 12 large suggestion pills competes with the
  conversation.
- **Proposed:**
  - The chat gets the full width (max ~860 px, centred).
  - Suggestions appear as a chip grid in the empty state.
  - Once a chat exists, suggestions sit behind a "Suggestions" button next to
    the input (a popover, grouped "Your record and the Handbook" / "From the
    faculty website").
- **Where things go:** every suggestion stays reachable in one click.
- **Enhance:** message entrance animation, a typing indicator, and send
  button press feedback.

#### Profile — `/app/profile` (Student 19) and Settings — `/app/settings` (Student 20)
- **Profile now:** the identity card, then four stat cards and the Semester
  record, which repeat Results.
- **Proposed:** an identity hero (photo, name, chips, IDs in a two-column
  definition list), then a compact academic summary row (CGPA, credits,
  Dean's List) linking to Results, then the Semester record in a collapsible
  card.
- **Settings:** the same section style; the theme picker gets an animated
  selected state; "Change password" is a consistent outline button.
- **Where things go:** nothing removed. The semester record is collapsed, and
  the stats are compact.

#### Notifications (Student 3), Notices (14, 15), Feedback (16), Mentor (17), Login (1, 22)
These are not in the Phase 2 student list, but they share the components and
will be aligned for consistency after the listed screens:
- **Notifications:** the outlined filter chips become PillTabs with counts,
  and "Unread only" becomes a switch.
- **Notices:**
  - The nine "Quick access" buttons become one horizontally scrolling chip
    row with icons (a sheet on phones).
  - Important notices get a highlighted card.
- **Feedback:**
  - It leads with "Open now": the course cards that have open forms, with a
    "1 of 6 done" progress bar.
  - Semester selection becomes compact PillTabs; unavailable semesters stay
    visible but disabled.
- **Mentor:** the mentor card becomes a compact header and the chat fills
  the height.
- **Login:** already strong. It gets the shared input and button styles, and
  the reset panel opens with an animation.

### 3.2 Staff and HOD screens (shared-component upgrade; full restructure only if you approve, §6)
- **Staff Dashboard (L1, H4):**
  - Leads with "Current teaching" as the hero list, with mark status per
    course.
  - The four counters become a chip strip.
  - Quick actions become a row of action cards.
- **My Courses (L2):** keep; the filters go into one toolbar row.
- **Attendance (L3, Student 11):**
  - The batch/semester/course/date selector card becomes a compact toolbar.
  - An open register enters a focus layout: a large QR and code as the hero,
    the sign-in list beside it, then a stat strip.
  - The manual marking list gets a sticky header.
- **Results (L4, L5):**
  - Selector toolbar; status banner kept.
  - The Download/Upload full-width bars become toolbar buttons.
  - Save Draft and Submit go into a sticky action bar.
  - The table gets a sticky header.
- **Feedback (L6–L8):** the master/detail layout stays. "About this round"
  becomes collapsible, and report scores become stat heroes.
- **Notices manage (L9, Dept Admin 10):** the always-open "New notice" form
  pushes the list below the fold. It becomes a "New notice" button opening a
  sheet, with the list first.
- **Mentees (L10), Department Staff (H1), Students (H2), Mentor Allocation
  (H6):**
  - Stat strip, one filter toolbar, and list rows with hover.
  - Long lists get a sticky group header.
  - On phones the per-row selects (Mentor Allocation) stack under the name.
- **Enrolment (H3), Course Assignments (H5), Course Catalogue (H7–H9):**
  - Collapsible course groups.
  - The minor editor's baskets use the same group-header pattern as student
    Enrollment.

### 3.3 Admin screens (Phase 2 after students: these five first)
- **AdminDashboard (DA1, SA1, SA2):**
  - Faculty or department hero: students, courses running, average
    attendance (ring).
  - "Below 80 % attendance" becomes an attention list.
  - Course attendance chart and By department sit in one tabbed card with a
    takeaway.
  - Quick actions become an action-card row.
  - Recently published results and the faculty website card become
    collapsible.
- **AdminAttendance (DA2):**
  - [Overall | By lecture date] PillTabs (existing).
  - The course selector becomes a compact toolbar.
  - The calendar and the day's register sit side by side, with a sticky
    action bar for saving.
  - The disabled "No changes to save" bar becomes a hidden floating bar that
    appears on change.
- **AdminResults (DA3, DA4):**
  - The page is moved onto `PageHeader` and `SectionCard`; the native
    selects become the shared `Select`.
  - The "Select Course & Batch" card becomes a toolbar.
  - Sheet header: status chips (published, draft, empty) and a PDF download.
  - The long explanation goes behind an info toggle.
  - Table with a sticky header; sticky action bar (Save Draft / Publish).
  - The confirmation dialogs are kept.
- **AdminStudents (DA5):** `PageHeader`, a stat strip, one toolbar (search,
  batch, sort as PillTabs), and compact expandable rows with a sticky header.
  On phones, stacked cards.
- **AdminCourses (DA6, SA6):** toolbar (search plus Sem PillTabs), course
  rows with category chips and Edit, and the dialog unchanged.
- **Others (AdminEnrollment, AdminFeedback, AdminMedical, AdminHods,
  AdminUsers, AdminBatches, AdminProfile):** move onto the shared components
  (`PageHeader`, `SectionCard`, `Select`, PillTabs). Restructure only with
  approval.

---

## 4. Design system

All tokens are added to `src/styles/theme.css` (light and `.dark`). Utilities
are generated with `@theme` and `@utility`, so classes stay short and
consistent.

### 4.1 Colour and surfaces
- **Primary:**
  - Crimson stays the one strong accent (`--primary #C41E3A`, dark
    `#E8455F`), for actions, active states and the hero.
  - Gold (`--accent #FDB913`) highlights only: the Dean's List badge, gold
    medal, and a hero sparkle line.
- **New surface tokens:**
  ```css
  --hero-from: #C41E3A;  --hero-to: #7A1230;   /* .dark: #8E1630 → #3A0B18 */
  --hero-fg: #FFFFFF;    --hero-muted: rgb(255 255 255 / 0.78);
  --surface-tint: color-mix(in oklab, var(--primary) 5%, var(--card));
  --surface-sunken: color-mix(in oklab, var(--muted) 60%, var(--background));
  ```
  ```css
  @utility surface-hero  { background: linear-gradient(135deg, var(--hero-from), var(--hero-to)); color: var(--hero-fg); }
  @utility surface-tint  { background: var(--surface-tint); }
  ```
  White text contrast on the hero colours, all above AA:

  | Hero colour | Ratio |
  |---|---|
  | `#C41E3A` | 5.8:1 |
  | `#7A1230` | 10.7:1 |
  | `#8E1630` (dark) | 9.1:1 |
  | `#3A0B18` (dark) | 16.9:1 |
- Status (`--status-*`) and department (`--dept-*`) tokens stay as they are,
  with the same rules: identity is never status.

### 4.2 Radius, spacing, elevation, type
- **Radius:**
  - `--radius-card: 1.125rem` gives `rounded-card` (all cards and sheets).
  - `--radius-control: 0.75rem` gives `rounded-control` (inputs, buttons,
    rows).
  - Pills use `rounded-full`.
  - Raw `rounded-xl/2xl` mixes are replaced in touched files.
- **Spacing:**
  - Page stack: `space-y-6`.
  - Card body: `p-4 sm:p-5`.
  - Grids: `gap-4`.
  - Rows: `px-4 py-3`.
  - Toolbar: `gap-2`.
- **Elevation:**
  - Cards: `shadow-elevation-sm`.
  - Hover or interactive: `shadow-elevation-md`.
  - Popovers, sheets and the floating action bar: `shadow-elevation-lg`.
  - Plain `shadow-md/lg/xl` are not used.
- **Type scale (existing `@theme` text sizes):**

  | Role | Classes |
  |---|---|
  | Page title | `text-3xl font-bold tracking-tight` (26 px) |
  | Section title | `text-base font-semibold` |
  | Body | `text-sm` |
  | Caption | `text-xs text-muted-foreground` |
  | Hero number | `text-5xl font-bold tabular-nums tracking-tight` |
  | Stat number | `text-3xl font-bold tabular-nums` |
  | Eyebrow | `text-xs font-medium uppercase tracking-wide text-muted-foreground` |

### 4.3 Shared components (extend what exists; nothing new from npm)

| Component | Status | What it does |
|---|---|---|
| `PageHeader` | extend | title, description, actions, optional `eyebrow`; becomes the only page title |
| `HeroCard` | new | `variant="brand"` (gradient) or `"tint"`. Slots: `value` (count-up), `label`, `meta`, `progress`, `actions`, `aside` |
| `StatCard` | extend | bigger number, optional `progress` (animated bar) or `ring`, count-up; existing props kept |
| `StatStrip` | new | compact inline chips for secondary numbers (replaces rows of minor stat cards) |
| `SectionCard` | extend | `collapsible`, `defaultOpen`, `storageKey` (remember open state), animated body, `takeaway` slot |
| `Toolbar` / `FilterButton` | new | search + PillTabs + a "Filters (n)" popover or sheet; active-filter chips |
| `PillTabs` | alias | of `SegmentedTabs`, plus `TabPanels` for animated content switching |
| `DataTable` | new (pattern) | shadcn `table` with sticky header (`sticky top-0` in a `max-h` scroll region), row hover, compact density, and `renderCard` for stacked phone cards |
| `StickyActionBar` | new | slide-up floating bar for unsaved changes (Enrollment, Results sheets, Attendance) |
| `EmptyState` / `ErrorState` | refresh | tinted icon badge, consistent action button |
| `Skeleton*` | refresh | shimmer sweep, plus shape presets `SkeletonHero`, `SkeletonTable`, `SkeletonList` |
| `ChartContainer` | extend | `takeaway` line, gradient fills, cleaner axes, richer `ChartTooltip` (label, value, delta) |
| `AnimatedNumber`, `AnimatedBar`, `ProgressRing` | new / extend | count-up, scaleX bar and dashoffset ring, all reduced-motion aware |

Buttons are the shadcn `Button` variants, kept as they are, with one global
addition: `active:scale-[0.98]` and a `transition-[color,background,box-shadow,transform]`.

Rules:
- One primary action per area, right-aligned.
- Full width only on phones or inside dialog and sheet footers.
- No colour outside the tokens (the blue "Go to enrolment" becomes primary).

Toasts: Sonner (already mounted) for confirmations: saved, submitted,
published, shared. Inline `Alert` for persistent state: window closed,
published sheet.

### 4.4 Motion system (`components/common/motion.ts`)
Built from the current feel: duration 0.15/0.25/0.4 s, `EASE [0.4,0,0.2,1]`,
and the tab spring `{ type: "spring", bounce: 0.15, duration: 0.4 }`.

```ts
export const SPRING = { type: "spring", bounce: 0.15, duration: 0.4 } as const;

export const pageEnter: Variants = {
  hidden: { opacity: 0, y: 8 },
  show:   { opacity: 1, y: 0, transition: { duration: DURATION.base, ease: EASE } },
};
export const stagger = (step = 0.04, delay = 0.03): Variants => ({
  hidden: {}, show: { transition: { staggerChildren: step, delayChildren: delay } },
});
export const cardReveal: Variants = {
  hidden: { opacity: 0, y: 12, scale: 0.985 },
  show:   { opacity: 1, y: 0, scale: 1, transition: { duration: 0.3, ease: EASE } },
};
export const listItem: Variants = {
  hidden: { opacity: 0, y: 6 }, show: { opacity: 1, y: 0, transition: { duration: DURATION.base, ease: EASE } },
};
export const sectionExpand: Variants = {
  collapsed: { height: 0, opacity: 0, transition: { duration: DURATION.base, ease: EASE } },
  open:      { height: "auto", opacity: 1, transition: { height: { duration: DURATION.base, ease: EASE }, opacity: { duration: 0.2, delay: 0.05 } } },
};
export const tabContent = {
  initial: { opacity: 0, x: 8 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: -8 },
  transition: { duration: DURATION.fast, ease: EASE },
};
export const chartReveal = { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: { duration: DURATION.slow, ease: EASE } };
export const hoverLift = { whileHover: { y: -3 }, whileTap: { scale: 0.99 }, transition: { duration: DURATION.fast } };
```

- **Hooks:**
  - `useCountUp(value, { decimals })`: `animate()` on a motion value, started
    when the element comes into view.
  - `AnimatedBar`: `scaleX` from 0 with `originX: 0`; no layout cost.
  - `ProgressRing`: animated `strokeDashoffset`.
- **Reduced motion:** `<MotionConfig reducedMotion="user">` at the app root
  turns off transform animations globally. On top of that, the existing hooks
  collapse the variants to opacity-only with zero duration, and count-ups
  render the final value. The CSS reduced-motion block stays.
- **Performance:**
  - Only `opacity` and `transform` are animated (height only inside
    `sectionExpand`, which runs on open and close).
  - Variants are defined at module scope, so animation wrappers don't cause
    re-renders.
  - Lists over ~40 rows don't stagger.
- **Kept untouched:** `SegmentedTabs`' indicator, `ChartContainer`'s plot
  reveal, Recharts' draw durations (450 ms), and the page transition in
  `AppShell`.

### 4.5 Navigation
- **Grouped sidebar:** small `Eyebrow` group labels, the same routes, the
  same items and the same names.

  | Portal | Group | Items |
  |---|---|---|
  | Student | — | Dashboard |
  | | Academics | Courses, Enrollment, Results, Attendance, Graduation Planner |
  | | Requests | Medical Certificates, Feedback |
  | | Help | Mentor, AI Assistant, Notices |
  | | Account | Profile, Settings |
  | Staff | Teaching | My Courses, Attendance, Results, Feedback, Notices |
  | | Mentoring | My Mentees, Mentor Allocation* |
  | | Department* | Course Assignments, Course Catalogue, Enrolment, Students, Department Staff |
  | Admin | Records | Attendance, Results, Students, Medical |
  | | Curriculum | Courses, Enrollment, Feedback |
  | | Notices | Notices |
  | | Faculty (super admin) | Users, Batches, Heads of Department |

- **Active indicator:** a `motion.span` with `layoutId="nav-active"` slides
  between items, the same spring as the tabs. On the icon rail it's a pill
  behind the icon.
- **Mobile:** the existing drawer gets a spring slide (already there) and
  the grouped list. An optional bottom tab bar for students is a decision
  for you (§6).
- **Small consistency fixes (labels and icons only):** the HOD's Course
  Catalogue gets its own icon (`Library`). The "Enrolment"/"Enrollment"
  spelling is unified only if you agree (§6).

### 4.6 Accessibility
- Focus rings stay visible (`--ring`). The floating action bar and sheets
  trap and restore focus (shadcn primitives do this).
- Collapsibles use `aria-expanded` and `aria-controls`.
- Count-ups keep the final value in the accessible name.
- Charts keep their `summary`; takeaways are real text.
- Stacked phone cards keep the table's labels as visible captions.
- Every colour pair is AA in light and dark, and is checked when each screen
  is done.

---

## 5. Order of work (each step: typecheck, build, screenshots to `Screenshots/after/`)

1. **Foundation commit:**
   - Tokens in `theme.css`.
   - `motion.ts` variants and hooks; `MotionConfig`.
   - `HeroCard`, `StatStrip`, `AnimatedNumber`/`AnimatedBar`/`ProgressRing`,
     a collapsible `SectionCard`, `Toolbar`/`FilterButton`, `PillTabs` and
     `TabPanels`, `DataTable` and stacked cards, `StickyActionBar`, refreshed
     states and skeletons, and `ChartContainer` takeaways.
   - The grouped sidebar with its animated indicator; button press feedback.
   - Pages pick up the polish without layout changes.
2. Dashboard
3. Results
4. Attendance
5. Courses
6. Enrollment
7. Graduation Planner
8. Medical Certificates
9. AI Assistant
10. Profile and Settings
11. AdminDashboard
12. AdminAttendance
13. AdminResults
14. AdminStudents
15. AdminCourses
16. (If approved) Notifications, Notices, Feedback, Mentor; then the staff,
    HOD and remaining admin screens.

One commit per step on `feature/UI`, authored as set in `CLAUDE.md`. Nothing
is pushed unless you ask.

---

## 6. Decisions needed before Phase 2

1. **Linter.** No ESLint exists. Should I add `eslint`, `typescript-eslint`
   and `eslint-plugin-react-hooks` as dev dependencies with a minimal config
   and a `lint` script, or rely on strict `tsc` plus the build?
2. **Font.** `Inter` is referenced but never loaded. Options:
   - (a) a Google Fonts `<link>` in `index.html` (no npm change);
   - (b) `@fontsource-variable/inter` (a new dependency, self-hosted, works
     offline);
   - (c) keep system fonts.

   I recommend (a) or (b) for the polished look.
3. **Medical form in a side sheet.** It would be one click behind a
   prominent "New submission" button. OK, or keep it inline?
4. **Mobile bottom tab bar for students** (Dashboard, Courses, Results,
   Attendance, More). Should I add it, or keep the drawer only?
5. **Scope beyond your list:**
   - Notifications, Notices, Feedback, Mentor, Login.
   - The staff and HOD screens.
   - The other admin pages (Enrollment, Feedback, Medical, Users, Batches,
     Heads of Department, Profile).

   Restructure them too after the listed screens, or only move them onto the
   shared components?
6. **Label consistency.** The HOD menu says "Enrolment" and the others say
   "Enrollment". May I unify the visible label? Routes stay the same.
7. **Testing locally.** You said you'll test on your machine, but I'm not to
   push. Should I push `feature/UI` after the foundation and after each
   screen (no PR), or only when you say?
8. **Screenshots data.** Earlier work used mocked data for screenshots
   because the database holds real student names. Should I keep doing that
   for `Screenshots/after/` (admin lists filled with synthetic names), or
   use your account as the originals did?
