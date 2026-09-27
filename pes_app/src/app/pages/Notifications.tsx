import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Bell, CheckCheck } from "lucide-react";
import { Button } from "../components/ui/button";
import {
  EmptyState,
  PageHeader,
  SectionCard,
  SkeletonRows,
} from "../components/common";
import { SOURCE_ICON } from "../components/layout/NotificationBell";
import { cn } from "../components/ui/utils";
import { departmentInText } from "../../lib/departments";
import { useNotifications } from "../hooks/useNotifications";
import {
  relativeTime,
  SOURCE_LABEL,
  type AppNotification,
  type NotificationSource,
} from "../../lib/notifications";

/**
 * Everything that has happened to this person, in one place.
 *
 * The same page in all three portals. What differs between a student and a
 * head of department is which notifications exist for them, and that was
 * already decided when the event was written — the recipient and the link
 * were chosen by the trigger that knew what happened. There is nothing
 * role-shaped left to do here, which is why there is one page and not three.
 */
export default function Notifications() {
  const navigate = useNavigate();
  const { items, unread, loading, markSomeRead, markAllRead } =
    useNotifications();
  const [source, setSource] = useState<NotificationSource | "all">("all");
  const [unreadOnly, setUnreadOnly] = useState(false);

  /* Only the sources this person actually has. A student has never had a
     course assigned to them, and a filter that always returns nothing is
     just a thing to click on and be disappointed by. */
  const sources = useMemo(() => {
    const seen = new Set<NotificationSource>();
    for (const n of items) seen.add(n.source);
    return [...seen].sort((a, b) =>
      (SOURCE_LABEL[a] ?? a).localeCompare(SOURCE_LABEL[b] ?? b),
    );
  }, [items]);

  const visible = useMemo(
    () =>
      items.filter(
        (n) =>
          (source === "all" || n.source === source) &&
          (!unreadOnly || !n.read_at),
      ),
    [items, source, unreadOnly],
  );

  const open = async (n: AppNotification) => {
    if (!n.read_at) await markSomeRead([n.id]);
    if (n.href) navigate(n.href);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Notifications"
        description={
          unread > 0
            ? `Everything PES has told you, newest first. ${unread} unread.`
            : "Everything PES has told you, newest first."
        }
        actions={
          unread > 0 ? (
            <Button variant="outline" size="sm" onClick={() => markAllRead()}>
              <CheckCheck className="mr-1.5 h-4 w-4" />
              Mark all read
            </Button>
          ) : undefined
        }
      />

      {loading ? (
        <SectionCard title="Recent">
          <SkeletonRows count={6} />
        </SectionCard>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="Nothing has happened yet"
          description="When a result is published, a register opens, a sheet comes back to you or your mentor writes, it will show up here."
        />
      ) : (
        <>
          {/* One row that scrolls on a phone: wrapped, the divider before
              "Unread only" ended up alone at the start of a line. */}
          <div className="no-scrollbar -mx-4 flex items-center gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
            <Chip
              active={source === "all"}
              onClick={() => setSource("all")}
              label={`All (${items.length})`}
            />
            {sources.map((s) => (
              <Chip
                key={s}
                active={source === s}
                onClick={() => setSource(s)}
                label={`${SOURCE_LABEL[s] ?? s} (${items.filter((n) => n.source === s).length})`}
              />
            ))}
            <span className="mx-1 h-4 w-px flex-shrink-0 bg-border" aria-hidden="true" />
            <Chip
              active={unreadOnly}
              onClick={() => setUnreadOnly((v) => !v)}
              label={`Unread only${unread > 0 ? ` (${unread})` : ""}`}
            />
          </div>

          <SectionCard
            title={
              source === "all"
                ? "Recent"
                : (SOURCE_LABEL[source] ?? String(source))
            }
            description={`${visible.length} notification${visible.length === 1 ? "" : "s"}`}
            flush
          >
            {visible.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                Nothing here with those filters.
              </p>
            ) : (
              <div>
                {groupByAge(visible).map(({ label, items: group }) => (
                  <section key={label} aria-label={label}>
                    <h3 className="border-b border-border/60 bg-muted/40 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {label}
                    </h3>
                    <ul className="divide-y divide-border/60">
                      {group.map((n) => {
                        const Icon = SOURCE_ICON[n.source] ?? Bell;
                        const isUnread = !n.read_at;
                        // A notification about a course takes that course's
                        // department colour; anything else stays neutral.
                        const dept = departmentInText(n.title, n.body);
                        return (
                          <li key={n.id}>
                            {/* Unread is a dot and a heavier title. The whole
                                row used to be tinted brand pink, which read
                                as an alert rather than "not seen yet". */}
                            <button
                              type="button"
                              onClick={() => open(n)}
                              className={cn(
                                "flex w-full items-start gap-3 border-l-4 px-4 py-3 text-left transition-colors",
                                dept?.stripeClass ?? "border-l-transparent",
                                dept?.hoverClass ?? "hover:bg-muted/60",
                              )}
                            >
                              <span
                                className={cn(
                                  "relative mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg",
                                  dept?.chipClass ?? "bg-muted text-muted-foreground",
                                )}
                              >
                                <Icon className="h-4 w-4" aria-hidden="true" />
                                {isUnread && (
                                  <span
                                    className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-primary"
                                    aria-hidden="true"
                                  />
                                )}
                              </span>

                              <span className="min-w-0 flex-1">
                                <span className="flex flex-wrap items-center gap-2">
                                  <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                    {SOURCE_LABEL[n.source] ?? n.source}
                                  </span>
                                  <span className="text-[11px] text-muted-foreground">
                                    {relativeTime(n.created_at)}
                                  </span>
                                  {isUnread && <span className="sr-only">Unread.</span>}
                                </span>
                                <span
                                  className={`block text-sm text-foreground ${
                                    isUnread ? "font-semibold" : "font-normal"
                                  }`}
                                >
                                  {n.title}
                                </span>
                                {n.body && (
                                  <span className="block text-xs text-muted-foreground">
                                    {n.body}
                                  </span>
                                )}
                              </span>

                              {n.href && (
                                <ArrowRight
                                  className="mt-1 h-4 w-4 flex-shrink-0 text-muted-foreground"
                                  aria-hidden="true"
                                />
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </SectionCard>
        </>
      )}
    </div>
  );
}

/**
 * Today, Yesterday, Last 7 days, Older. The list is already newest
 * first, so each group keeps that order and empty groups are left out.
 */
function groupByAge(list: AppNotification[]) {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const day = 24 * 60 * 60 * 1000;
  const bucket = (iso: string) => {
    const t = new Date(iso).getTime();
    if (t >= startOfToday.getTime()) return "Today";
    if (t >= startOfToday.getTime() - day) return "Yesterday";
    if (t >= startOfToday.getTime() - 6 * day) return "Last 7 days";
    return "Older";
  };
  const groups: { label: string; items: AppNotification[] }[] = [];
  for (const n of list) {
    const label = bucket(n.created_at);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(n);
    else groups.push({ label, items: [n] });
  }
  return groups;
}

function Chip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex-shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-xs transition-colors ${
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-muted-foreground hover:bg-muted"
      }`}
    >
      {label}
    </button>
  );
}
