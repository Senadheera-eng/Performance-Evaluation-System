import { useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Calendar,
  TrendingUp,
  Users,
  BookOpen,
  Shield,
  FileHeart,
  MessageSquareText,
  GraduationCap,
  UserCog,
} from "lucide-react";
import { AppShell, type ShellNavItem } from "../components/layout/AppShell";
import { useAuth } from "../context/AuthContext";
import {
  useNotificationCounts,
  withBadges,
} from "../hooks/useNotificationCounts";
import { describeAdminScope } from "../../lib/adminScope";

const navigation: ShellNavItem[] = [
  { name: "Dashboard", href: "/admin", icon: LayoutDashboard },
  { name: "Attendance", href: "/admin/attendance", icon: Calendar },
  { name: "Results", href: "/admin/results", icon: TrendingUp },
  { name: "Students", href: "/admin/students", icon: Users },
  { name: "Courses", href: "/admin/courses", icon: BookOpen },
  { name: "Medical", href: "/admin/medical", icon: FileHeart },
  { name: "Feedback", href: "/admin/feedback", icon: MessageSquareText },
  { name: "Enrollment", href: "/admin/enrollment", icon: GraduationCap },
];

/* A headship covers a whole department, so it is granted from the faculty
   level. A department admin has no business appointing their own head, and
   the RPC refuses them — the sidebar should say so before they click. */
const superAdminOnly: ShellNavItem[] = [
  { name: "Heads of Department", href: "/admin/hods", icon: UserCog },
];

/* Marking a lecture register is departmental work, done against a course a
   department delivers. The super admin runs the faculty, not a lecture, and
   has no reason to read a named student's attendance day by day. */
const notForSuperAdmin = new Set(["/admin/attendance"]);

export default function AdminLayout() {
  const navigate = useNavigate();
  const { signOut, student } = useAuth();
  const counts = useNotificationCounts();

  const items =
    student?.role === "super_admin"
      ? [
          ...navigation.filter((i) => !notForSuperAdmin.has(i.href)),
          ...superAdminOnly,
        ]
      : navigation;

  const handleLogout = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <AppShell
      brandTitle="PES Admin"
      brandSubtitle="Department Management"
      navigation={withBadges(items, counts)}
      roleBadge={{
        label:
          student?.role === "super_admin" ? "Super Admin" : "Department Admin",
        icon: Shield,
      }}
      userName={student?.name ?? "Admin"}
      userMeta={describeAdminScope(student)}
      homeHref="/admin"
      headerSubtitle="Faculty of Engineering — USJ"
      onLogout={handleLogout}
      showNotifications
    />
  );
}
