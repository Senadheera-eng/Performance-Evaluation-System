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
import { FirstSignInPassword } from "../components/account/FirstSignInPassword";

/* In sections, so the eye finds a page by what it is for: studying,
   asking for something, or getting help. Same pages, same names. */
const navigation: ShellNavItem[] = [
  { name: "Dashboard", href: "/app", icon: LayoutDashboard },
  { name: "Courses", href: "/app/courses", icon: BookOpen, group: "Academics" },
  { name: "Results", href: "/app/results", icon: TrendingUp, group: "Academics" },
  { name: "Attendance", href: "/app/attendance", icon: Calendar, group: "Academics" },
  { name: "Enrollment", href: "/app/enrollment", icon: GraduationCap, group: "Academics" },
  { name: "Graduation Planner", href: "/app/planner", icon: Target, group: "Academics" },
  { name: "Medical Certificates", href: "/app/medical", icon: FileHeart, group: "Requests" },
  { name: "Feedback", href: "/app/feedback", icon: MessageSquareText, group: "Requests" },
  { name: "Mentor", href: "/app/mentor", icon: UserRound, group: "Help" },
  { name: "AI Assistant", href: "/app/ai-assistant", icon: Bot, badge: "New", group: "Help" },
  { name: "Notices", href: "/app/notices", icon: Megaphone, group: "Help" },
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
    <>
      <FirstSignInPassword />
      <AppShell
        brandTitle="PES"
        brandSubtitle="Performance Evaluation System"
        navigation={withBadges(navigation, counts)}
        bottomNavigation={bottomNavigation}
        userName={student?.name ?? "Student"}
        userAvatarUrl={student?.avatar_url}
        userDepartment={student?.department}
        userMeta={meta || "Student"}
        homeHref="/app"
        headerSubtitle="Faculty of Engineering — USJ"
        onProfileClick={() => navigate("/app/profile")}
        onLogout={handleLogout}
        showSearch
        showNotifications
      />
    </>
  );
}
