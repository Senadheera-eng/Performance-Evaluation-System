import {
  BookOpen,
  CalendarClock,
  CalendarDays,
  ClipboardList,
  FileText,
  FlaskConical,
  GraduationCap,
  Megaphone,
  Paperclip,
  Pin,
  Stethoscope,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { StatusBadge } from "../common";
import { describeScope, type NoticeSummary } from "../../../lib/notices";

/* The icons a category may name. A fixed list, not `import * as Icons`:
   the namespace import pulled all ~1,500 lucide icons into this chunk
   (745 KB, loaded on every student dashboard) to look up nine. It was also
   quietly wrong — it checked `typeof === "function"`, but lucide icons are
   forwardRef objects, so every category fell back to the same icon. */
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  BookOpen,
  CalendarClock,
  CalendarDays,
  ClipboardList,
  FileText,
  FlaskConical,
  GraduationCap,
  Megaphone,
  Stethoscope,
  TrendingUp,
};

/**
 * A category's icon, by name.
 *
 * Categories are configurable rows, so the icon arrives as a string. An
 * unknown name falls back rather than crashing the page — adding a category
 * should never require a deploy to avoid a blank screen. (It does need one
 * to get its own icon: add the name to CATEGORY_ICONS above.)
 */
export function categoryIcon(name: string): LucideIcon {
  return CATEGORY_ICONS[name] ?? FileText;
}

/** "2 hours ago" up to a week, then the date. A notice board, not a feed. */
export function noticeAge(iso: string | null): string {
  if (!iso) return "Not published";
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * One notice, as a row on a board.
 *
 * A row rather than a card on purpose. The brief asked for a notice board and
 * not a social feed, and the difference in practice is density: someone
 * scanning for last week's lab schedule wants to see ten titles at once, not
 * three pieces of chrome.
 */
export function NoticeCard({
  notice,
  onOpen,
}: {
  notice: NoticeSummary;
  onOpen: (id: string) => void;
}) {
  const Icon = categoryIcon(notice.category_icon);

  return (
    <button
      type="button"
      onClick={() => onOpen(notice.id)}
      className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60"
    >
      <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-muted">
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {notice.category_label}
          </span>
          {notice.is_pinned && (
            <StatusBadge tone="danger" icon={Pin}>
              Important
            </StatusBadge>
          )}
          {notice.is_expired && <StatusBadge tone="neutral">Expired</StatusBadge>}
        </span>

        <span className="mt-0.5 block font-medium text-foreground">
          {notice.title}
        </span>

        {notice.body && (
          <span className="mt-0.5 block line-clamp-2 text-sm text-muted-foreground">
            {notice.body}
          </span>
        )}

        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span>{describeScope(notice)}</span>
          <span aria-hidden="true">·</span>
          <span>{noticeAge(notice.published_at)}</span>
          <span aria-hidden="true">·</span>
          <span>
            {notice.created_by_name} ({notice.created_by_role})
          </span>
          {notice.attachment_count > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1 text-foreground">
                <Paperclip className="h-3 w-3" aria-hidden="true" />
                {notice.attachment_count}
              </span>
            </>
          )}
        </span>
      </span>
    </button>
  );
}
