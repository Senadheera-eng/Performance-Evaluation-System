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
}

const NONE: NotificationCounts = {
  feedback: 0,
  results: 0,
  medical: 0,
  enrolment: 0,
  attendance: 0,
  mentoring: 0,
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

  return counts;
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
    if (href.endsWith("/mentees")) return counts.mentoring;
    return 0;
  };

  return navigation.map((item) => {
    const count = forHref(item.href);
    if (count <= 0) return item;
    return { ...item, badge: String(count), badgeTone: "attention" as const };
  });
}
