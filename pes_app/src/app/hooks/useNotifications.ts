import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import {
  fetchNotifications,
  fetchUnreadCount,
  markRead,
  type AppNotification,
} from "../../lib/notifications";

/** Something changed a notification; whoever is showing them should refetch. */
export const NOTIFICATIONS_UPDATED = "pes:notifications-updated";

export function notificationsUpdated() {
  window.dispatchEvent(new Event(NOTIFICATIONS_UPDATED));
}

/**
 * The signed-in person's notifications, and the unread count on the bell.
 *
 * Polls, because a notification is written by whoever caused the event — a
 * lecturer opening a register, a department publishing a sheet — and that is
 * always a different session from this one. Nothing local will ever tell this
 * tab that it happened.
 *
 * Sixty seconds is chosen against what these events actually are: none of
 * them is urgent to the second, and a shorter interval would multiply a
 * request across every open tab in the faculty for no gain.
 */
export function useNotifications(pollMs = 60_000) {
  const { user } = useAuth();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) {
      setItems([]);
      setUnread(0);
      setLoading(false);
      return;
    }
    const [list, count] = await Promise.all([
      fetchNotifications(50),
      fetchUnreadCount(),
    ]);
    setItems(list);
    setUnread(count);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!user) return;
    const id = window.setInterval(load, pollMs);
    return () => window.clearInterval(id);
  }, [user, load, pollMs]);

  useEffect(() => {
    const refresh = () => load();
    window.addEventListener(NOTIFICATIONS_UPDATED, refresh);
    return () => window.removeEventListener(NOTIFICATIONS_UPDATED, refresh);
  }, [load]);

  /* Marked read locally first so the card stops looking unread the instant it
     is clicked. The server call follows; if it fails the next poll puts the
     truth back, which is the right way round for something this small. */
  const markSomeRead = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    setItems((prev) =>
      prev.map((n) =>
        ids.includes(n.id) && !n.read_at
          ? { ...n, read_at: new Date().toISOString() }
          : n,
      ),
    );
    setUnread((prev) => Math.max(0, prev - ids.length));
    await markRead(ids);
    notificationsUpdated();
  }, []);

  const markAllRead = useCallback(async () => {
    setItems((prev) =>
      prev.map((n) =>
        n.read_at ? n : { ...n, read_at: new Date().toISOString() },
      ),
    );
    setUnread(0);
    await markRead(null);
    notificationsUpdated();
  }, []);

  return { items, unread, loading, reload: load, markSomeRead, markAllRead };
}
