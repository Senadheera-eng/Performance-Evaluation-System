import { useCallback, useEffect, useRef, useState } from "react";
import { Lock, Send } from "lucide-react";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { ErrorState, SkeletonRows } from "../common";
import { notifyCountsChanged } from "../../hooks/useNotificationCounts";
import {
  getMentorThread,
  markThreadRead,
  sendMentorMessage,
  type MentorThread,
} from "../../../lib/mentorService";

/** How often an open conversation re-reads itself, in milliseconds. */
const POLL = 20_000;

const when = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : d.toLocaleString(undefined, {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
      });
};

/**
 * One conversation between a student and their mentor.
 *
 * The same component serves both sides, because the conversation is
 * symmetric — only the name at the top and the side each bubble sits on
 * differ, and the database already says which of the two the reader is.
 *
 * A conversation belongs to an assignment. When a student is moved to a new
 * mentor the thread ends: it stays readable by the two people who had it, and
 * the composer goes, because there is no longer anyone on the other end.
 */
export function MentorChat({
  studentId,
  className,
}: {
  /** Omit for a student reading their own; pass a mentee's id for a mentor. */
  studentId?: string;
  className?: string;
}) {
  const [thread, setThread] = useState<MentorThread | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const loadRef = useRef<() => Promise<void>>();
  const count = thread?.messages.length ?? 0;

  const load = useCallback(async () => {
    const result = await getMentorThread(studentId);
    if (!result.ok) setError(result.error);
    else {
      setError(null);
      setThread(result.data);
      // Opening the conversation is reading it. The sidebar badge counted
      // those messages a moment ago and has no way to learn they are read,
      // so it is told.
      if (result.data && result.data.messages.some((m) => !m.mine && !m.read_at)) {
        await markThreadRead(studentId);
        notifyCountsChanged();
      }
    }
    setLoading(false);
  }, [studentId]);

  loadRef.current = load;

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  /* A conversation nobody can add to will not change, so it is fetched once
     and the timer never starts. */
  useEffect(() => {
    if (!thread?.is_current) return;
    const id = window.setInterval(() => loadRef.current?.(), POLL);
    return () => window.clearInterval(id);
  }, [thread?.is_current]);

  // Follow the conversation down as it grows, but not on every poll.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [count]);

  const send = async () => {
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    const result = await sendMentorMessage(body, studentId);
    setSending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDraft("");
    await load();
  };

  if (loading) return <SkeletonRows count={3} height="h-12" />;

  if (!thread) {
    return (
      <p className="text-sm text-muted-foreground">
        There is no mentoring conversation here yet.
      </p>
    );
  }

  return (
    <div className={className}>
      <div className="max-h-[26rem] space-y-2 overflow-y-auto rounded-xl border border-border bg-muted/20 p-3">
        {thread.messages.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No messages yet. Say hello.
          </p>
        ) : (
          thread.messages.map((m) => (
            <div
              key={m.id}
              className={`flex ${m.mine ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-3 py-2 ${
                  m.mine
                    ? "bg-primary text-primary-foreground"
                    : "bg-card text-foreground border border-border"
                }`}
              >
                <p className="whitespace-pre-wrap break-words text-sm">
                  {m.body}
                </p>
                <p
                  className={`mt-0.5 text-[11px] ${
                    m.mine
                      ? "text-primary-foreground/70"
                      : "text-muted-foreground"
                  }`}
                >
                  {when(m.sent_at)}
                  {m.mine && (m.read_at ? " · Read" : " · Sent")}
                </p>
              </div>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      {error && (
        <div className="mt-2">
          <ErrorState message={error} size="inline" />
        </div>
      )}

      {thread.is_current ? (
        <div className="mt-2 flex items-end gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            maxLength={4000}
            placeholder={
              thread.my_role === "student"
                ? `Message ${thread.other.name}…`
                : `Message ${thread.other.name.split(" ")[0]}…`
            }
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter is a new line, as everywhere else.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <Button onClick={send} disabled={sending || !draft.trim()}>
            <Send className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">Send</span>
          </Button>
        </div>
      ) : (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="h-3.5 w-3.5" aria-hidden="true" />
          This mentoring assignment has ended, so the conversation is closed.
          You can still read it.
        </p>
      )}
    </div>
  );
}
