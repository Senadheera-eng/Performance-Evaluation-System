import { supabase } from "./supabase";

/**
 * Reading and clearing the signed-in person's notifications.
 *
 * Everything here is scoped by the database to the caller — `recipient_id =
 * auth.uid()` in the policy and in every function — so there is no id passed
 * from the client that could address somebody else's mail.
 */

/** Where a notification came from. Drives the icon and the filter chips. */
export type NotificationSource =
  | "results"
  | "attendance"
  | "enrolment"
  | "feedback"
  | "medical"
  | "mentoring"
  | "teaching";

export interface AppNotification {
  id: string;
  source: NotificationSource;
  /** The specific event, e.g. result_published. Finer than source. */
  kind: string;
  title: string;
  body: string | null;
  /** In-app path to whatever changed, already correct for this recipient. */
  href: string | null;
  created_at: string;
  read_at: string | null;
}

export async function fetchNotifications(
  limit = 50,
  unreadOnly = false,
): Promise<AppNotification[]> {
  const { data, error } = await supabase.rpc("get_my_notifications", {
    p_limit: limit,
    p_unread_only: unreadOnly,
  });
  if (error) {
    console.error("[notifications] fetch failed", error);
    return [];
  }
  return (data ?? []) as AppNotification[];
}

export async function fetchUnreadCount(): Promise<number> {
  const { data, error } = await supabase.rpc(
    "get_my_unread_notification_count",
  );
  if (error) {
    console.error("[notifications] count failed", error);
    return 0;
  }
  return (data as number) ?? 0;
}

/** Null marks every unread one read. */
export async function markRead(ids: string[] | null): Promise<boolean> {
  const { error } = await supabase.rpc("mark_notifications_read", {
    p_ids: ids,
  });
  if (error) {
    console.error("[notifications] mark read failed", error);
    return false;
  }
  return true;
}

/** "just now", "20 minutes ago", "3 days ago" — enough to judge freshness. */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const seconds = Math.round((Date.now() - then) / 1000);

  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Human label for a source, for the filter chips and the card. */
export const SOURCE_LABEL: Record<NotificationSource, string> = {
  results: "Results",
  attendance: "Attendance",
  enrolment: "Enrolment",
  feedback: "Feedback",
  medical: "Medical",
  mentoring: "Mentoring",
  teaching: "Teaching",
};
