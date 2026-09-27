import { useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  BookOpen,
  Calendar,
  TrendingUp,
  MessageSquareText,
  ClipboardList,
  GraduationCap,
  HeartHandshake,
  Users,
  UserRoundCog,
  UserSquare,
  Presentation,
  Megaphone,
  UserRound,
} from "lucide-react";
import { AppShell, type ShellNavItem } from "../components/layout/AppShell";
import { useAuth } from "../context/AuthContext";
import {
  useNotificationCounts,
  withBadges,
} from "../hooks/useNotificationCounts";
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
  const counts = useNotificationCounts();

  const navigation: ShellNavItem[] = [
    { name: "Dashboard", href: "/staff", icon: LayoutDashboard },
    { name: "My Courses", href: "/staff/courses", icon: BookOpen },
    { name: "Attendance", href: "/staff/attendance", icon: Calendar },
    { name: "Results", href: "/staff/results", icon: TrendingUp },
    { name: "Feedback", href: "/staff/feedback", icon: MessageSquareText },
    // Every lecturer publishes for the courses they teach; the wider
    // scopes are refused by the database, not hidden here.
    { name: "Notices", href: "/staff/notices", icon: Megaphone },
    // Mentoring belongs to every lecturer, not only the head — a lecturer
    // with no mentees sees an empty page rather than a missing one.
    { name: "My Mentees", href: "/staff/mentees", icon: HeartHandshake },
    ...(caps.isHod
      ? [
          {
            name: "Mentor Allocation",
            href: "/staff/mentors",
            icon: UserRoundCog,
          },
          {
            name: "Course Assignments",
            href: "/staff/assignments",
            icon: GraduationCap,
          },
          /* The catalogue itself — creating a course, editing one, and the
             department's minor streams. The same screen the department
             office uses, and the same row policies behind it. */
          {
            name: "Course Catalogue",
            href: "/staff/catalogue",
            icon: BookOpen,
          },
          // View-only: a head reviews who enrolled, the Super Admin opens the
          // windows. A lecturer without the appointment never sees this, and
          // would be refused by the page and the database if they typed the URL.
          { name: "Enrolment", href: "/staff/enrollment", icon: ClipboardList },
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
      /* The system's name, as on the student portal. The role is the
         badge just below, which said "Head of Department" a second time
         when it was the subtitle too. */
      brandTitle="PES"
      brandSubtitle="Performance Evaluation System"
      navigation={withBadges(navigation, counts)}
      roleBadge={{
        label: caps.isHod ? "Head of Department" : "Lecturer",
        icon: Presentation,
      }}
      bottomNavigation={[
        { name: "My Profile", href: "/staff/profile", icon: UserRound },
      ]}
      userName={student?.name ?? "Lecturer"}
      userAvatarUrl={student?.avatar_url}
      userDepartment={student?.department}
      onProfileClick={() => navigate("/staff/profile")}
      userMeta={describeStaffScope(staff)}
      homeHref="/staff"
      headerSubtitle="Faculty of Engineering — USJ"
      onLogout={handleLogout}
      showNotifications
    />
  );
}
