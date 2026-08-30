import { useCallback, useEffect, useState } from "react";
import { EyeOff, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { ErrorState, SkeletonRows, StatusBadge } from "../common";
import {
  deleteMentorNote,
  getMentorNotes,
  saveMentorNote,
  type MentorNote,
} from "../../../lib/mentorService";

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/**
 * A mentor's private working notes about one student.
 *
 * Nobody else can read these — not the head of department, not an admin, and
 * not the student. That is the point of them: a record whose audience is
 * uncertain is a record of what was safe to write rather than what happened.
 * The banner says so plainly, because a mentor writing frankly needs to know
 * it is true rather than assume it.
 *
 * If something here should reach the department, the mentor sends it. Writing
 * a note and reporting a concern are different acts and the page keeps them
 * apart.
 */
export function MentorNotes({
  studentId,
  canWrite,
}: {
  studentId: string;
  /** False once the student has moved on: the record stays, the pen goes. */
  canWrite: boolean;
}) {
  const [notes, setNotes] = useState<MentorNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState<MentorNote | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<MentorNote | null>(null);

  const load = useCallback(async () => {
    const result = await getMentorNotes(studentId);
    if (!result.ok) setError(result.error);
    else {
      setError(null);
      setNotes(result.data);
    }
    setLoading(false);
  }, [studentId]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const save = async () => {
    const body = draft.trim();
    if (!body) return;
    setBusy(true);
    const result = await saveMentorNote(studentId, body, editing?.note_id);
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(result.data.message);
    setDraft("");
    setComposing(false);
    setEditing(null);
    await load();
  };

  const remove = async (note: MentorNote) => {
    setBusy(true);
    const result = await deleteMentorNote(note.note_id);
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(result.data.message);
    await load();
  };

  const startEdit = (note: MentorNote) => {
    setEditing(note);
    setDraft(note.body);
    setComposing(true);
  };

  const cancel = () => {
    setComposing(false);
    setEditing(null);
    setDraft("");
  };

  return (
    <div className="space-y-3">
      <p className="flex items-start gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <EyeOff className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
        <span>
          Only you can read these. Your head of department, the faculty
          administrators and the student cannot. If something here needs to
          reach the department, send it to them yourself.
        </span>
      </p>

      {error && <ErrorState message={error} size="inline" onRetry={load} />}

      {loading ? (
        <SkeletonRows count={2} height="h-16" />
      ) : (
        <>
          {composing ? (
            <div className="space-y-2 rounded-xl border border-border bg-card p-3">
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={4}
                maxLength={8000}
                autoFocus
                placeholder="What was discussed, what was agreed, what to follow up…"
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  {draft.length}/8000
                </span>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={cancel} disabled={busy}>
                    <X className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                    Cancel
                  </Button>
                  <Button size="sm" onClick={save} disabled={busy || !draft.trim()}>
                    {editing ? "Save changes" : "Add note"}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            canWrite && (
              <Button size="sm" variant="outline" onClick={() => setComposing(true)}>
                <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Add a note
              </Button>
            )
          )}

          {notes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {canWrite
                ? "No notes yet."
                : "You did not write any notes about this student."}
            </p>
          ) : (
            <ul className="space-y-2">
              {notes.map((n) => (
                <li
                  key={n.note_id}
                  className="rounded-xl border border-border bg-card px-3 py-2.5"
                >
                  <p className="whitespace-pre-wrap break-words text-sm text-foreground">
                    {n.body}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {when(n.created_at)}
                      {n.updated_at && " · edited"}
                    </span>
                    {/* A note from a spell when this student was not yours is
                        still yours, and worth marking as older context. */}
                    {!n.written_while_current && (
                      <StatusBadge tone="neutral">Earlier assignment</StatusBadge>
                    )}
                    <span className="flex-1" />
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => startEdit(n)}
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      <span className="sr-only">Edit note</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => setConfirming(n)}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      <span className="sr-only">Delete note</span>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this note?</AlertDialogTitle>
            <AlertDialogDescription>
              It will be gone for good. Nobody else could read it, so nobody
              else will miss it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = confirming;
                setConfirming(null);
                if (target) remove(target);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
