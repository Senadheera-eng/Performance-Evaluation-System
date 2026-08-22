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

export default function AdminLayout() {
  const navigate = useNavigate();
  const { signOut, student } = useAuth();
  const counts = useNotificationCounts();

  const handleLogout = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <AppShell
      brandTitle="PES Admin"
      brandSubtitle="Department Management"
      navigation={withBadges(navigation, counts)}
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
    />
  );
}
