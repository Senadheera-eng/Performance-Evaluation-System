import { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../context/AuthContext";
import type { ShellNavItem } from "../components/layout/AppShell";

export interface NotificationCounts {
  feedback: number;
  results: number;
  medical: number;
  /** Outstanding R/L modules a student can enrol in right now. */
  enrolment: number;
  /** Lecture registers open now that this student has not yet signed. */
  attendance: number;
  /** Unread messages from the other side of a mentoring pair. */
  mentoring: number;
  /**
   * Notices this person has not opened yet.
   *
   * The odd one out, deliberately. Every other count here is outstanding
   * work and clears when the work is done — but there is nothing a student
   * does to a timetable, so "unfinished notices" is not a thing that exists.
   * What exists is whether they have seen it, so this one is derived from
   * unread notice notifications and clears when they open it. For a
   * publisher it counts their own unfinished drafts instead, which is the
   * equivalent signal on a screen built for writing rather than reading.
   */
  notices: number;
}

const NONE: NotificationCounts = {
  feedback: 0,
  results: 0,
  medical: 0,
  enrolment: 0,
  attendance: 0,
  mentoring: 0,
  notices: 0,
};

/**
 * What is waiting for the signed-in person, for the sidebar badges.
 *
 * One call rather than one per badge, and the role decides what is counted —
 * a student's is unanswered feedback forms, a lecturer's is a result sheet
 * sent back, a department admin's is what needs approving or publishing.
 *
 * Refetched on navigation, because the way a badge clears is almost always
 * that the person went to the page and did the thing.
 */
export function useNotificationCounts(): NotificationCounts {
  const { user } = useAuth();
  const location = useLocation();
  const [counts, setCounts] = useState<NotificationCounts>(NONE);

  const load = useCallback(async () => {
    if (!user) {
      setCounts(NONE);
      return;
    }
    const { data, error } = await supabase.rpc("get_my_notification_counts");
    if (error) {
      // A badge is not worth an error state — the page itself still works.
      console.error("[notifications]", error);
      return;
    }
    setCounts({ ...NONE, ...(data as Partial<NotificationCounts>) });
  }, [user]);

  useEffect(() => {
    load();
  }, [load, location.pathname]);

  /* Navigation is the usual way a badge changes, but not the only one: a
     lecturer opens a register while the student is sitting on one page, and
     the badge is the only thing that will tell them to scan. */
  useEffect(() => {
    if (!user) return;
    const id = window.setInterval(load, 60000);
    return () => window.clearInterval(id);
  }, [user, load]);

  /* Nor is navigation enough on its own. Reading a conversation clears its
     badge, but the reading happens after the page has already loaded and
     fetched — so navigating alone would leave the count stale until the next
     minute ticked over. Whatever did the clearing says so, and the badge
     catches up immediately. */
  useEffect(() => {
    const refresh = () => load();
    window.addEventListener(NOTIFICATIONS_CHANGED, refresh);
    return () => window.removeEventListener(NOTIFICATIONS_CHANGED, refresh);
  }, [load]);

  return counts;
}

/** Event name for "something I just did changed one of these counts". */
export const NOTIFICATIONS_CHANGED = "pes:notifications-changed";

/**
 * Tell the sidebar its counts are out of date.
 *
 * Called by whatever cleared the thing — marking a conversation read, signing
 * a register — rather than by the badge, which has no way of knowing.
 */
export function notifyCountsChanged() {
  window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
}

/** Attaches a count to the nav item whose route owns it. */
export function withBadges(
  navigation: ShellNavItem[],
  counts: NotificationCounts,
): ShellNavItem[] {
  const forHref = (href: string): number => {
    if (href.endsWith("/feedback")) return counts.feedback;
    if (href.endsWith("/results")) return counts.results;
    if (href.endsWith("/medical")) return counts.medical;
    if (href.endsWith("/enrollment")) return counts.enrolment;
    if (href.endsWith("/attendance")) return counts.attendance;
    // Both ends of a mentoring pair count the same thing: messages the other
    // person sent that I have not read.
    if (href.endsWith("/mentees") || href.endsWith("/mentor"))
      return counts.mentoring;
    if (href.endsWith("/notices")) return counts.notices;
    return 0;
  };

  return navigation.map((item) => {
    const count = forHref(item.href);
    if (count <= 0) return item;
    return { ...item, badge: String(count), badgeTone: "attention" as const };
  });
}
