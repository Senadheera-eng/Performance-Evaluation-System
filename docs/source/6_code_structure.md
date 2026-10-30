---
kicker: Study Guide 6 of 7
title: Code Structure
subtitle: How the React application is organised, and why
intro: Guides 1 to 5 describe what the system does and how the database enforces it. This one opens the application itself: how a page is reached, where its data comes from, which shared pieces every screen is built from, and the conventions that keep 213 files readable. Read it before changing the code.
updated: Updated 30 October 2026  ·  describes the feature/UI branch on that date  ·  first written 30 October 2026
footer: PES Study Guide
---

# 1. The application in one picture

Everything in the browser grows from one file, `src/main.tsx`, which mounts `App`. From there each layer wraps the next.

```
main.tsx                 mounts <App/> and loads styles/index.css
  App.tsx
    MotionConfig         reduced motion for anyone who asked their device for it
    ThemeProvider        light / dark / follow the device   (context/ThemeContext)
    AuthProvider         who is signed in, and as what      (context/AuthContext)
    RouterProvider       routes.tsx: one URL map
      ProtectedRoute     the right role, or off to the right portal
        AppLayout / StaffLayout / AdminLayout
          AppShell       sidebar, header, bell, profile menu
            <Outlet/>    the page: pages/*.tsx
              components/common   cards, tables, charts (the design system)
              components/<feature> pieces for one feature
              lib/*      services, calculations, PDFs, spreadsheets
                lib/supabase.ts   the one client: database, auth, storage,
                                  realtime and Edge Functions
    Toaster              the small success / error messages (sonner)
```

> The rule that keeps this clean: anything under `src/lib/` has no interface, and anything under `src/app/` draws. A calculation written once in lib can be used by a page, a PDF and a test without being copied.

# 2. Folder by folder

## 2.1 The top of pes_app

<!-- widths: 30,70 -->
| Path | What it is |
|---|---|
| `index.html` | The one HTML page. Sets the crest favicon, loads the Inter font, and applies the saved theme before anything paints, so a dark-mode user never sees a white flash. |
| `vite.config.ts` | The build. Aliases `@` to `src`, forces a single copy of React, and keeps `sonner` out of pre-bundling (its pre-bundled copy found a second React and every hook inside it failed). |
| `tsconfig.json` | TypeScript in strict mode, with unused locals and parameters as errors. `npm run typecheck` must print nothing. |
| `vercel.json` | What deploys (not `dev`, not `claude/*`), the single-page rewrite, and caching: hashed assets for a year, `index.html` never. |
| `public/` | The crest in its sizes, the favicon, the login photograph. |
| `*.cjs` at the top | One-off maintenance scripts from before the app could manage accounts: creating auth users, syncing ids, exporting migrations, a password reset. Guide 7 says which are still useful. |

## 2.2 src/app/pages

One file per screen. The student pages sit at the top; the other two portals have folders.

<!-- widths: 24,76 -->
| Folder | Pages |
|---|---|
| `pages/` (student and shared) | Dashboard, Courses, Attendance, Results, Enrollment, MedicalCertificates, Feedback, Mentor, GraduationPlanner, AIAssistant, Notices, NoticeDetail, Notifications, Profile, Settings; LoginPage and AccountLinkPage (no sign-in); ManageNotices (staff and admins) |
| `pages/admin/` (12) | AdminDashboard, AdminAttendance, AdminResults, AdminStudents, AdminCourses, AdminMedical, AdminFeedback, AdminEnrollment, AdminProfile; for the super admin AdminHods, AdminBatches, AdminUsers |
| `pages/staff/` (14) | StaffDashboard, StaffCourses, StaffAttendance, StaffResults, StaffFeedback, FeedbackFormEditor, StaffMentees, StaffProfile; for a head of department HodMentors, HodAssignments, HodEnrollment, HodCourseCatalogue, StaffStudents, StaffLecturers |

## 2.3 src/app/components

