import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Megaphone, Paperclip, Pin } from "lucide-react";
import { Button } from "../ui/button";
import { SectionCard, SkeletonRows } from "../common";
import { categoryIcon, noticeAge } from "../notices/NoticeCard";
import { fetchNotices, type NoticeSummary } from "../../../lib/notices";
import { departmentByCourseCode, departmentByName } from "../../../lib/departments";
import { cn } from "../ui/utils";

/**
 * The five most relevant notices, on the dashboard.
 *
 * A preview, not a second notice board: same query as the Notices page in
 * "for you" mode, five rows, and a way through to the rest. Duplicating the
 * filtering and search here would mean two places to fix when the board
 * changes, for a section nobody scrolls past.
 *
 * Renders nothing at all when there is nothing to show — an empty card
 * saying "no notices" is a row of dead space on the screen people look at
 * most.
 */
export function LatestNotices() {
  const navigate = useNavigate();
  const [items, setItems] = useState<NoticeSummary[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchNotices({ scope: "for_me", limit: 5 }).then(({ items: rows }) => {
      if (!cancelled) setItems(rows);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (items !== null && items.length === 0) return null;

  return (
    <SectionCard
      title="Latest academic notices"
      actions={
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/app/notices")}
        >
          View all
          <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
        </Button>
      }
      flush
    >
      {items === null ? (
        <div className="p-4">
          <SkeletonRows count={3} height="h-12" />
        </div>
      ) : (
        <ul className="divide-y divide-border/60">
          {items.map((n) => {
            const Icon = categoryIcon(n.category_icon);
            // A department's notice takes its colour, a course's notice its
            // course's department; a faculty-wide one stays neutral — the
            // same rule as the notice board.
            const dept =
              departmentByName(n.department) ?? departmentByCourseCode(n.course_code);
            return (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => navigate(`/app/notices/${n.id}`)}
                  className={cn(
                    "flex w-full items-center gap-3 border-l-4 px-4 py-2.5 text-left transition-colors hover:bg-muted/60",
                    dept?.stripeClass ?? "border-l-transparent",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg",
                      dept?.chipClass ?? "bg-muted text-muted-foreground",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      {n.is_pinned && (
                        <Pin
                          className="h-3 w-3 flex-shrink-0 text-primary"
                          aria-label="Important"
                        />
                      )}
                      <span className="truncate text-sm font-medium text-foreground">
                        {n.title}
                      </span>
                    </span>
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      {n.category_label}
                      <span aria-hidden="true">·</span>
                      {noticeAge(n.published_at)}
                      {n.attachment_count > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <Paperclip className="h-3 w-3" aria-hidden="true" />
                          {n.attachment_count}
                        </>
                      )}
                    </span>
                  </span>
                  <Megaphone
                    className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
