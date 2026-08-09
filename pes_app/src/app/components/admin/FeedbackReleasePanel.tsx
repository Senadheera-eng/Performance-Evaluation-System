import { useEffect, useState } from "react";
import {
  CheckCircle2,
  ClipboardCheck,
  Lock,
  MessageSquareText,
  ShieldCheck,
  Undo2,
  Users,
  X,
} from "lucide-react";
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
import {
  EmptyState,
  ErrorState,
  SectionCard,
  SkeletonRows,
  StatusBadge,
} from "../common";
import { supabase } from "../../../lib/supabase";
import { describeBatch } from "../../../lib/batch";

interface ReleasableOffering {
  period_id: string;
  period_title: string;
  period_status: string;
  offering_id: string;
  course_code: string;
  course_title: string;
  semester: number;
  batch_year: number;
  response_count: number;
  eligible_count: number;
  is_released: boolean;
  lecturers: string | null;
}

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
 * The department's two feedback decisions: approving forms a lecturer wants
 * to run, and releasing results to the lecturers they are about.
 *
 * Both exist because a lecturer's own course feedback is not theirs to
 * control — the department is accountable for what students are asked, and
 * for checking what came back before it is forwarded.
 */
export function FeedbackReleasePanel({ onChanged }: { onChanged?: () => void }) {
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [releasable, setReleasable] = useState<ReleasableOffering[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<PendingApproval | null>(null);
  const [rejectNotes, setRejectNotes] = useState("");

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    setError(null);
    const [approvalRes, releaseRes] = await Promise.all([
      supabase.rpc("get_pending_feedback_approvals"),
      supabase.rpc("get_releasable_feedback"),
    ]);

    if (approvalRes.error) {
      console.error("[FeedbackReleasePanel] approvals", approvalRes.error);
    } else {
      setApprovals((approvalRes.data ?? []) as PendingApproval[]);
    }

    if (releaseRes.error) {
      console.error("[FeedbackReleasePanel] releasable", releaseRes.error);
      setError("Unable to load feedback awaiting release.");
    } else {
      setReleasable((releaseRes.data ?? []) as ReleasableOffering[]);
    }
    setLoading(false);
  };

  const act = async (
    key: string,
    fn: () => Promise<{ data: unknown; error: unknown }>,
  ) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    const { data, error: rpcError } = (await fn()) as {
      data: { message?: string } | null;
      error: { message: string } | null;
    };
    setBusy(null);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    await load();
    setNotice(data?.message ?? "Done.");
    onChanged?.();
  };

  const nothingToDo = approvals.length === 0 && releasable.length === 0;
  if (!loading && nothingToDo && !notice && !error) return null;

  return (
    <>
      {notice && (
        <div className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          {notice}
        </div>
      )}
      {error && <ErrorState message={error} onRetry={load} size="inline" />}

      {/* Forms a lecturer wants to run */}
      {(loading || approvals.length > 0) && (
        <SectionCard
          title="Feedback forms awaiting approval"
          description="Requested by lecturers for courses they teach. Students see nothing until you approve."
          actions={
            approvals.length > 0 ? (
              <StatusBadge tone="warning">{approvals.length} pending</StatusBadge>
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
                      {a.course_count === 1 ? "" : "s"} ·{" "}
                      {a.question_count} question
                      {a.question_count === 1 ? "" : "s"}
                      {a.courses.length > 0 &&
                        ` — ${a.courses.map((c) => c.course_code).join(", ")}`}
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
                      <X className="mr-1.5 h-3.5 w-3.5" />
                      Reject
                    </Button>
                    <Button
                      size="sm"
                      disabled={busy !== null}
                      onClick={() =>
                        act(`approve-${a.period_id}`, () =>
                          supabase.rpc("decide_feedback_period", {
                            p_period_id: a.period_id,
                            p_approve: true,
                            p_notes: null,
                          }),
                        )
                      }
                    >
                      <ClipboardCheck className="mr-1.5 h-3.5 w-3.5" />
                      Approve
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      )}

      {/* Results waiting to go to their lecturers */}
      {(loading || releasable.length > 0) && (
        <SectionCard
          title="Feedback results"
          description="Closed periods. Releasing lets the assigned lecturers see their own results."
          flush
        >
          {loading ? (
            <div className="p-4">
              <SkeletonRows count={2} height="h-16" />
            </div>
          ) : releasable.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={MessageSquareText}
                title="Nothing to release"
                description="Results appear here once a feedback period closes."
                size="inline"
              />
            </div>
          ) : (
            <ul className="divide-y divide-border/70">
              {releasable.map((r) => (
                <li
                  key={`${r.period_id}:${r.offering_id}`}
                  className="flex flex-wrap items-start justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-primary">
                        {r.course_code}
                      </span>
                      <span className="truncate text-sm text-foreground">
                        {r.course_title}
                      </span>
                      {r.is_released ? (
                        <StatusBadge tone="success" icon={ShieldCheck}>
                          Released
                        </StatusBadge>
                      ) : (
                        <StatusBadge tone="neutral" icon={Lock}>
                          Not released
                        </StatusBadge>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {r.period_title} · {describeBatch(r.batch_year)} ·
                      Semester {r.semester}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Users className="h-3 w-3" aria-hidden="true" />
                      {r.response_count} of {r.eligible_count} responded
                      {r.lecturers && ` · goes to ${r.lecturers}`}
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 gap-2">
                    {r.is_released ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy !== null}
                        onClick={() =>
                          act(`withdraw-${r.offering_id}`, () =>
                            supabase.rpc("withdraw_feedback_release", {
                              p_period_id: r.period_id,
                              p_offering_id: r.offering_id,
                            }),
                          )
                        }
                      >
                        <Undo2 className="mr-1.5 h-3.5 w-3.5" />
                        Withdraw
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        disabled={busy !== null || r.lecturers === null}
                        title={
                          r.lecturers === null
                            ? "No lecturer is assigned to this course, so there is nobody to release it to"
                            : undefined
                        }
                        onClick={() =>
                          act(`release-${r.offering_id}`, () =>
                            supabase.rpc("release_feedback", {
                              p_period_id: r.period_id,
                              p_offering_id: r.offering_id,
                              p_notes: null,
                            }),
                          )
                        }
                      >
                        <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                        Release
                      </Button>
                    )}
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
                act(`reject-${target.period_id}`, () =>
                  supabase.rpc("decide_feedback_period", {
                    p_period_id: target.period_id,
                    p_approve: false,
                    p_notes: rejectNotes.trim() || null,
                  }),
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
