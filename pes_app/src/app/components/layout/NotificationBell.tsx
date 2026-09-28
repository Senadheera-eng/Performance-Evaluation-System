import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Bell,
  BookOpen,
  Calendar,
  CheckCheck,
  GraduationCap,
  HeartHandshake,
  MessageSquareText,
  Stethoscope,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { useNotifications } from "../../hooks/useNotifications";
import { departmentInText } from "../../../lib/departments";
import {
  relativeTime,
  SOURCE_LABEL,
  type AppNotification,
  type NotificationSource,
} from "../../../lib/notifications";

export const SOURCE_ICON: Record<NotificationSource, LucideIcon> = {
  results: TrendingUp,
  attendance: Calendar,
  enrolment: GraduationCap,
  feedback: MessageSquareText,
  medical: Stethoscope,
  mentoring: HeartHandshake,
  teaching: BookOpen,
};

/**
 * The bell, and the ten most recent things that happened to this person.
 *
 * Deliberately not a second sidebar. The badges on the navigation answer "is
 * there work outstanding for me?"; this answers "what changed?" — so a card
 * carries the event, when it happened, and the link to the thing it is about.
 * Clicking one marks it read and goes there, because those are the same
 * intention and asking twice for it would be pedantry.
 */
export function NotificationBell() {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const { items, unread, loading, markSomeRead, markAllRead } =
    useNotifications();

  /* Each portal keeps its own notifications page so the shell stays around
     it. Which portal we are in is already in the path — deriving it beats
     passing the same prop down through three layouts. */
  const portal = `/${location.pathname.split("/")[1] || "app"}`;

  const recent = items.slice(0, 10);

  const openNotification = async (n: AppNotification) => {
    setOpen(false);
    if (!n.read_at) await markSomeRead([n.id]);
    if (n.href) navigate(n.href);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={
            unread > 0
              ? `Notifications, ${unread} unread`
              : "Notifications, none unread"
          }
          className="relative h-10 w-10 flex items-center justify-center rounded-lg hover:bg-muted transition-colors"
        >
          <Bell className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          {unread > 0 && (
            <span
              aria-hidden="true"
              className="absolute right-1.5 top-1.5 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold leading-[1.1rem] text-center"
            >
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[min(24rem,92vw)] p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-sm font-semibold text-foreground">
            Notifications
          </span>
          {unread > 0 && (
            <button
              type="button"
              onClick={() => markAllRead()}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Mark all read
            </button>
          )}
        </div>

        <div className="max-h-[22rem] overflow-y-auto">
          {loading ? (
            <div className="space-y-2 p-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-12 rounded-lg bg-muted animate-pulse" />
              ))}
            </div>
          ) : recent.length === 0 ? (
            <div className="px-3 py-8 text-center">
              <Bell className="mx-auto mb-2 h-7 w-7 text-muted-foreground opacity-50" />
              <p className="text-sm text-foreground">Nothing new</p>
              <p className="text-xs text-muted-foreground">
                Results, attendance and messages will appear here.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {recent.map((n) => {
                const Icon = SOURCE_ICON[n.source] ?? Bell;
                // A course's notification in its department's colour, as on
                // the Notifications page.
                const dept = departmentInText(n.title, n.body);
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => openNotification(n)}
                      className={`flex w-full items-start gap-2.5 border-l-4 px-3 py-2.5 text-left transition-colors ${
                        dept?.stripeClass ?? "border-l-transparent"
                      } ${dept?.hoverClass ?? "hover:bg-muted/60"} ${
                        n.read_at ? "" : "bg-primary/5"
                      }`}
                    >
                      <span
                        className={`mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg ${
                          dept?.chipClass ?? "bg-muted text-muted-foreground"
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            {SOURCE_LABEL[n.source] ?? n.source}
                          </span>
                          {!n.read_at && (
                            <span
                              aria-hidden="true"
                              className="h-1.5 w-1.5 rounded-full bg-primary"
                            />
                          )}
                        </span>
                        <span className="block text-sm text-foreground">
                          {n.title}
                        </span>
                        {n.body && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {n.body}
                          </span>
                        )}
                        <span className="block text-[11px] text-muted-foreground">
                          {relativeTime(n.created_at)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-border p-2">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              navigate(`${portal}/notifications`);
            }}
            className="w-full rounded-lg px-3 py-1.5 text-center text-sm text-primary hover:bg-muted transition-colors"
          >
            See all notifications
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
