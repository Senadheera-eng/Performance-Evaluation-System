import { useEffect, useMemo, useRef } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "../../lib/supabase";

/** How long after the last keystroke the other side stops seeing "typing". */
const TYPING_TIMEOUT = 2500;
/** Don't re-broadcast on every keystroke; once every this often is plenty. */
const TYPING_THROTTLE = 1200;

interface Options {
  /** Null while the thread is still loading, or when there is none. */
  assignmentId: string | null;
  myRole: "student" | "mentor";
  /** A message row arrived. Only the id is given: the caller shapes it. */
  onInserted: (messageId: string) => void;
  /** A row changed — in practice, someone read it. */
  onUpdated: (messageId: string, readAt: string | null) => void;
  /** The other side started or stopped typing. */
  onTyping: (typing: boolean) => void;
}

/**
 * One conversation's live connection.
 *
 * Two different mechanisms, because the two things being carried are not the
 * same kind of fact. Messages and read receipts are rows, so they come over
 * postgres changes and are true because the database says so — Realtime
 * re-checks each subscriber's RLS before replaying a row, which is what keeps
 * a conversation off everybody else's socket. Typing is not a fact about the
 * world and has no business in a table, so it goes over broadcast: it exists
 * for as long as someone is listening and then it is gone.
 *
 * The typing signal stops itself. A browser that is closed mid-sentence never
 * sends the "stopped" that would clear the indicator, so the receiving side
 * expires it on a timer instead of trusting the sender to say goodbye.
 */
export function useThreadChannel({
  assignmentId,
  myRole,
  onInserted,
  onUpdated,
  onTyping,
}: Options) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastSent = useRef(0);
  const stopTimer = useRef<number>();
  const expireTimer = useRef<number>();

  /* Handlers are kept in refs so the channel is not torn down and rebuilt on
     every render — resubscribing drops messages that arrive in the gap. */
  const handlers = useRef({ onInserted, onUpdated, onTyping });
  handlers.current = { onInserted, onUpdated, onTyping };

  useEffect(() => {
    if (!assignmentId) return;

    const channel = supabase
      .channel(`mentor-thread:${assignmentId}`, {
        // Our own typing is not news to us.
        config: { broadcast: { self: false } },
      })
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "mentor_messages",
          filter: `assignment_id=eq.${assignmentId}`,
        },
        (payload) => {
          const row = payload.new as { id?: string };
          if (row?.id) handlers.current.onInserted(row.id);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "mentor_messages",
          filter: `assignment_id=eq.${assignmentId}`,
        },
        (payload) => {
          const row = payload.new as { id?: string; read_at?: string | null };
          if (row?.id) handlers.current.onUpdated(row.id, row.read_at ?? null);
        },
      )
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        const from = payload as { role?: string; typing?: boolean };
        if (from.role === myRole) return;
        handlers.current.onTyping(Boolean(from.typing));
        window.clearTimeout(expireTimer.current);
        if (from.typing) {
          // Nobody is obliged to tell us they stopped.
          expireTimer.current = window.setTimeout(
            () => handlers.current.onTyping(false),
            TYPING_TIMEOUT + 1500,
          );
        }
      })
      .subscribe();

    channelRef.current = channel;
    return () => {
      window.clearTimeout(stopTimer.current);
      window.clearTimeout(expireTimer.current);
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [assignmentId, myRole]);

  return useMemo(
    () => ({
      /** Call on each keystroke; throttled, and stops itself when they pause. */
      typing() {
        const now = Date.now();
        if (now - lastSent.current > TYPING_THROTTLE) {
          lastSent.current = now;
          channelRef.current?.send({
            type: "broadcast",
            event: "typing",
            payload: { role: myRole, typing: true },
          });
        }
        window.clearTimeout(stopTimer.current);
        stopTimer.current = window.setTimeout(
          () => this.stopTyping(),
          TYPING_TIMEOUT,
        );
      },

      /** Call when the message is sent, or the box is left empty. */
      stopTyping() {
        window.clearTimeout(stopTimer.current);
        lastSent.current = 0;
        channelRef.current?.send({
          type: "broadcast",
          event: "typing",
          payload: { role: myRole, typing: false },
        });
      },
    }),
    [myRole],
  );
}
