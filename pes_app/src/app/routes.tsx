import { createBrowserRouter, Navigate } from "react-router-dom";
import LoginPage from "./pages/LoginPage";
import AppLayout from "./layouts/AppLayout";
import Dashboard from "./pages/Dashboard";
import Courses from "./pages/Courses";
import Attendance from "./pages/Attendance";
import Results from "./pages/Results";
import AIAssistant from "./pages/AIAssistant";
import Profile from "./pages/Profile";
import Settings from "./pages/Settings";
import Enrollment from "./pages/Enrollment";
import MedicalCertificates from "./pages/MedicalCertificates";
import Feedback from "./pages/Feedback";
import FeedbackForm from "./pages/FeedbackForm";
import GraduationPlanner from "./pages/GraduationPlanner";
import ProtectedRoute from "./components/ProtectedRoute";

// Admin imports
import AdminLayout from "./layouts/AdminLayout";
import AdminDashboard from "./pages/admin/AdminDashboard";
import AdminAttendance from "./pages/admin/AdminAttendance";
import AdminResults from "./pages/admin/AdminResults";
import AdminStudents from "./pages/admin/AdminStudents";
import AdminCourses from "./pages/admin/AdminCourses";
import AdminMedical from "./pages/admin/AdminMedical";
import AdminFeedback from "./pages/admin/AdminFeedback";
import AdminEnrollment from "./pages/admin/AdminEnrollment";

// Staff (lecturer + HOD) imports. One portal for both: a head of department
// is a lecturer with an appointment, so they get extra routes, not a
// different area.
import StaffLayout from "./layouts/StaffLayout";
import StaffDashboard from "./pages/staff/StaffDashboard";
import StaffCourses from "./pages/staff/StaffCourses";
import StaffAttendance from "./pages/staff/StaffAttendance";
import StaffResults from "./pages/staff/StaffResults";
import HodAssignments from "./pages/staff/HodAssignments";
import StaffStudents from "./pages/staff/StaffStudents";
import StaffLecturers from "./pages/staff/StaffLecturers";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <LoginPage />,
  },
  {
    path: "/app",
    element: (
      <ProtectedRoute allowedRole="student">
        <AppLayout />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <Dashboard /> },
      { path: "courses", element: <Courses /> },
      { path: "attendance", element: <Attendance /> },
      { path: "results", element: <Results /> },
      { path: "enrollment", element: <Enrollment /> },
      { path: "medical", element: <MedicalCertificates /> },
      { path: "feedback", element: <Feedback /> },
      { path: "feedback/:courseId", element: <FeedbackForm /> },
      { path: "planner", element: <GraduationPlanner /> },
      { path: "ai-assistant", element: <AIAssistant /> },
      { path: "profile", element: <Profile /> },
      { path: "settings", element: <Settings /> },
    ],
  },
  {
    path: "/admin",
    element: (
      <ProtectedRoute allowedRole={["dept_admin", "super_admin"]}>
        <AdminLayout />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <AdminDashboard /> },
      { path: "attendance", element: <AdminAttendance /> },
      { path: "results", element: <AdminResults /> },
      { path: "students", element: <AdminStudents /> },
      { path: "courses", element: <AdminCourses /> },
      { path: "medical", element: <AdminMedical /> },
      { path: "feedback", element: <AdminFeedback /> },
      { path: "enrollment", element: <AdminEnrollment /> },
    ],
  },
  {
    path: "/staff",
    element: (
      <ProtectedRoute allowedRole="lecturer">
        <StaffLayout />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <StaffDashboard /> },
      { path: "courses", element: <StaffCourses /> },
      { path: "attendance", element: <StaffAttendance /> },
      { path: "results", element: <StaffResults /> },
      // HOD-only in the navigation; the pages themselves also refuse a
      // lecturer who opens the URL directly, and the RPCs behind them refuse
      // regardless of what the client does.
      { path: "assignments", element: <HodAssignments /> },
      { path: "students", element: <StaffStudents /> },
      { path: "lecturers", element: <StaffLecturers /> },
    ],
  },
  {
    path: "*",
    element: <Navigate to="/" replace />,
  },
]);
