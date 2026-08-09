import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ClipboardList,
  Clock,
  Lock,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Square,
  Trash2,
  XCircle,
} from "lucide-react";
import { Button } from "../ui/button";
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
import {
  EmptyState,
  ErrorState,
  SectionCard,
  SkeletonRows,
  StatusBadge,
  type StatusTone,
} from "../common";
import { FeedbackRequestDialog } from "./FeedbackRequestDialog";
import { useAuth } from "../../context/AuthContext";
import { describeBatch } from "../../../lib/batch";
import {
  getQuestionBank,
  type FeedbackQuestion,
} from "../../../lib/feedbackService";
import {
  createFeedbackRequest,
  getMyFeedbackRequests,
  getMyTeaching,
  resubmitFeedbackRequest,
  setFeedbackRequestStatus,
  updateFeedbackRequest,
  withdrawFeedbackRequest,
  type FeedbackRequest,
  type FeedbackRequestDraft,
  type TeachingOffering,
} from "../../../lib/staffService";

/** Where a request stands, as one badge. Approval comes first: an approved
 *  form that has not opened yet is a different thing from one still waiting. */
function describeState(r: FeedbackRequest): { tone: StatusTone; label: string } {
  if (r.approval_status === "pending") {
    return { tone: "warning", label: "Waiting for your department" };
  }
  if (r.approval_status === "rejected") {
    return { tone: "danger", label: "Changes requested" };
  }
  switch (r.status) {
    case "open":
      return { tone: "success", label: "Open to students" };
    case "closed":
      return { tone: "neutral", label: "Closed" };
    case "archived":
      return { tone: "neutral", label: "Archived" };
    default:
      return { tone: "info", label: "Approved — not open yet" };
  }
}

const formatWindow = (opens: string, closes: string) =>
  `${new Date(opens).toLocaleDateString()} → ${new Date(closes).toLocaleDateString()}`;

/**
 * The forms this lecturer has asked to run.
 *
 * A lecturer raising their own feedback round is the point of this screen, but
 * raising one is not the same as running one: it goes to the department first,
 * and only an approved form can be opened. Every rule shown here is enforced
 * in the database as well, so what this hides cannot be reached by other means.
 */
