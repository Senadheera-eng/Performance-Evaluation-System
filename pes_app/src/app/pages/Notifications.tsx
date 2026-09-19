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
            ? `${unread} unread. Results, attendance, enrolment, feedback, medicals, mentoring and teaching all report here.`
            : "Results, attendance, enrolment, feedback, medicals, mentoring and teaching all report here."
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
          <div className="flex flex-wrap items-center gap-1.5">
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
            <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
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
              <ul className="divide-y divide-border/60">
                {visible.map((n) => {
                  const Icon = SOURCE_ICON[n.source] ?? Bell;
                  return (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => open(n)}
                        className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60 ${
                          n.read_at ? "" : "bg-primary/5"
                        }`}
                      >
                        <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-muted">
                          <Icon className="h-4 w-4 text-muted-foreground" />
                        </span>

                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                              {SOURCE_LABEL[n.source] ?? n.source}
                            </span>
                            {!n.read_at && (
                              <span className="rounded-full bg-primary/10 px-1.5 text-[10px] font-medium text-primary">
                                New
                              </span>
                            )}
                            <span className="text-[11px] text-muted-foreground">
                              {relativeTime(n.created_at)}
                            </span>
                          </span>
                          <span className="block text-sm font-medium text-foreground">
                            {n.title}
                          </span>
                          {n.body && (
                            <span className="block text-xs text-muted-foreground">
                              {n.body}
                            </span>
                          )}
                        </span>

                        {n.href && (
                          <ArrowRight className="mt-1 h-4 w-4 flex-shrink-0 text-muted-foreground" />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionCard>
        </>
      )}
    </div>
  );
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
      className={`rounded-full border px-3 py-1 text-xs transition-colors ${
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-muted-foreground hover:bg-muted"
      }`}
    >
      {label}
    </button>
  );
}
