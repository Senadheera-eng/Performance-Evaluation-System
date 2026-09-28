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
  UserRound,
  Megaphone,
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
  { name: "Notices", href: "/admin/notices", icon: Megaphone },
];

/* A headship covers a whole department, so it is granted from the faculty
   level. A department admin has no business appointing their own head, and
   the RPC refuses them — the sidebar should say so before they click. */
const superAdminOnly: ShellNavItem[] = [
  { name: "Heads of Department", href: "/admin/hods", icon: UserCog },
];

export default function AdminLayout() {
  const navigate = useNavigate();
  const { signOut, student } = useAuth();
  const counts = useNotificationCounts();

  /* Attendance used to be kept from the super admin as departmental work.
     First-year courses are common ones, delivered before a student has
     settled into a department, so leaving them to a department office meant
     leaving them to nobody. The faculty keeps those registers itself. */
  const items =
    student?.role === "super_admin"
      ? [...navigation, ...superAdminOnly]
      : navigation;

  const handleLogout = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <AppShell
      /* The system's name, as in the other portals; the role is the badge
         below it. */
      brandTitle="PES"
      brandSubtitle="Performance Evaluation System"
      navigation={withBadges(items, counts)}
      roleBadge={{
        label:
          student?.role === "super_admin" ? "Super Admin" : "Department Admin",
        icon: Shield,
      }}
      bottomNavigation={[
        { name: "My Profile", href: "/admin/profile", icon: UserRound },
      ]}
      userName={student?.name ?? "Admin"}
      userAvatarUrl={student?.avatar_url}
      userDepartment={student?.department}
      userMeta={describeAdminScope(student)}
      homeHref="/admin"
      headerSubtitle="Faculty of Engineering — USJ"
      onProfileClick={() => navigate("/admin/profile")}
      onLogout={handleLogout}
      showNotifications
    />
  );
}
