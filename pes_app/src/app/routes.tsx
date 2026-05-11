import { createBrowserRouter } from "react-router-dom";
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

export const router = createBrowserRouter([
  {
    path: "/",
    element: <LoginPage />,
  },
  {
    path: "/app",
    element: <AppLayout />,
    children: [
      {
        index: true,
        element: <Dashboard />,
      },
      {
        path: "courses",
        element: <Courses />,
      },
      {
        path: "attendance",
        element: <Attendance />,
      },
      {
        path: "results",
        element: <Results />,
      },
      {
        path: "enrollment",
        element: <Enrollment />,
      },
      {
        path: "ai-assistant",
        element: <AIAssistant />,
      },
      {
        path: "profile",
        element: <Profile />,
      },
      {
        path: "settings",
        element: <Settings />,
      },
    ],
  },
]);
