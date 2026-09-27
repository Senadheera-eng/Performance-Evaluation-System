import { useEffect, useState } from "react";
import { useNavigate, useLocation, useOutlet } from "react-router-dom";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  LogOut,
  Menu,
  X,
  Search,
  Moon,
  Sun,
  PanelLeftClose,
  PanelLeftOpen,
  type LucideIcon,
} from "lucide-react";
import { Input } from "../ui/input";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { Badge } from "../ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { cn } from "../ui/utils";
import { useTheme } from "../../context/ThemeContext";
import { NotificationBell } from "./NotificationBell";

const universityLogo = new URL("../../../assets/logo.jpg", import.meta.url).href;

const COLLAPSE_KEY = "pes.sidebar.collapsed";

export interface ShellNavItem {
  name: string;
  href: string;
  icon: LucideIcon;
  badge?: string;
  /**
   * "muted" is a label like New. "attention" is a count of things waiting for
   * this person, and carries the brand colour — plus a dot on the collapsed
   * rail, where the label itself has nowhere to render.
   */
  badgeTone?: "muted" | "attention";
}

interface AppShellProps {
  brandTitle: string;
  brandSubtitle: string;
  navigation: ShellNavItem[];
  /** Account-level links, visually separated from primary navigation. */
  bottomNavigation?: ShellNavItem[];
  roleBadge?: { label: string; icon: LucideIcon };
  userName: string;
  /** Secondary identity line, e.g. index/reg number or department scope. */
  userMeta: string;
  /** Route treated as the index for active-state matching. */
  homeHref: string;
  headerSubtitle: string;
  onProfileClick?: () => void;
  onLogout: () => void;
  showSearch?: boolean;
  showNotifications?: boolean;
}

/**
 * Application shell shared by the student and admin portals.
 *
 * Both layouts previously carried their own near-identical copy of this
 * markup, which is why the two portals drifted apart visually. Rendering
 * both from one component means navigation, spacing, theming and responsive
 * behaviour can only ever change together.
 *
 * Identity is shown once per breakpoint: in the sidebar footer on desktop,
 * and in the header on mobile where the sidebar is hidden — rather than in
 * both places simultaneously as before.
 */