<!-- widths: 22,78 -->
| Folder | What lives there |
|---|---|
| `common/` | The design system: every card, header, table, chart, tab, badge, avatar and empty state the pages share. Section 6. |
| `ui/` | The shadcn/ui building blocks over Radix: button, dialog, select, tabs, switch, popover and the rest (48 files). Pages rarely use these directly for layout; `common/` wraps them. |
| `layout/` | AppShell (the frame), NotificationBell, BrandLoader (the crest with a turning ring) and RouteFallback. |
| `account/` | ChangePasswordDialog, and FirstSignInPassword, which a student with a temporary password sees before anything else. |
| `admin/`, `batches/`, `users/` | The admin dialogs: change a student's intake, correct a grade, the question editor, intake / departments / remove-batch dialogs, add a user. |
| `attendance/`, `results/`, `enrollment/`, `courses/`, `minors/`, `feedback/`, `mentor/`, `notices/`, `planner/`, `dashboard/`, `staff/`, `chat/` | Pieces for one feature each: the QR sign-in and calendar, the results import, the semester baskets and minor selection, the course editor, the minor study plan editor, the Likert grid, the mentor chat, the notice card, the CGPA path chart, the insights panel, the feedback report, the assistant's markdown. |
| `figma/` | ImageWithFallback, a leftover of the Figma Make template the project began from. |
| `ProtectedRoute.tsx` | The route guard (section 3.2). |

## 2.4 The rest of src/app

<!-- widths: 30,70 -->
| Path | What it is |
|---|---|
| `routes.tsx` | The URL map (section 3). |
| `layouts/` | AppLayout (students), StaffLayout (lecturers, heads included), AdminLayout (both admin roles). Each builds its menu and hands it to AppShell. |
| `context/AuthContext.tsx` | The signed-in user, their normalised profile, and for a lecturer the StaffContext (their lecturer id and any department they head). Also signs out a deactivated account. Guide 3 follows it step by step. |
| `context/ThemeContext.tsx` | Light, dark or auto, kept in localStorage under `theme`. |
| `hooks/useNotifications.ts` | One store for the notification list, shared by the bell and the Notifications page, live through Realtime. |
| `hooks/useNotificationCounts.ts` | Every badge count in one call (`get_my_notification_counts`), refreshed when something changes. |
| `hooks/useThreadChannel.ts` | The mentor chat's live channel: new messages, read receipts, and "typing…". |

## 2.5 src/lib

35 modules, no JSX. The services wrap database calls; the rest are calculations and file formats.

