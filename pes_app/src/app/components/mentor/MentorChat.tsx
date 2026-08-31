import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCheck,
  Clock,
  Download,
  FileText,
  Loader2,
  Lock,
  Paperclip,
  Send,
  X,
} from "lucide-react";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { ErrorState, SkeletonRows } from "../common";
import { notifyCountsChanged } from "../../hooks/useNotificationCounts";
import { useThreadChannel } from "../../hooks/useThreadChannel";
import {
  ATTACHMENT_MAX_BYTES,
  attachmentUrl,
  getMentorMessage,
  getMentorThread,
  markThreadRead,
  sendMentorMessage,
  uploadAttachment,
  type MentorMessage,
  type MentorThread,
} from "../../../lib/mentorService";

const when = (iso: string) => {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : d.toLocaleString(undefined, {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
      });
};

const readableSize = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${Math.round(bytes / 1024)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/**
 * Where a message has got to, in one glyph.
 *
 * A clock while the server has not confirmed it, two grey ticks once it is
 * stored, two blue once the other person has opened the conversation. Only
 * ever shown on your own messages: the state of a message you received is
 * not information you need.
 */
function Ticks({ message }: { message: MentorMessage }) {
  if (message.pending) {
    return <Clock className="h-3.5 w-3.5 opacity-70" aria-label="Sending" />;
  }
  if (message.read_at) {
    return (
      <CheckCheck
        className="h-3.5 w-3.5 text-sky-300"
        aria-label="Read"
      />
    );
  }
  return (
    <CheckCheck className="h-3.5 w-3.5 opacity-70" aria-label="Sent" />
  );
}

/** An attached file: previewed if it is an image, listed if it is not. */
function Attachment({ message }: { message: MentorMessage }) {
  const file = message.attachment;
  const [url, setUrl] = useState<string | null>(null);
  const isImage = Boolean(file?.type?.startsWith("image/"));

  useEffect(() => {
    let live = true;
    if (file) {
      attachmentUrl(file.path).then((u) => live && setUrl(u));
    }
    return () => {
      live = false;
    };
  }, [file?.path]);

  if (!file) return null;

  return (
    <div className="mt-1">
      {isImage && url ? (
        <a href={url} target="_blank" rel="noreferrer">
          <img
            src={url}
            alt={file.name}
            className="max-h-56 rounded-lg border border-border/40 object-cover"
          />
        </a>
      ) : (
        <a
          href={url ?? undefined}
          target="_blank"
          rel="noreferrer"
          className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 ${
            message.mine
              ? "border-primary-foreground/25 bg-primary-foreground/10"
              : "border-border bg-muted/50"
          } ${url ? "" : "pointer-events-none opacity-60"}`}
        >
          <FileText className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm">{file.name}</span>
            <span className="block text-[11px] opacity-70">
              {readableSize(file.size)}
            </span>
          </span>
          <Download className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
        </a>
      )}
    </div>
  );
}

/**
 * One conversation between a student and their mentor.
 *
 * The same component serves both sides, because the conversation is
 * symmetric — only the name at the top and the side each bubble sits on
 * differ, and the database already says which of the two the reader is.
 *
 * Messages arrive over a live connection rather than by asking again on a
 * timer, so a reply lands while you are looking at it. A poll runs behind
 * that as a fallback, slowly: a socket that has quietly dropped should cost
 * a late message, not a lost one.
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
  const [file, setFile] = useState<File | null>(null);
  const [theyAreTyping, setTheyAreTyping] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const loadRef = useRef<() => Promise<void>>();
  const count = thread?.messages.length ?? 0;

  const load = useCallback(async () => {
    const result = await getMentorThread(studentId);
    if (!result.ok) setError(result.error);
    else {
      setError(null);
      setThread(result.data);
      if (result.data?.messages.some((m) => !m.mine && !m.read_at)) {
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

  /* A message that arrives while the conversation is open has been read the
     moment it is shown, so it is marked immediately rather than waiting for
     the next time the page is opened. */
  const receive = useCallback(
    async (messageId: string) => {
      const incoming = await getMentorMessage(messageId);
      if (!incoming) return;
      setThread((prev) => {
        if (!prev) return prev;
        if (prev.messages.some((m) => m.id === incoming.id)) return prev;
        return { ...prev, messages: [...prev.messages, incoming] };
      });
      if (!incoming.mine) {
        setTheyAreTyping(false);
        await markThreadRead(studentId);
        notifyCountsChanged();
      }
    },
    [studentId],
  );

  const applyRead = useCallback((messageId: string, readAt: string | null) => {
    setThread((prev) =>
      prev
        ? {
            ...prev,
            messages: prev.messages.map((m) =>
              m.id === messageId ? { ...m, read_at: readAt } : m,
            ),
          }
        : prev,
    );
  }, []);

  const channel = useThreadChannel({
    assignmentId: thread?.is_current ? thread.assignment_id : null,
    myRole: thread?.my_role ?? "student",
    onInserted: receive,
    onUpdated: applyRead,
    onTyping: setTheyAreTyping,
  });

  /* The socket is the delivery mechanism; this is the safety net under it,
     and deliberately slow enough not to matter when the socket is fine. */
  useEffect(() => {
    if (!thread?.is_current) return;
    const id = window.setInterval(() => loadRef.current?.(), 90_000);
    return () => window.clearInterval(id);
  }, [thread?.is_current]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [count, theyAreTyping]);

  const send = async () => {
    const body = draft.trim();
    if (!body && !file) return;
    if (!thread) return;

    setSending(true);
    channel.stopTyping();

    let attachment;
    if (file) {
      const up = await uploadAttachment(thread.assignment_id, file);
      if (!up.ok) {
        setError(up.error);
        setSending(false);
        return;
      }
      attachment = up.data;
    }

    /* Show it straight away with a clock on it. The insert comes back over
       the socket like anyone else's message and replaces this. */
    const tempId = `pending-${crypto.randomUUID()}`;
    const optimistic: MentorMessage = {
      id: tempId,
      sender_role: thread.my_role,
      body: body || null,
      sent_at: new Date().toISOString(),
      read_at: null,
      mine: true,
      attachment: attachment ?? null,
      pending: true,
    };
    setThread((prev) =>
      prev ? { ...prev, messages: [...prev.messages, optimistic] } : prev,
    );
    setDraft("");
    setFile(null);
    if (fileInput.current) fileInput.current.value = "";

    const result = await sendMentorMessage(body, studentId, attachment);
    setSending(false);

    if (!result.ok) {
      setThread((prev) =>
        prev
          ? { ...prev, messages: prev.messages.filter((m) => m.id !== tempId) }
          : prev,
      );
      setDraft(body);
      setError(result.error);
      return;
    }

    // Swap the placeholder for the real row. If the socket got there first
    // the id is already present, so the placeholder just goes.
    const real = await getMentorMessage(result.data.message_id);
    setThread((prev) => {
      if (!prev) return prev;
      const without = prev.messages.filter((m) => m.id !== tempId);
      if (!real || without.some((m) => m.id === real.id)) {
        return { ...prev, messages: without };
      }
      return { ...prev, messages: [...without, real] };
    });
  };

  const pickFile = (chosen: File | null) => {
    if (!chosen) return;
    if (chosen.size > ATTACHMENT_MAX_BYTES) {
      setError("That file is larger than 10 MB.");
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    setError(null);
    setFile(chosen);
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
                    : "border border-border bg-card text-foreground"
                }`}
              >
                {m.body && (
                  <p className="whitespace-pre-wrap break-words text-sm">
                    {m.body}
                  </p>
                )}
                <Attachment message={m} />
                <p
                  className={`mt-0.5 flex items-center gap-1 text-[11px] ${
                    m.mine
                      ? "justify-end text-primary-foreground/70"
                      : "text-muted-foreground"
                  }`}
                >
                  {when(m.sent_at)}
                  {m.mine && <Ticks message={m} />}
                </p>
              </div>
            </div>
          ))
        )}

        {theyAreTyping && (
          <div className="flex justify-start">
            <div className="flex items-center gap-1.5 rounded-2xl border border-border bg-card px-3 py-2">
              <span className="flex gap-1" aria-hidden="true">
                {[0, 150, 300].map((delay) => (
                  <span
                    key={delay}
                    className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60"
                    style={{ animationDelay: `${delay}ms` }}
                  />
                ))}
              </span>
              <span className="text-xs text-muted-foreground">
                {thread.other.name.split(" ")[0]} is typing…
              </span>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {error && (
        <div className="mt-2">
          <ErrorState message={error} size="inline" />
        </div>
      )}

      {thread.is_current ? (
        <div className="mt-2 space-y-2">
          {file && (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-2.5 py-2">
              <FileText className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                {file.name}
              </span>
              <span className="text-xs text-muted-foreground">
                {readableSize(file.size)}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setFile(null);
                  if (fileInput.current) fileInput.current.value = "";
                }}
                aria-label="Remove attachment"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}

          <div className="flex items-end gap-2">
            <input
              ref={fileInput}
              type="file"
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
            <Button
              variant="outline"
              size="icon"
              disabled={sending}
              onClick={() => fileInput.current?.click()}
              aria-label="Attach a file"
            >
              <Paperclip className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Textarea
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                if (e.target.value) channel.typing();
                else channel.stopTyping();
              }}
              onBlur={() => channel.stopTyping()}
              rows={2}
              maxLength={4000}
              placeholder={
                thread.my_role === "student"
                  ? `Message ${thread.other.name}…`
                  : `Message ${thread.other.name.split(" ")[0]}…`
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <Button
              onClick={send}
              disabled={sending || (!draft.trim() && !file)}
              aria-label="Send"
            >
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="h-4 w-4" aria-hidden="true" />
              )}
            </Button>
          </div>
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