export function AppShell({
  brandTitle,
  brandSubtitle,
  navigation,
  bottomNavigation = [],
  roleBadge,
  userName,
  userMeta,
  homeHref,
  headerSubtitle,
  onProfileClick,
  onLogout,
  showSearch = false,
  showNotifications = false,
}: AppShellProps) {
  const navigate = useNavigate();
  const location = useLocation();
  // The matched route's element, rather than <Outlet />: AnimatePresence has
  // to hold on to the *previous* page's element while it animates out, and it
  // can only do that if the element is a child it was handed. <Outlet /> would
  // re-resolve to the incoming route mid-exit and the old page would vanish.
  const outlet = useOutlet();
  const { theme, setTheme, isDark } = useTheme();
  const reduce = useReducedMotion();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Collapse preference persists across sessions, like the theme does.
  useEffect(() => {
    setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "true");
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      localStorage.setItem(COLLAPSE_KEY, String(!prev));
      return !prev;
    });
  };

  // Close the mobile drawer on navigation so it never covers the new page.
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  const isActive = (href: string) =>
    href === homeHref
      ? location.pathname === homeHref
      : location.pathname.startsWith(href);

  /* Notifications is reached from the bell rather than the menu, so it
     names itself here; the header used to fall back to "PES" on it. */
  const currentPage =
    [...navigation, ...bottomNavigation].find((n) => isActive(n.href))?.name ??
    (location.pathname.endsWith("/notifications") ? "Notifications" : brandTitle);

  const initials =
    userName
      ?.split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "PS";

  const cycleTheme = () => {
    const order: Array<"light" | "dark" | "auto"> = ["light", "dark", "auto"];
    setTheme(order[(order.indexOf(theme) + 1) % order.length]);
  };

  const sidebarWidth = collapsed ? 76 : 236;

  /* ---------------------------------------------------------------- */

  const NavButton = ({
    item,
    iconOnly,
    onNavigate,
  }: {
    item: ShellNavItem;
    iconOnly: boolean;
    onNavigate?: () => void;
  }) => {
    const active = isActive(item.href);
    const button = (
      <button
        type="button"
        onClick={() => {
          navigate(item.href);
          onNavigate?.();
        }}
        aria-current={active ? "page" : undefined}
        // Collapsed, the icon is the only child and it is aria-hidden, which
        // leaves the button with no accessible name at all.
        aria-label={
          iconOnly
            ? item.badge
              ? `${item.name} — ${item.badge}`
              : item.name
            : undefined
        }
        className={cn(
          "relative w-full flex items-center gap-2.5 rounded-xl",
          "min-h-[44px] px-3 text-sm font-medium transition-colors",
          iconOnly && "justify-center px-0",
          active
            ? "bg-primary text-primary-foreground shadow-elevation-sm"
            : "text-muted-foreground hover:text-foreground hover:bg-muted",
        )}
      >
        <span className="relative flex-shrink-0">
          <item.icon className="h-4 w-4" aria-hidden="true" />
          {/* Collapsed to the icon rail there is no room for the count, but
              something still has to say the item needs attention. */}
          {iconOnly && item.badge && item.badgeTone === "attention" && (
            <span
              aria-hidden="true"
              className={cn(
                "absolute -right-1.5 -top-1.5 h-2.5 w-2.5 rounded-full ring-2",
                active
                  ? "bg-primary-foreground ring-primary"
                  : "bg-primary ring-sidebar",
              )}
            />
          )}
        </span>
        {!iconOnly && (
          <>
            <span className="flex-1 text-left truncate">{item.name}</span>
            {item.badge && (
              <Badge
                variant="secondary"
                className={cn(
                  "text-[10px] px-1.5 flex-shrink-0",
                  item.badgeTone === "attention"
                    ? active
                      ? "bg-primary-foreground text-primary"
                      : "bg-primary text-primary-foreground"
                    : "bg-accent text-accent-foreground",
                )}
              >
                {item.badge}
              </Badge>
            )}
          </>
        )}
      </button>
    );

    // Collapsed rail relies on tooltips to stay navigable.
    if (!iconOnly) return button;
    return (
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          {item.name}
          {item.badge ? ` · ${item.badge}` : ""}
        </TooltipContent>
      </Tooltip>
    );
  };

  const SidebarBody = ({ iconOnly }: { iconOnly: boolean }) => (
    <div className="flex flex-col h-full min-h-0">
      <div
        className={cn(
          "flex items-center gap-2.5 px-3 h-14 border-b border-sidebar-border",
          iconOnly && "justify-center px-0",
        )}
      >
        <img
          src={universityLogo}
          alt=""
          className="w-8 h-8 rounded-lg object-cover flex-shrink-0"
        />
        {!iconOnly && (
          <div className="min-w-0">
            <p className="text-sm font-bold text-sidebar-foreground leading-tight truncate">
              {brandTitle}
            </p>
            <p className="text-[11px] text-muted-foreground leading-tight truncate">
              {brandSubtitle}
            </p>
          </div>
        )}
      </div>

      {roleBadge && !iconOnly && (
        <div className="mx-3 mt-3 px-2.5 py-1.5 rounded-lg bg-primary/10 border border-primary/20 flex items-center gap-1.5">
          <roleBadge.icon
            className="h-3.5 w-3.5 text-primary flex-shrink-0"
            aria-hidden="true"
          />
          <span className="text-[11px] font-semibold text-primary truncate">
            {roleBadge.label}
          </span>
        </div>
      )}

      <nav
        aria-label="Main"
        className="flex-1 min-h-0 overflow-y-auto px-2.5 py-3 space-y-1"
      >
        {navigation.map((item) => (
          <NavButton key={item.href} item={item} iconOnly={iconOnly} />
        ))}
      </nav>

      <div className="px-2.5 py-2.5 border-t border-sidebar-border space-y-1">
        {bottomNavigation.map((item) => (
          <NavButton key={item.href} item={item} iconOnly={iconOnly} />
        ))}
        {iconOnly ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onLogout}
                className="w-full min-h-[44px] flex items-center justify-center rounded-xl text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              Logout
            </TooltipContent>
          </Tooltip>
        ) : (
          <button
            type="button"
            onClick={onLogout}
            className="w-full min-h-[44px] flex items-center gap-2.5 px-3 rounded-xl text-sm font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          >
            <LogOut className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
            <span className="flex-1 text-left">Logout</span>
          </button>
        )}
      </div>

      {/* Identity lives here on desktop; the header omits it to avoid
          repeating the same person twice on one screen. */}
      {!iconOnly && (
        <div className="px-3 py-3 border-t border-sidebar-border">
          <button
            type="button"
            onClick={onProfileClick}
            disabled={!onProfileClick}
            className={cn(
              "w-full flex items-center gap-2.5 rounded-xl p-1 text-left",
              onProfileClick && "hover:bg-muted transition-colors",
            )}
          >
            <Avatar className="w-8 h-8 flex-shrink-0">
              <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                {initials}
              </AvatarFallback>
            </Avatar>
            <span className="min-w-0 flex-1">
              <span
                className="block text-xs font-semibold text-sidebar-foreground truncate"
                title={userName}
              >
                {userName}
              </span>
              <span
                className="block text-[11px] text-muted-foreground truncate"
                title={userMeta}
              >
                {userMeta}
              </span>
            </span>
          </button>
        </div>
      )}
    </div>
  );

  /* ---------------------------------------------------------------- */

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop sidebar */}
      <motion.aside
        animate={{ width: sidebarWidth }}
        initial={false}
        transition={{ duration: reduce ? 0 : 0.22, ease: [0.4, 0, 0.2, 1] }}
        className="hidden lg:flex lg:fixed lg:inset-y-0 lg:flex-col bg-sidebar border-r border-sidebar-border z-40"
      >
        <SidebarBody iconOnly={collapsed} />
      </motion.aside>

      {/* Mobile drawer */}
      <AnimatePresence>
        {drawerOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduce ? 0 : 0.15 }}
              onClick={() => setDrawerOpen(false)}
              className="fixed inset-0 bg-black/50 z-40 lg:hidden"
            />
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={
                reduce
                  ? { duration: 0 }
                  : { type: "spring", damping: 26, stiffness: 240 }
              }
              className="fixed inset-y-0 left-0 w-[264px] bg-sidebar border-r border-sidebar-border z-50 lg:hidden"
              role="dialog"
              aria-label="Navigation"
            >
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close navigation"
                className="absolute top-3 right-3 z-10 h-9 w-9 flex items-center justify-center rounded-lg hover:bg-muted transition-colors"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
              <SidebarBody iconOnly={false} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main column — offset by the sidebar on desktop only. Driven by a CSS
          transition rather than framer-motion: animating a custom property
          through JS is brittle, and the reduced-motion block in theme.css
          already neutralises transitions globally. */}
      <div
        className="lg:pl-[var(--shell-offset)] transition-[padding] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]"
        style={{ "--shell-offset": `${sidebarWidth}px` } as React.CSSProperties}
      >
        <div>
          <div>
            <header className="sticky top-0 z-30 bg-card/85 backdrop-blur-md border-b border-border">
              <div className="flex items-center justify-between gap-3 px-4 lg:px-6 h-14">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => setDrawerOpen(true)}
                    aria-label="Open navigation"
                    className="lg:hidden h-10 w-10 flex items-center justify-center rounded-lg hover:bg-muted transition-colors flex-shrink-0"
                  >
                    <Menu className="h-5 w-5" aria-hidden="true" />
                  </button>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={toggleCollapsed}
                        aria-label={
                          collapsed ? "Expand sidebar" : "Collapse sidebar"
                        }
                        aria-pressed={collapsed}
                        className="hidden lg:flex h-9 w-9 items-center justify-center rounded-lg hover:bg-muted transition-colors flex-shrink-0"
                      >
                        {collapsed ? (
                          <PanelLeftOpen className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <PanelLeftClose className="h-4 w-4 text-muted-foreground" />
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      {collapsed ? "Expand sidebar" : "Collapse sidebar"}
                    </TooltipContent>
                  </Tooltip>

                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-foreground leading-tight truncate">
                      {currentPage}
                    </h2>
                    <p className="text-[11px] text-muted-foreground leading-tight truncate">
                      {headerSubtitle}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {showSearch && (
                    <div className="hidden md:block relative w-52">
                      <Search
                        className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <Input
                        type="search"
                        aria-label="Search"
                        placeholder="Search courses, results..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="h-9 pl-8 text-sm bg-muted/60 border-0 focus:bg-muted"
                      />
                    </div>
                  )}

                  {showNotifications && <NotificationBell />}

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={cycleTheme}
                        aria-label={`Theme: ${theme}. Click to change.`}
                        className="h-10 w-10 flex items-center justify-center rounded-lg hover:bg-muted transition-colors"
                      >
                        {isDark ? (
                          <Sun className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <Moon className="h-4 w-4 text-muted-foreground" />
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      Theme: {theme}
                    </TooltipContent>
                  </Tooltip>

                  {/* Identity in the header only where the sidebar is hidden. */}
                  <button
                    type="button"
                    onClick={onProfileClick}
                    disabled={!onProfileClick}
                    aria-label={userName}
                    className="lg:hidden h-10 w-10 flex items-center justify-center rounded-lg hover:bg-muted transition-colors"
                  >
                    <Avatar className="w-7 h-7">
                      <AvatarFallback className="bg-primary text-primary-foreground text-[11px]">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                  </button>
                </div>
              </div>
            </header>

            {/* Route transition. Navigating from the sidebar used to swap
                the page in with no transition at all, so every chart on the
                incoming page snapped into place at once. Keying on the path
                gives each page a short lift-and-fade entrance, and — because
                the page genuinely remounts — the Recharts draw animations
                play in step with it rather than before the page is visible. */}
            <main className="p-4 lg:p-6">
              <div className="max-w-screen-2xl mx-auto">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={location.pathname}
                    initial={reduce ? { opacity: 0 } : { opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    // Leaving is quicker than arriving: with mode="wait" the
                    // exit is dead time before the new page can even start
                    // fetching, so it stays short.
                    exit={
                      reduce
                        ? { opacity: 0, transition: { duration: 0 } }
                        : { opacity: 0, y: -8, transition: { duration: 0.12 } }
                    }
                    transition={{
                      duration: reduce ? 0 : 0.24,
                      ease: [0.4, 0, 0.2, 1],
                    }}
                  >
                    {outlet}
                  </motion.div>
                </AnimatePresence>
              </div>
            </main>
          </div>
        </div>
      </div>
    </div>
  );
}
