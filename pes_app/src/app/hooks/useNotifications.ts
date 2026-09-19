import { useEffect, useSyncExternalStore } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../context/AuthContext";
import {
  fetchNotifications,
  fetchUnreadCount,
  markRead,
  type AppNotification,
} from "../../lib/notifications";

/**
 * One store, not one per component.
 *
 * The bell and the notifications page both want the same list, and they are
 * often on screen together. A plain hook would have given each of them its
 * own fetch, its own socket and its own timer, and — worse — its own idea of
 * how many are unread, so the badge and the page could disagree while both
 * were technically correct about what they had last seen.
 *
 * So the subscription lives here, once, and components read from it. It
 * starts when the first one mounts and stops when the last one unmounts.
 */

interface State {
  items: AppNotification[];
  unread: number;
  loading: boolean;
  /** False while the socket is down, which is when the poll matters. */
  live: boolean;
}

let state: State = { items: [], unread: 0, loading: true, live: false };

const listeners = new Set<() => void>();
let channel: RealtimeChannel | null = null;
let pollTimer: number | null = null;
let startedFor: string | null = null;
let refCount = 0;

function emit() {
  for (const listener of listeners) listener();
}

/* Replaced rather than mutated, because useSyncExternalStore compares
   snapshots by identity to decide whether to re-render. */
function setState(patch: Partial<State>) {
  state = { ...state, ...patch };
  emit();
}

function subscribeToStore(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return state;
}

/* True once this channel has been SUBSCRIBED at least once, so a
   reconnect can be told from a cold start. Deliberately not "has the
   first fetch landed" — on a fast connection it lands before the
   socket subscribes, which made the catch-up fire on every start and
   fetch the same two things twice. */
let everSubscribed = false;

async function refresh() {
  const [items, unread] = await Promise.all([
    fetchNotifications(50),
    fetchUnreadCount(),
  ]);
  setState({ items, unread, loading: false });
}

/**
 * A row arrived on the socket.
 *
 * Applied to what is already on screen rather than triggering a refetch: the
 * payload is the whole row, so there is nothing to go back for, and a refetch
 * per notification would turn a busy publish into a burst of requests.
 */
function onInserted(row: AppNotification) {
  setState({
    items: state.items.some((n) => n.id === row.id)
      ? state.items
      : [row, ...state.items],
    unread: state.unread + (row.read_at ? 0 : 1),
  });
}

/* Read somewhere else — another tab, or the phone in their pocket. */
function onUpdated(row: AppNotification) {
  const before = state.items.find((n) => n.id === row.id);
  const nowRead = Boolean(row.read_at) && !before?.read_at;
  setState({
    items: state.items.map((n) => (n.id === row.id ? { ...n, ...row } : n)),
    unread: Math.max(0, state.unread - (nowRead ? 1 : 0)),
  });
}

function start(userId: string) {
  if (startedFor === userId) return;
  stop();
  startedFor = userId;

  everSubscribed = false;
  setState({ loading: true });
  refresh();

  /* Filtered by recipient on the server as well as by row security. The
     policy is what makes this safe — this only saves the socket carrying
     rows that would be discarded anyway. */
  channel = supabase
    .channel(`notifications:${userId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "notifications",
        filter: `recipient_id=eq.${userId}`,
      },
      (payload) => onInserted(payload.new as AppNotification),
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "notifications",
        filter: `recipient_id=eq.${userId}`,
      },
      (payload) => onUpdated(payload.new as AppNotification),
    )
    .subscribe((status) => {
      const live = status === "SUBSCRIBED";
      setState({ live });
      /* Anything that happened while the socket was down was never
         delivered, so catch up on the way back in — but only on a
         reconnect. On a cold start the fetch above is already in flight
         and this would just be the same two requests again. */
      if (live) {
        if (everSubscribed) refresh();
        everSubscribed = true;
      }
    });

  /* The socket is the mechanism; the poll is the fallback, and it only
     fires while the socket is down. Somewhere with websockets blocked
     still gets what it had before this change rather than something
     worse, and a healthy connection costs no requests at all. */
  pollTimer = window.setInterval(() => {
    if (!state.live) refresh();
  }, 60_000);
}

function stop() {
  if (channel) {
    supabase.removeChannel(channel);
    channel = null;
  }
  if (pollTimer !== null) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
  startedFor = null;
}

function reset() {
  stop();
  everSubscribed = false;
  state = { items: [], unread: 0, loading: false, live: false };
  emit();
}

/* Marked read locally first so the card stops looking unread the instant it
   is clicked. The server call follows; if it fails, the next refresh puts the
   truth back, which is the right way round for something this small. */
async function markSomeRead(ids: string[]) {
  if (ids.length === 0) return;
  const unreadIds = ids.filter(
    (id) => !state.items.find((n) => n.id === id)?.read_at,
  );
  if (unreadIds.length === 0) return;

  const now = new Date().toISOString();
  setState({
    items: state.items.map((n) =>
      unreadIds.includes(n.id) ? { ...n, read_at: now } : n,
    ),
    unread: Math.max(0, state.unread - unreadIds.length),
  });
  await markRead(unreadIds);
}

async function markAllRead() {
  const now = new Date().toISOString();
  setState({
    items: state.items.map((n) => (n.read_at ? n : { ...n, read_at: now })),
    unread: 0,
  });
  await markRead(null);
}

export function useNotifications() {
  const { user } = useAuth();
  const snapshot = useSyncExternalStore(subscribeToStore, getSnapshot);
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId) {
      reset();
      return;
    }
    refCount += 1;
    start(userId);
    return () => {
      refCount -= 1;
      /* Only the last component out turns off the socket. Without the
         count, navigating from the bell to the notifications page would
         unmount one and mount the other, and the teardown of the first
         would kill the subscription the second had just started. */
      if (refCount === 0) stop();
    };
  }, [userId]);

  return {
    items: snapshot.items,
    unread: snapshot.unread,
    loading: snapshot.loading,
    live: snapshot.live,
    reload: refresh,
    markSomeRead,
    markAllRead,
  };
}
