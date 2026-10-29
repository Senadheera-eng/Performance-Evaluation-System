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
  Layers,
  UsersRound,
} from "lucide-react";
import { AppShell, type ShellNavItem } from "../components/layout/AppShell";
import { useAuth } from "../context/AuthContext";
import {
  useNotificationCounts,
  withBadges,
} from "../hooks/useNotificationCounts";
import { describeAdminScope } from "../../lib/adminScope";

/* In sections: students' records, the curriculum, and notices. */
const navigation: ShellNavItem[] = [
  { name: "Dashboard", href: "/admin", icon: LayoutDashboard },
  { name: "Attendance", href: "/admin/attendance", icon: Calendar, group: "Records" },
  { name: "Results", href: "/admin/results", icon: TrendingUp, group: "Records" },
  { name: "Students", href: "/admin/students", icon: Users, group: "Records" },
  { name: "Medical", href: "/admin/medical", icon: FileHeart, group: "Records" },
  { name: "Courses", href: "/admin/courses", icon: BookOpen, group: "Curriculum" },
  { name: "Enrollment", href: "/admin/enrollment", icon: GraduationCap, group: "Curriculum" },
  { name: "Feedback", href: "/admin/feedback", icon: MessageSquareText, group: "Curriculum" },
  { name: "Notices", href: "/admin/notices", icon: Megaphone, group: "Communication" },
];

/* Faculty-level work. A headship covers a whole department, so it is granted
   from the faculty level; a batch is the whole faculty's, so bringing one in
   or removing it is too. The RPCs refuse a department admin either way — the
   sidebar should say so before they click. */
const superAdminOnly: ShellNavItem[] = [
  { name: "Users", href: "/admin/users", icon: UsersRound, group: "Faculty" },
  { name: "Batches", href: "/admin/batches", icon: Layers, group: "Faculty" },
  { name: "Heads of Department", href: "/admin/hods", icon: UserCog, group: "Faculty" },
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
