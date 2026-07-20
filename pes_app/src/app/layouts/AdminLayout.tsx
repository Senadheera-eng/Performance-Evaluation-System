import { useState } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Calendar,
  TrendingUp,
  Users,
  BookOpen,
  LogOut,
  Menu,
  X,
  ChevronDown,
  Shield,
  Moon,
  Sun,
  FileHeart,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Avatar, AvatarFallback } from "../components/ui/avatar";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { describeAdminScope } from "../../lib/adminScope";

const universityLogo = new URL("../../assets/logo.jpg", import.meta.url).href;

const navigation = [
  { name: "Dashboard", href: "/admin", icon: LayoutDashboard },
  { name: "Attendance", href: "/admin/attendance", icon: Calendar },
  { name: "Results", href: "/admin/results", icon: TrendingUp },
  { name: "Students", href: "/admin/students", icon: Users },
  { name: "Courses", href: "/admin/courses", icon: BookOpen },
  { name: "Medical", href: "/admin/medical", icon: FileHeart },
];

export default function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { signOut, student } = useAuth();
  const { theme, setTheme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const isActive = (href: string) => {
    if (href === "/admin") return location.pathname === "/admin";
    return location.pathname.startsWith(href);
  };

  const handleLogout = async () => {
    await signOut();
    navigate("/");
  };

  const cycleTheme = () => {
    const themes: Array<"light" | "dark" | "auto"> = ["light", "dark", "auto"];
    const currentIndex = themes.indexOf(theme);
    const nextIndex = (currentIndex + 1) % themes.length;
    setTheme(themes[nextIndex]);
  };

  const initials =
    student?.name
      ?.split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) ?? "AD";

  const currentPageName =
    navigation.find((n) => isActive(n.href))?.name ?? "Admin Panel";

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:fixed lg:inset-y-0 lg:flex lg:w-60 lg:flex-col bg-card border-r border-border">
        <div className="flex flex-col flex-1 min-h-0">
          {/* Logo */}
          <div className="flex items-center gap-2.5 px-4 py-4 border-b border-border">
            <img
              src={universityLogo}
              alt="University Logo"
              className="w-8 h-8 object-cover rounded-lg"
            />
            <div>
              <h1 className="text-base font-bold text-foreground leading-tight">
                PES Admin
              </h1>
              <p className="text-xs text-muted-foreground leading-tight">
                Department Management
              </p>
            </div>
          </div>

          {/* Admin badge */}
          <div className="mx-3 mt-3 mb-1.5 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20 flex items-center gap-2">
            <Shield className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs font-medium text-primary">
              {student?.role === "super_admin" ? "Super Admin" : "Department Admin"}
            </span>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-3 py-3 space-y-1 overflow-y-auto">
            {navigation.map((item) => (
              <button
                key={item.name}
                onClick={() => navigate(item.href)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  isActive(item.href)
                    ? "bg-primary text-primary-foreground shadow-md shadow-primary/30"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                <item.icon className="h-4 w-4 flex-shrink-0" />
                <span>{item.name}</span>
              </button>
            ))}
          </nav>

          {/* Bottom — logout */}
          <div className="px-3 py-3 border-t border-border space-y-1">
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
            >
              <LogOut className="h-4 w-4 flex-shrink-0" />
              <span>Logout</span>
            </button>
          </div>

          {/* Admin info */}
          <div className="px-3 py-3 border-t border-border">
            <div className="flex items-center gap-2.5 px-1">
              <Avatar className="w-8 h-8">
                <AvatarFallback className="bg-primary text-primary-foreground text-sm">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">
                  {student?.name ?? "Admin"}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {describeAdminScope(student)}
                </p>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile Sidebar */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSidebarOpen(false)}
              className="fixed inset-0 bg-black/50 z-40 lg:hidden"
            />
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed inset-y-0 left-0 w-64 bg-card border-r border-border z-50 lg:hidden"
            >
              <div className="flex flex-col h-full">
                {/* Mobile Header */}
                <div className="flex items-center justify-between px-4 py-4 border-b border-border">
                  <div className="flex items-center gap-2.5">
                    <img
                      src={universityLogo}
                      alt="Logo"
                      className="w-8 h-8 object-cover rounded-lg"
                    />
                    <div>
                      <h1 className="text-base font-bold text-foreground">
                        PES Admin
                      </h1>
                      <p className="text-xs text-muted-foreground">
                        Department Management
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setSidebarOpen(false)}
                    className="p-1.5 rounded-lg hover:bg-muted transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* Admin badge */}
                <div className="mx-3 mt-3 mb-1.5 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20 flex items-center gap-2">
                  <Shield className="h-3.5 w-3.5 text-primary" />
                  <span className="text-xs font-medium text-primary">
                    Department Admin
                  </span>
                </div>

                {/* Navigation */}
                <nav className="flex-1 px-3 py-3 space-y-1 overflow-y-auto">
                  {navigation.map((item) => (
                    <button
                      key={item.name}
                      onClick={() => {
                        navigate(item.href);
                        setSidebarOpen(false);
                      }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                        isActive(item.href)
                          ? "bg-primary text-primary-foreground shadow-md"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted"
                      }`}
                    >
                      <item.icon className="h-4 w-4 flex-shrink-0" />
                      <span>{item.name}</span>
                    </button>
                  ))}
                </nav>

                {/* Bottom */}
                <div className="px-3 py-3 border-t border-border space-y-1">
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
                  >
                    <LogOut className="h-4 w-4" />
                    <span>Logout</span>
                  </button>
                </div>

                {/* Admin info */}
                <div className="px-3 py-3 border-t border-border">
                  <div className="flex items-center gap-2.5 px-1">
                    <Avatar className="w-8 h-8">
                      <AvatarFallback className="bg-primary text-primary-foreground text-sm">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {student?.name ?? "Admin"}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {student?.department ?? "Department Admin"}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <div className="lg:pl-60">
        {/* Top Header */}
        <header className="sticky top-0 z-30 bg-card/80 backdrop-blur-md border-b border-border">
          <div className="flex items-center justify-between px-4 sm:px-5 lg:px-6 py-2.5">
            {/* Left */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden p-1.5 rounded-lg hover:bg-muted transition-colors"
              >
                <Menu className="h-5 w-5" />
              </button>
              <div>
                <h2 className="text-base font-semibold text-foreground leading-tight">
                  {currentPageName}
                </h2>
                <p className="text-xs text-muted-foreground leading-tight">
                  Faculty of Engineering — USJ
                </p>
              </div>
            </div>

            {/* Right */}
            <div className="flex items-center gap-2">
              {/* Theme toggle */}
              <button
                onClick={cycleTheme}
                className="p-1.5 rounded-lg hover:bg-muted transition-colors"
                title={`Current theme: ${theme}`}
              >
                {theme === "dark" ||
                (theme === "auto" &&
                  window.matchMedia("(prefers-color-scheme: dark)").matches) ? (
                  <Sun className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <Moon className="h-4 w-4 text-muted-foreground" />
                )}
              </button>

              {/* Profile */}
              <button className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted transition-colors">
                <Avatar className="w-7 h-7">
                  <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="hidden md:block text-left">
                  <p className="text-sm font-medium text-foreground leading-tight">
                    {student?.name ?? "Admin"}
                  </p>
                  <p className="text-xs text-muted-foreground leading-tight">
                    {student?.role === "super_admin" ? "Super Admin" : "Dept. Admin"}
                  </p>
                </div>
                <ChevronDown className="hidden md:block h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="p-4 sm:p-5 lg:p-6">
          <div className="max-w-screen-2xl mx-auto">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