export function FeedbackRequests() {
  const { staff, user } = useAuth();
  const [requests, setRequests] = useState<FeedbackRequest[]>([]);
  const [teaching, setTeaching] = useState<TeachingOffering[]>([]);
  const [bank, setBank] = useState<FeedbackQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<FeedbackRequest | null>(null);
  const [withdrawing, setWithdrawing] = useState<FeedbackRequest | null>(null);

  useEffect(() => {
    if (staff?.lecturerId) load(staff.lecturerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staff?.lecturerId]);

  const load = async (lecturerId: string) => {
    setLoading(true);
    setError(null);
    const [requestResult, teachingResult, questions] = await Promise.all([
      getMyFeedbackRequests(lecturerId),
      getMyTeaching(),
      getQuestionBank(),
    ]);

    if (!requestResult.ok) {
      setError("We could not load your feedback forms. Please try again.");
      setLoading(false);
      return;
    }
    setRequests(requestResult.data);
    if (teachingResult.ok) setTeaching(teachingResult.data);
    setBank(questions);
    setLoading(false);
  };

  const reload = () => staff?.lecturerId && load(staff.lecturerId);

  /* Course codes for the courses on a form. A lecturer can only ever put
     courses they teach on one, so their own teaching list resolves them all. */
  const courseLabels = useMemo(() => {
    const byId = new Map(teaching.map((o) => [o.course_id, o.course_code]));
    return (ids: string[]) =>
      ids.map((id) => byId.get(id) ?? "—").sort().join(", ");
  }, [teaching]);

  const act = async (
    key: string,
    run: () => Promise<{ ok: boolean; error?: string }>,
    message: string,
  ) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    const result = await run();
    setBusy(null);
    if (!result.ok) {
      setError(result.error ?? "That did not work. Please try again.");
      return;
    }
    await reload();
    setNotice(message);
  };

  const save = async (draft: FeedbackRequestDraft) => {
    if (!staff || !user) return { ok: false, error: "You are not signed in." };
    const result = editing
      ? await updateFeedbackRequest(editing.id, draft)
      : await createFeedbackRequest(draft, staff.lecturerId, staff.department, user.id);
    if (!result.ok) return result;
    await reload();
    setNotice(
      editing
        ? "Saved. Your department will see the updated form."
        : "Sent to your department for approval.",
    );
    return { ok: true };
  };

  const openEditor = (request: FeedbackRequest | null) => {
    setEditing(request);
    setEditorOpen(true);
  };

  const awaitingReview = requests.filter((r) => r.approval_status === "pending").length;

  return (
    <div className="space-y-4">
      {notice && (
        <div className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          {notice}
        </div>
      )}
      {error && <ErrorState message={error} onRetry={reload} size="inline" />}

      <SectionCard
        title="Feedback forms you asked for"
        description="Your department approves a form before students can see it."
        actions={
          <div className="flex items-center gap-2">
            {awaitingReview > 0 && (
              <StatusBadge tone="warning" icon={Clock}>
                {awaitingReview} waiting
              </StatusBadge>
            )}
            <Button size="sm" onClick={() => openEditor(null)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Request a form
            </Button>
          </div>
        }
        flush
      >
        {loading ? (
          <div className="p-4">
            <SkeletonRows count={3} height="h-16" />
          </div>
        ) : requests.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={ClipboardList}
              title="You have not requested a feedback form"
              description="Ask your students what they think of a course you teach. Your department reviews the form before it opens."
            />
          </div>
        ) : (
          <ul className="divide-y divide-border/70">
            {requests.map((r) => {
              const state = describeState(r);
              const codes = courseLabels(r.course_ids);
              const editable =
                r.approval_status === "pending" || r.approval_status === "rejected";

              return (
                <li key={r.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-foreground">
                          {r.title}
                        </span>
                        <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
                        <StatusBadge tone="neutral">
                          {r.feedback_type === "mid_semester"
                            ? "Mid semester"
                            : "End semester"}
                        </StatusBadge>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {describeBatch(r.batch_year ?? 0)} · Semester {r.semester} ·{" "}
                        {r.academic_year}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {codes || "No courses yet"} · {r.question_ids.length} question
                        {r.question_ids.length === 1 ? "" : "s"} ·{" "}
                        {formatWindow(r.opens_at, r.closes_at)}
                      </p>
                      {r.approval_status === "rejected" && r.approval_notes && (
                        <p className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-muted/60 px-2.5 py-1.5 text-xs text-foreground">
                          <XCircle
                            className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-destructive"
                            aria-hidden="true"
                          />
                          <span>{r.approval_notes}</span>
                        </p>
                      )}
                    </div>

                    <div className="flex flex-shrink-0 flex-wrap gap-2">
                      {editable && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy !== null}
                          onClick={() => openEditor(r)}
                        >
                          <Pencil className="mr-1.5 h-3.5 w-3.5" />
                          Edit
                        </Button>
                      )}
                      {r.approval_status === "rejected" && (
                        <Button
                          size="sm"
                          disabled={busy !== null}
                          onClick={() =>
                            act(
                              `resubmit-${r.id}`,
                              () => resubmitFeedbackRequest(r.id),
                              "Sent back to your department.",
                            )
                          }
                        >
                          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                          Ask again
                        </Button>
                      )}
                      {editable && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy !== null}
                          onClick={() => setWithdrawing(r)}
                        >
                          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                          Withdraw
                        </Button>
                      )}
                      {r.approval_status === "approved" && r.status === "draft" && (
                        <Button
                          size="sm"
                          disabled={busy !== null}
                          onClick={() =>
                            act(
                              `open-${r.id}`,
                              () => setFeedbackRequestStatus(r.id, "open"),
                              "Your students can fill this in now.",
                            )
                          }
                        >
                          <Play className="mr-1.5 h-3.5 w-3.5" />
                          Open to students
                        </Button>
                      )}
                      {r.approval_status === "approved" && r.status === "open" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy !== null}
                          onClick={() =>
                            act(
                              `close-${r.id}`,
                              () => setFeedbackRequestStatus(r.id, "closed"),
                              "Closed. Your department releases the results.",
                            )
                          }
                        >
                          <Square className="mr-1.5 h-3.5 w-3.5" />
                          Close now
                        </Button>
                      )}
                    </div>
                  </div>

                  {r.status === "closed" && (
                    <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Lock className="h-3 w-3" aria-hidden="true" />
                      Results appear under Results once your department releases them.
                    </p>
                  )}
                  {r.approval_status === "approved" && r.status === "draft" && (
                    <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                      Approved
                      {r.approved_at &&
                        ` on ${new Date(r.approved_at).toLocaleDateString()}`}
                      . The form is fixed now — open it when you are ready.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      <FeedbackRequestDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        existing={editing}
        teaching={teaching}
        bank={bank}
        onSave={save}
      />

      <AlertDialog
        open={withdrawing !== null}
        onOpenChange={(open) => !open && setWithdrawing(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Withdraw "{withdrawing?.title}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This takes the request off your department's list. No student has
              seen it, and nothing is kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = withdrawing;
                setWithdrawing(null);
                if (!target) return;
                act(
                  `withdraw-${target.id}`,
                  () => withdrawFeedbackRequest(target.id),
                  "Request withdrawn.",
                );
              }}
            >
              Withdraw
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
