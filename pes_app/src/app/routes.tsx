import { Suspense, lazy, type ComponentType } from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";
import LoginPage from "./pages/LoginPage";
import ProtectedRoute from "./components/ProtectedRoute";
import { RouteFallback } from "./components/layout/RouteFallback";

/**
 * Routes, with every page behind its own chunk.
 *
 * Importing all thirty pages at the top meant one 2.8 MB bundle: a student
 * signing in downloaded the admin results screens, the head of department's
 * mentor allocation, the PDF writer and the charting library before the login
 * form could render, and then used none of them.
 *
 * The login page stays eagerly imported — it is the one screen every visitor
 * sees, and deferring it would only add a spinner in front of the first
 * paint. Everything else arrives when someone navigates to it.
 */
/**
 * A tab that was open across a deploy is holding a map to files that no
 * longer exist.
 *
 * Every page here is a separate hashed chunk, and a deploy replaces the lot.
 * A browser that loaded index.html an hour ago still asks for the old names;
 * the host answers a 404 with index.html, the browser is handed HTML where it
 * expected JavaScript, and React Router shows "Failed to fetch dynamically
 * imported module" — which looks like a broken feature and is really just a
 * stale tab. It happens on any route, and it happened on Notices only because
 * that was the new one being clicked.
 *
 * So a chunk that fails to load reloads the page once, which fetches the
 * current index.html and with it the current asset names. Once, because a
 * genuine failure — the file is really missing, the network is really down —
 * must be allowed to surface rather than spin. The flag lives in
 * sessionStorage so the one retry is per tab, and is cleared as soon as any
 * chunk loads successfully.
 */
const RELOAD_FLAG = "pes.chunk-reloaded";

const page = <T extends ComponentType<unknown>>(
  load: () => Promise<{ default: T }>,
) =>
  lazy(() =>
    load()
      .then((mod) => {
        sessionStorage.removeItem(RELOAD_FLAG);
        return mod;
      })
      .catch((error: unknown) => {
        if (sessionStorage.getItem(RELOAD_FLAG)) throw error;
        sessionStorage.setItem(RELOAD_FLAG, "1");
        window.location.reload();
        /* Never settles: the reload takes the page away before React could
           render anything from it, and resolving would flash an error first. */
        return new Promise<{ default: T }>(() => {});
      }),
  );

/* Student */
const Dashboard = page(() => import("./pages/Dashboard"));
const Courses = page(() => import("./pages/Courses"));
const Attendance = page(() => import("./pages/Attendance"));
const Results = page(() => import("./pages/Results"));
const AIAssistant = page(() => import("./pages/AIAssistant"));
const Profile = page(() => import("./pages/Profile"));
const Settings = page(() => import("./pages/Settings"));
const StaffProfile = page(() => import("./pages/staff/StaffProfile"));
const Enrollment = page(() => import("./pages/Enrollment"));
const MedicalCertificates = page(() => import("./pages/MedicalCertificates"));
const Feedback = page(() => import("./pages/Feedback"));
const GraduationPlanner = page(() => import("./pages/GraduationPlanner"));
const Mentor = page(() => import("./pages/Mentor"));
/* One page, three portals. What differs per role was already decided
   when the notification was written, not here. */
const Notifications = page(() => import("./pages/Notifications"));
/* The notice board: one reader page for students, one publisher page
   shared by everyone who may publish. Which scopes a publisher may use is
   decided by the database, not by which portal they came in through. */
const Notices = page(() => import("./pages/Notices"));
const NoticeDetail = page(() => import("./pages/NoticeDetail"));
const ManageNotices = page(() => import("./pages/ManageNotices"));
const AppLayout = page(() => import("./layouts/AppLayout"));

/* Admin */
const AdminLayout = page(() => import("./layouts/AdminLayout"));
const AdminDashboard = page(() => import("./pages/admin/AdminDashboard"));
const AdminAttendance = page(() => import("./pages/admin/AdminAttendance"));
const AdminResults = page(() => import("./pages/admin/AdminResults"));
const AdminStudents = page(() => import("./pages/admin/AdminStudents"));
const AdminCourses = page(() => import("./pages/admin/AdminCourses"));
const AdminMedical = page(() => import("./pages/admin/AdminMedical"));
const AdminFeedback = page(() => import("./pages/admin/AdminFeedback"));
const AdminEnrollment = page(() => import("./pages/admin/AdminEnrollment"));
const AdminHods = page(() => import("./pages/admin/AdminHods"));

/* Staff (lecturer + HOD). One portal for both: a head of department is a
   lecturer with an appointment, so they get extra routes, not a different
   area. */
