import { useCallback, useEffect, useState } from "react";
import { ClipboardCheck, X } from "lucide-react";
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
import { CourseCode, ErrorState, SectionCard, SkeletonRows, StatusBadge } from "../common";
import { supabase } from "../../../lib/supabase";
import { describeBatch } from "../../../lib/batch";

interface PendingApproval {
  period_id: string;
  title: string;
  department: string;
  semester: number;
  batch_year: number;
  academic_year: string;
  feedback_type: string;
  opens_at: string;
  closes_at: string;
  requested_by: string;
  course_count: number;
  question_count: number;
  courses: { course_code: string; title: string }[];
}

/**
 * Forms a lecturer has asked the department to run.
 *
 * This is the department's one remaining say over somebody else's feedback,
 * and it is the one worth keeping: what students are asked about a course is
 * the department's accountability, so a form a lecturer wrote for their own
 * course gets read before students see it.
 *
 * What used to sit beside this — releasing results course by course after a
 * round closed — is gone. That decision had no content: the department had
 * already chosen to run the round and already chosen when it ended, and a
 * third approval only delayed a lecturer reading their own students' words.
 * Opening the round is the release now.
 */
export function FeedbackApprovals({ onChanged }: { onChanged?: () => void }) {
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<PendingApproval | null>(null);
  const [rejectNotes, setRejectNotes] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc(
      "get_pending_feedback_approvals",
    );
    if (rpcError) {
      console.error("[FeedbackApprovals]", rpcError);
      setError("Unable to load feedback forms awaiting approval.");
    } else {
      setApprovals((data ?? []) as PendingApproval[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const decide = async (
    key: string,
    periodId: string,
    approve: boolean,
    notes: string | null,
  ) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    const { data, error: rpcError } = await supabase.rpc(
      "decide_feedback_period",
      { p_period_id: periodId, p_approve: approve, p_notes: notes },
    );
    setBusy(null);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    await load();
    setNotice((data as { message?: string } | null)?.message ?? "Done.");
    onChanged?.();
  };

  // Nothing pending and nothing to report is nothing to show.
  if (!loading && approvals.length === 0 && !notice && !error) return null;

  return (
    <>
      {notice && (
        <div className="rounded-xl border border-success-border bg-success-bg px-3 py-2 text-sm text-success-fg">
          {notice}
        </div>
      )}
      {error && <ErrorState message={error} onRetry={load} size="inline" />}

      {(loading || approvals.length > 0) && (
        <SectionCard
          title="Feedback forms awaiting approval"
          description="Requested by lecturers for courses they teach. Students see nothing until you approve."
          actions={
            approvals.length > 0 ? (
              <StatusBadge tone="warning">
                {approvals.length} pending
              </StatusBadge>
            ) : undefined
          }
          flush
        >
          {loading ? (
            <div className="p-4">
              <SkeletonRows count={1} height="h-16" />
            </div>
          ) : (
            <ul className="divide-y divide-border/70">
              {approvals.map((a) => (
                <li
                  key={a.period_id}
                  className="flex flex-wrap items-start justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {a.title}
                      </span>
                      <StatusBadge tone="neutral">
                        {a.feedback_type === "mid_semester"
                          ? "Mid semester"
                          : "End semester"}
                      </StatusBadge>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Requested by {a.requested_by} ·{" "}
                      {describeBatch(a.batch_year)} · Semester {a.semester}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {a.course_count} course
                      {a.course_count === 1 ? "" : "s"} · {a.question_count}{" "}
                      question{a.question_count === 1 ? "" : "s"}
                      {a.courses.length > 0 && (
                        <>
                          {" — "}
                          {a.courses.map((c, i) => (
                            <span key={c.course_code}>
                              {i > 0 && ", "}
                              <CourseCode code={c.course_code} className="font-medium" />
                            </span>
                          ))}
                        </>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {new Date(a.opens_at).toLocaleDateString()} →{" "}
                      {new Date(a.closes_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy !== null}
                      onClick={() => {
                        setRejectNotes("");
                        setRejecting(a);
                      }}
                    >
                      <X className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                      Reject
                    </Button>
                    <Button
                      size="sm"
                      disabled={busy !== null}
                      onClick={() =>
                        decide(
                          `approve-${a.period_id}`,
                          a.period_id,
                          true,
                          null,
                        )
                      }
                    >
                      <ClipboardCheck
                        className="mr-1.5 h-3.5 w-3.5"
                        aria-hidden="true"
                      />
                      Approve
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      )}

      <AlertDialog
        open={rejecting !== null}
        onOpenChange={(open) => !open && setRejecting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject "{rejecting?.title}"?</AlertDialogTitle>
            <AlertDialogDescription>
              The lecturer can revise the form and ask again. Your note is shown
              to them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            value={rejectNotes}
            onChange={(e) => setRejectNotes(e.target.value)}
            rows={3}
            placeholder="What needs changing before this can run?"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = rejecting;
                setRejecting(null);
                if (!target) return;
                decide(
                  `reject-${target.period_id}`,
                  target.period_id,
                  false,
                  rejectNotes.trim() || null,
                );
              }}
            >
              Reject
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
