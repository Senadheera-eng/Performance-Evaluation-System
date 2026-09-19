import { useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  BookOpen,
  Calendar,
  TrendingUp,
  Bot,
  User,
  Settings,
  GraduationCap,
  FileHeart,
  Target,
  MessageSquareText,
  UserRound,
  Megaphone,
} from "lucide-react";
import { AppShell, type ShellNavItem } from "../components/layout/AppShell";
import { useAuth } from "../context/AuthContext";
import {
  useNotificationCounts,
  withBadges,
} from "../hooks/useNotificationCounts";
import { formatRegNumber } from "../../lib/format";

const navigation: ShellNavItem[] = [
  { name: "Dashboard", href: "/app", icon: LayoutDashboard },
  { name: "Courses", href: "/app/courses", icon: BookOpen },
  { name: "Attendance", href: "/app/attendance", icon: Calendar },
  { name: "Medical Certificates", href: "/app/medical", icon: FileHeart },
  { name: "Results", href: "/app/results", icon: TrendingUp },
  { name: "Notices", href: "/app/notices", icon: Megaphone },
  { name: "Enrollment", href: "/app/enrollment", icon: GraduationCap },
  { name: "Feedback", href: "/app/feedback", icon: MessageSquareText },
  { name: "Mentor", href: "/app/mentor", icon: UserRound },
  { name: "Graduation Planner", href: "/app/planner", icon: Target },
  { name: "AI Assistant", href: "/app/ai-assistant", icon: Bot, badge: "New" },
];

const bottomNavigation: ShellNavItem[] = [
  { name: "Profile", href: "/app/profile", icon: User },
  { name: "Settings", href: "/app/settings", icon: Settings },
];

export default function AppLayout() {
  const navigate = useNavigate();
  const { signOut, student } = useAuth();
  const counts = useNotificationCounts();

  const handleLogout = async () => {
    await signOut();
    navigate("/");
  };

  const meta = [
    student?.index_number,
    student?.reg_number ? formatRegNumber(student.reg_number) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <AppShell
      brandTitle="PES"
      brandSubtitle="Performance System"
      navigation={withBadges(navigation, counts)}
      bottomNavigation={bottomNavigation}
      userName={student?.name ?? "Student"}
      userMeta={meta || "Student"}
      homeHref="/app"
      headerSubtitle="Faculty of Engineering — USJ"
      onProfileClick={() => navigate("/app/profile")}
      onLogout={handleLogout}
      showSearch
      showNotifications
    />
  );
}