const StaffLayout = page(() => import("./layouts/StaffLayout"));
const StaffDashboard = page(() => import("./pages/staff/StaffDashboard"));
const StaffCourses = page(() => import("./pages/staff/StaffCourses"));
const StaffAttendance = page(() => import("./pages/staff/StaffAttendance"));
const StaffResults = page(() => import("./pages/staff/StaffResults"));
const StaffFeedback = page(() => import("./pages/staff/StaffFeedback"));
const HodAssignments = page(() => import("./pages/staff/HodAssignments"));
const HodEnrollment = page(() => import("./pages/staff/HodEnrollment"));
/* The department's catalogue and its minors: the same screen the department
   office uses, opened on the head's own department. */
const HodCourseCatalogue = page(() => import("./pages/staff/HodCourseCatalogue"));
/* Shaping one course's feedback form while the round is still a draft. */
const FeedbackFormEditor = page(() => import("./pages/staff/FeedbackFormEditor"));
const HodMentors = page(() => import("./pages/staff/HodMentors"));
const StaffMentees = page(() => import("./pages/staff/StaffMentees"));
const StaffStudents = page(() => import("./pages/staff/StaffStudents"));
const StaffLecturers = page(() => import("./pages/staff/StaffLecturers"));

/** Wraps a lazy element so its chunk can arrive without a blank screen. */
const held = (element: React.ReactNode) => (
  <Suspense fallback={<RouteFallback />}>{element}</Suspense>
);

export const router = createBrowserRouter([
  {
    path: "/",
    element: <LoginPage />,
  },
  {
    path: "/app",
    element: held(
      <ProtectedRoute allowedRole="student">
        <AppLayout />
      </ProtectedRoute>,
    ),
    children: [
      { index: true, element: held(<Dashboard />) },
      { path: "courses", element: held(<Courses />) },
      { path: "attendance", element: held(<Attendance />) },
      { path: "results", element: held(<Results />) },
      { path: "enrollment", element: held(<Enrollment />) },
      { path: "medical", element: held(<MedicalCertificates />) },
      { path: "feedback", element: held(<Feedback />) },
      { path: "mentor", element: held(<Mentor />) },
      { path: "planner", element: held(<GraduationPlanner />) },
      { path: "ai-assistant", element: held(<AIAssistant />) },
      { path: "notifications", element: held(<Notifications />) },
      { path: "notices", element: held(<Notices />) },
      { path: "notices/:noticeId", element: held(<NoticeDetail />) },
      { path: "profile", element: held(<Profile />) },
      { path: "settings", element: held(<Settings />) },
    ],
  },
  {
    path: "/admin",
    element: held(
      <ProtectedRoute allowedRole={["dept_admin", "super_admin"]}>
        <AdminLayout />
      </ProtectedRoute>,
    ),
    children: [
      { index: true, element: held(<AdminDashboard />) },
      { path: "attendance", element: held(<AdminAttendance />) },
      { path: "results", element: held(<AdminResults />) },
      { path: "students", element: held(<AdminStudents />) },
      { path: "courses", element: held(<AdminCourses />) },
      { path: "medical", element: held(<AdminMedical />) },
      { path: "feedback", element: held(<AdminFeedback />) },
      { path: "enrollment", element: held(<AdminEnrollment />) },
      { path: "hods", element: held(<AdminHods />) },
      { path: "notices", element: held(<ManageNotices />) },
      { path: "notifications", element: held(<Notifications />) },
    ],
  },
  {
    path: "/staff",
    element: held(
      <ProtectedRoute allowedRole="lecturer">
        <StaffLayout />
      </ProtectedRoute>,
    ),
    children: [
      { index: true, element: held(<StaffDashboard />) },
      { path: "courses", element: held(<StaffCourses />) },
      { path: "attendance", element: held(<StaffAttendance />) },
      { path: "results", element: held(<StaffResults />) },
      { path: "feedback", element: held(<StaffFeedback />) },
      {
        path: "feedback/:periodId/:courseId/form",
        element: held(<FeedbackFormEditor />),
      },
      // Every lecturer may mentor, so this one is not HOD-gated. The RPC
      // behind it returns only the caller's own mentees, so a lecturer with
      // none simply sees an empty page.
      { path: "mentees", element: held(<StaffMentees />) },
      // HOD-only in the navigation; the pages themselves also refuse a
      // lecturer who opens the URL directly, and the RPCs behind them refuse
      // regardless of what the client does.
      { path: "mentors", element: held(<HodMentors />) },
      { path: "assignments", element: held(<HodAssignments />) },
      { path: "enrollment", element: held(<HodEnrollment />) },
      { path: "catalogue", element: held(<HodCourseCatalogue />) },
      { path: "students", element: held(<StaffStudents />) },
      { path: "lecturers", element: held(<StaffLecturers />) },
      { path: "profile", element: held(<StaffProfile />) },
      { path: "notices", element: held(<ManageNotices />) },
      { path: "notifications", element: held(<Notifications />) },
    ],
  },
  {
    path: "*",
    element: <Navigate to="/" replace />,
  },
]);
