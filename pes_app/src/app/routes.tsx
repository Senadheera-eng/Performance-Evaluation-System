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
import ProtectedRoute from "./components/ProtectedRoute";

// Admin imports
import AdminLayout from "./layouts/AdminLayout";
import AdminDashboard from "./pages/admin/AdminDashboard";
import AdminAttendance from "./pages/admin/AdminAttendance";
import AdminResults from "./pages/admin/AdminResults";
import AdminStudents from "./pages/admin/AdminStudents";
import AdminCourses from "./pages/admin/AdminCourses";

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
      { path: "ai-assistant", element: <AIAssistant /> },
      { path: "profile", element: <Profile /> },
      { path: "settings", element: <Settings /> },
    ],
  },
  {
    path: "/admin",
    element: (
      <ProtectedRoute allowedRole="dept_admin">
        <AdminLayout />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <AdminDashboard /> },
      { path: "attendance", element: <AdminAttendance /> },
      { path: "results", element: <AdminResults /> },
      { path: "students", element: <AdminStudents /> },
      { path: "courses", element: <AdminCourses /> },
    ],
  },
  {
    path: "*",
    element: <Navigate to="/" replace />,
  },
]);
