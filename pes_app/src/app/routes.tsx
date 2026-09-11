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
const page = <T extends ComponentType<unknown>>(
  load: () => Promise<{ default: T }>,
) => lazy(load);

/* Student */
const Dashboard = page(() => import("./pages/Dashboard"));
const Courses = page(() => import("./pages/Courses"));
const Attendance = page(() => import("./pages/Attendance"));
const Results = page(() => import("./pages/Results"));
const AIAssistant = page(() => import("./pages/AIAssistant"));
const Profile = page(() => import("./pages/Profile"));
const Settings = page(() => import("./pages/Settings"));
const Enrollment = page(() => import("./pages/Enrollment"));
const MedicalCertificates = page(() => import("./pages/MedicalCertificates"));
const Feedback = page(() => import("./pages/Feedback"));
const FeedbackForm = page(() => import("./pages/FeedbackForm"));
const GraduationPlanner = page(() => import("./pages/GraduationPlanner"));
const Mentor = page(() => import("./pages/Mentor"));
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
      { path: "feedback/:courseId", element: held(<FeedbackForm />) },
      { path: "mentor", element: held(<Mentor />) },
      { path: "planner", element: held(<GraduationPlanner />) },
      { path: "ai-assistant", element: held(<AIAssistant />) },
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
      { path: "students", element: held(<StaffStudents />) },
      { path: "lecturers", element: held(<StaffLecturers />) },
    ],
  },
  {
    path: "*",
    element: <Navigate to="/" replace />,
  },
]);
