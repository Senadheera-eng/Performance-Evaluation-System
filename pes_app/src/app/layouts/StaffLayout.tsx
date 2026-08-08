import { useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  BookOpen,
  Calendar,
  TrendingUp,
  GraduationCap,
  Users,
  UserSquare,
  Presentation,
} from "lucide-react";
import { AppShell, type ShellNavItem } from "../components/layout/AppShell";
import { useAuth } from "../context/AuthContext";
import { describeStaffScope, getStaffCapabilities } from "../../lib/staffScope";

/**
 * One shell for every lecturer, head of department included.
 *
 * A head of department is a lecturer with an appointment, so they get the
 * lecturer navigation plus the department items — not a second layout. That
 * keeps the two from drifting apart, and means the day an appointment ends
 * the extra items simply stop appearing.
 */
export default function StaffLayout() {
  const navigate = useNavigate();
  const { signOut, student, staff } = useAuth();
  const caps = getStaffCapabilities(staff);

  const navigation: ShellNavItem[] = [
    { name: "Dashboard", href: "/staff", icon: LayoutDashboard },
    { name: "My Courses", href: "/staff/courses", icon: BookOpen },
    { name: "Attendance", href: "/staff/attendance", icon: Calendar },
    { name: "Results", href: "/staff/results", icon: TrendingUp },
    ...(caps.isHod
      ? [
          {
            name: "Course Assignments",
            href: "/staff/assignments",
            icon: GraduationCap,
          },
          { name: "Students", href: "/staff/students", icon: UserSquare },
          { name: "Department Staff", href: "/staff/lecturers", icon: Users },
        ]
      : []),
  ];

  const handleLogout = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <AppShell
      brandTitle={caps.isHod ? "PES Department" : "PES Staff"}
      brandSubtitle={caps.isHod ? "Head of Department" : "Lecturer Portal"}
      navigation={navigation}
      roleBadge={{
        label: caps.isHod ? "Head of Department" : "Lecturer",
        icon: Presentation,
      }}
      userName={student?.name ?? "Lecturer"}
      userMeta={describeStaffScope(staff)}
      homeHref="/staff"
      headerSubtitle="Faculty of Engineering — USJ"
      onLogout={handleLogout}
    />
  );
}