<!-- widths: 30,70 -->
| Module | Job |
|---|---|
| `supabase.ts` | Creates the one Supabase client from `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. |
| `types.ts` | The normalised profile and the Role type. |
| `settings.ts` | The regulation engine on the client: reads `system_settings` once, caches it, falls back to the faculty defaults, and offers `getSettings()` and `useSettings()`. |
| `departments.ts` | Each department's name, code and colour classes (stripe, chip, row, hover, text), from the Handbook's own colours. |
| `staffScope.ts`, `adminScope.ts` | What the interface shows a lecturer or an admin. Presentation only; the database decides what is allowed. |
| `staffService.ts`, `feedbackService.ts`, `mentorService.ts`, `registryService.ts` | Grouped database calls for the staff portal, feedback, mentoring and a student's batch changes. |
| `notices.ts`, `notifications.ts` | The notice board and the notification list. |
| `accounts.ts`, `accountGuard.ts` | Calls to the `account` Edge Function; the forced sign-out of a deactivated account. |
| `batches.ts`, `batchIntake.ts` | Calls to `manage-batches`; reading an intake spreadsheet and writing a batch's records out. |
| `graduationPlan.ts`, `splitCourses.ts`, `plannerScenarios.ts` | The planner's arithmetic, courses taught over two semesters, saved scenarios. |
| `minors.ts`, `minorPlan.ts` | A department's minors and their study plans. |
| `attendanceMath.ts`, `attendanceRegister.ts`, `studentAttendance.ts` | Percentages and tiers; the office's register; a student's attendance per delivery. |
| `resultsWorkbook.ts`, `resultSheetPdf.ts`, `feedbackReportPdf.ts` | The Excel results workbook (out and back in), the faculty's result sheet PDF, the feedback report PDF. |
| `chatbotEngine.ts`, `llmAssistant.ts` | The assistant's thin client: send a message, report what happened. |
| `avatars.ts`, `batch.ts`, `format.ts`, `deviceId.ts`, `takeaways.ts` | Photos; batch numbering; registration numbers and dates; a stable id for this browser; the one-line reading under each chart. |

# 3. Routes

## 3.1 One chunk per page

`routes.tsx` lists every URL. Each page is imported lazily, so the browser downloads a page's code only when someone opens it, and the sign-in page arrives without the admin screens, the PDF writer or the chart library behind it.

```
const Results = page(() => import("./pages/Results"));
...
{ path: "/app", element: held(<ProtectedRoute allowedRole="student">
                                 <AppLayout/></ProtectedRoute>),
  children: [
    { index: true,      element: held(<Dashboard/>) },
    { path: "results",  element: held(<Results/>) },
    ...
```

`page()` is `React.lazy` with one addition worth knowing about. After a deploy, a tab that was already open still asks for the old chunk names; the host answers with `index.html`, and the import fails with "Failed to fetch dynamically imported module". So a chunk that fails to load reloads the page once, which fetches the current names. Once, because a genuine failure must be allowed to surface. `held()` wraps each element in Suspense with the crest loader.

## 3.2 The guard

`ProtectedRoute` shows the loader while the session is checked, sends a signed-out visitor to the sign-in page, and sends a signed-in user with the wrong role to their own portal (`homeFor(role)`). It is courtesy, not security — Guide 3, section 6.

## 3.3 The portals

<!-- widths: 22,78 -->
| Prefix | Who, and what |
|---|---|
| `/` | The sign-in page. |
| `/account/setup`, `/account/reset` | Setting a password from an emailed link. No sign-in. |
| `/app` | Students: 15 routes. |
| `/staff` | Lecturers: 15 routes, six of them for a head of department. |
| `/admin` | Admins: 14 routes, three of them for the super admin. |
| anything else | Back to `/`. |

# 4. Where a page's data comes from

## 4.1 Three ways in

1. **A function call** — `supabase.rpc('get_my_graduation_plan')`. Most screens. The database joins, checks and calculates, and hands back exactly what the screen shows.
1. **A table read** — `supabase.from('courses').select(...)`, where Row Level Security alone decides who sees what.
1. **An Edge Function** — `supabase.functions.invoke('account', { body })`, for the assistant, accounts, batches and the website reader.

## 4.2 Services return a Result, not an exception

The service modules return a small tagged value instead of throwing, so a page has to decide what a failure looks like.

```
type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const result = await getFeedbackCatalogue();
if (!result.ok) { setError(result.error); return; }
setRows(result.data);
```

Every page has three states drawn the same way: loading (`SkeletonRows`, `SkeletonHero`), failed (`ErrorState` with a Retry), and empty (`EmptyState` saying what will appear and when).

## 4.3 Shared state

There is no global store library. Shared state is React context (who is signed in, the theme) plus a few small stores in hooks (notifications, badge counts) and the settings cache in `lib/settings.ts`. A page owns its own data and passes it down; when two parts of a page need the same rows, it reads them once and hands them to both.

## 4.4 Live updates

Three things update without a reload, all through Supabase Realtime: the mentor chat (`useThreadChannel`), the notification bell (`useNotifications`), and an attendance register as students check in (`lib/attendanceRegister.ts`, on both the lecturer's and the office's screens). Realtime applies Row Level Security to what it pushes. Behind the chat's socket, a slow poll every 90 seconds catches a message a dropped connection missed.

# 5. The shell

`AppShell` is the frame every signed-in page sits in, for all three portals.

- **The sidebar** — the portal's menu in labelled groups (Academics, Requests and Help for students; Teaching, Mentoring and Department for staff; Records, Curriculum, Communication and Faculty for admins). Counts of things waiting appear beside their item. It collapses to a rail on a wide screen and becomes a drawer on a phone. The super admin's and a head of department's extra items are added by their layout.
- **The header** — the page title, a course search for students, the notification bell with the ten most recent events, and the theme switch.
- **The person** — their photo or initials in their department's colour, and their role.
- **The loader** — `BrandLoader`, the university crest with a turning ring, is the same while the app starts, while a page's chunk arrives, and while a session is checked, so the screen never flashes between three different spinners.

# 6. The design system

Every screen was rebuilt in October 2026 on one set of shared components in `components/common/`. Pages import from `components/common` rather than hand-rolling cards and headers; that is what keeps the three portals looking like one product.

## 6.1 The components

<!-- widths: 32,68 -->
| Component | What it is for |
|---|---|
| `PageHeader` | The page's title, one sentence of description, and its main actions. |
| `HeroCard` | The one number a page is about (a CGPA, an attendance figure), large, with its label, a progress bar, and a footer strip. A soft brand wash, not solid colour. |
| `StatStrip` | A row of small figures as chips: "4 forms to fill in", "15 Nov next deadline". |
| `SectionCard` | Every titled card. Can fold away (`collapsible`), remember whether it was open (`storageKey`), and show a summary when folded. |
| `StatCard`, `ActionCard`, `Reveal` | A figure in a card; a card that links somewhere; a wrapper that fades its child in. |
| `AnimatedNumber`, `AnimatedBar`, `ProgressRing`, `Sparkline` | Numbers that count up and glide to new values; bars with an optional marker (a threshold); a ring; a tiny trend line. |
| `GpaTrendChart`, `CourseAttendanceChart`, `ChartContainer`, `ChartTooltip` | The two charts most pages share, and the frame and tooltip every chart uses. |
| `SearchField`, `Toolbar`, `FilterButton`, `ActiveFilters` | A search box with a clear button; one row of controls; secondary filters in a popover with a count; the filters in force as chips that remove themselves. |
| `SegmentedTabs`, `PillTabs`, `TabPanel` | Tabs with a sliding indicator, and the panel that animates between them. |
| `DataTable` | The one table style: compact rows that highlight on hover, a header that stays in view, and cards instead of a squeezed table at a phone's width. |
| `StatusBadge` | A state in words and colour: success, warning, danger, info, neutral, brand. |
| `PersonAvatar` | A photo, or initials in the person's department colour. |
| `DepartmentBadge`, `DepartmentChips`, `DepartmentSelect`, `CourseCode`, `CourseSelect` | A department's name, dot or stripe in its colour; a course code in its department's colour; pickers that show both. |
| `StickyActionBar` | A bar that rises from the bottom while there is something to save (a register, a sheet, a feedback form). |
| `EmptyState`, `ErrorState`, `Skeleton*` | The three states of section 4.2. |
| `motion.ts` | The shared motion: durations, easing, page entry, card reveal, section expand, tab change. |

## 6.2 The tokens

Every colour, radius, shadow and duration is a CSS variable in `src/styles/theme.css`, defined once for light and once for dark (`.dark` on the page), and exposed to Tailwind as a class. A page never writes a hex colour.

<!-- widths: 26,74 -->
| Group | Tokens |
|---|---|
| Brand | `--primary` (the university crimson) and its scale, `--brand-gold`. |
| Surfaces | `--background`, `--card`, `--muted`, `--border`; `surface-hero` (the soft brand wash), `surface-band` (the crimson band on profiles), `surface-tint`. |
| Status | success, warning, danger, info and neutral, each with `-bg`, `-fg` and `-border` so a badge is readable in both themes. |
| Departments | `--dept-ce`, `--dept-co`, `--dept-ee`, `--dept-is`, `--dept-me`, each with `-fg` and `-soft`: the colours the Handbook prints each department's pages in. |
| Shape | `--radius-card`, `--radius-control`; elevation `sm`, `md`, `lg`. |
| Motion | `--motion-fast`, `--motion-base`, `--motion-slow`, `--motion-ease`. |

:::why DEPARTMENT COLOUR IS IDENTITY, NEVER STATUS
An amber stripe means "Computer Engineering", not "warning". Status keeps its own tokens. `lib/departments.ts` turns a department name or a course code into its classes, and writes every class name out in full, because Tailwind only generates the classes it can find written in the source.
:::

## 6.3 Accessibility and motion

- Every control is reachable by keyboard, with a visible focus ring; icons that carry meaning have a label, and decorative ones are hidden from screen readers.
- Tabs, radio groups and toggles use the right roles (`role="radio"`, `aria-pressed`), so a screen reader hears a choice, not a button.
- Motion is short and purposeful, and `MotionConfig reducedMotion="user"` turns movement into plain fades for anyone who asked their device for less.
- Every screen is checked at a phone's width; a table becomes cards, and nothing scrolls sideways.

# 7. Conventions worth keeping

**Comments say why.** The code's comments explain the reason a line is the way it is — often a bug it prevents — rather than what the line does. When you change one, keep the reason or replace it.

**Strict TypeScript, no escape hatches.** No `any`, no `@ts-ignore`. `npm run typecheck` and `npm run build` must both pass before a commit.

**A select cannot hold an empty value.** Radix's Select refuses `""`, so "none" or "all" gets a sentinel value (`"__none__"`, `"__all__"`) that the page translates back. Every select in the app is the shared one; there are no native browser dropdowns left.

**Presentation is not permission.** `staffScope.ts` and `adminScope.ts` decide what is shown. A rule that matters is in the database too.

**Numbers come from one place.** A GPA, a percentage or a target is calculated in `src/lib/` or in the database, never in a component, so a page, a PDF and the assistant cannot disagree.

**Say each fact once.** A redesign rule: if a figure is already on the screen, the next card does not repeat it.

# 8. Files the browser writes

<!-- widths: 30,70 -->
| File | Made by |
|---|---|
| The faculty's result sheet (PDF) | `resultSheetPdf.ts` with jsPDF and jspdf-autotable, laid out like the printed one. |
| A lecturer's feedback report (PDF) | `feedbackReportPdf.ts`, through the same functions as the screen, so it cannot show anything the screen would not. |
| The results workbook (Excel) | `resultsWorkbook.ts` with ExcelJS: written for a sheet to fill in, and read back on import. |
| A batch's records, an intake template (Excel) | `batchIntake.ts`. |

ExcelJS is loaded only when a spreadsheet is actually made or read, and jsPDF arrives only with the pages that print, so nobody downloads either to look at their dashboard.

# 9. Adding a page

1. Write the page in `src/app/pages/` (or `admin/`, `staff/`), built from `components/common`: a `PageHeader`, then cards.
1. Put any calculation in `src/lib/`, and any database call in a service there or a new database function.
1. Add the route in `routes.tsx` with `page()` and `held()`, under the right portal.
1. Add the menu item in the portal's layout, in the right group, gated for heads or the super admin if it is theirs.
1. If it reads new data, write the database function first, with its role check and its grants (Guide 4, section 8), and save the migration.
1. Check it signed in as each role that should see it, and as one that should not; check it at a phone's width and in dark mode.
1. Run `npm run typecheck` and `npm run build`.

# 10. Leftovers to know about

The project began from a Figma Make template, and a few traces remain. The package is still named `@figma/my-make-file`. Several dependencies are installed but used nowhere in `src/`: Material UI and Emotion, react-slick, react-dnd, react-responsive-masonry, next-themes, canvas-confetti and the Popper packages. They cost nothing at runtime — a bundler only includes what is imported — but they lengthen installs and could be removed in a tidy-up. `components/figma/` and `src/imports/` hold template remnants too. The comment in `vite.config.ts` about `@huggingface/transformers` refers to an in-browser embedding experiment the assistant no longer uses.
