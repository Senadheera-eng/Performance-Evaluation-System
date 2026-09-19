import { useEffect, useState } from "react";
import { CheckCircle2, ClipboardCheck, Undo2, Users } from "lucide-react";
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
import {
  publishOfferingResults,
  returnOfferingResults,
} from "../../../lib/staffService";

interface PendingReview {
  offering_id: string;
  course_code: string;
  course_title: string;
  semester: number;
  academic_year: string;
  batch_year: number;
  department: string;
  submitted_count: number;
  draft_count: number;
  total_count: number;
  submitted_at: string | null;
  submitted_by: string | null;
}

/**
 * Result sheets waiting on the department.
 *
 * This is the other half of the lecturer's submit action. Publication is
 * deliberately the department's decision, not the lecturer's — the database
 * refuses `publish_offering_results` to anyone who is not a department admin
 * — so without somewhere for the admin to see and act on submissions, a
 * submitted sheet would simply sit there.
 */
export function PendingResultReviews({
  onChanged,
}: {
  /** Lets the host page refresh whatever it is showing after a decision. */
  onChanged?: () => void;
}) {
  const [reviews, setReviews] = useState<PendingReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [returning, setReturning] = useState<PendingReview | null>(null);
  const [returnNotes, setReturnNotes] = useState("");
  const [publishing, setPublishing] = useState<PendingReview | null>(null);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc(
      "get_pending_result_reviews",
    );
    if (rpcError) {
      console.error("[PendingResultReviews] failed to load", rpcError);
      setError("Unable to load sheets awaiting review.");
      setLoading(false);
      return;
    }
    setReviews((data ?? []) as PendingReview[]);
    setLoading(false);
  };

  const confirmPublish = async () => {
    if (!publishing) return;
    const target = publishing;
    setPublishing(null);
    setBusy(target.offering_id);
    setError(null);
    setNotice(null);

    const result = await publishOfferingResults(target.offering_id);
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotice(`${target.course_code}: ${result.data.message}`);
    await load();
    onChanged?.();
  };

  const confirmReturn = async () => {
    if (!returning) return;
    const target = returning;
    setReturning(null);
    setBusy(target.offering_id);
    setError(null);
    setNotice(null);

    const result = await returnOfferingResults(
      target.offering_id,
      returnNotes.trim() || null,
    );
    setReturnNotes("");
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotice(`${target.course_code}: ${result.data.message}`);
    await load();
    onChanged?.();
  };

  // Nothing waiting is the normal state; a permanently empty card is noise.
  if (!loading && reviews.length === 0 && !notice && !error) return null;

  return (
    <>
      <SectionCard
        title="Awaiting your review"
        description="Result sheets lecturers have submitted. Publishing releases the grades to students."
        actions={
          reviews.length > 0 ? (
            <StatusBadge tone="warning">{reviews.length} pending</StatusBadge>
          ) : undefined
        }
        flush
      >
        {error && (
          <div className="p-3">
            <ErrorState message={error} onRetry={load} size="inline" />
          </div>
        )}
        {notice && (
          <div className="border-b border-border/70 bg-success-bg px-4 py-2 text-sm text-success-fg">
            {notice}
          </div>
        )}

        {loading ? (
          <div className="p-4">
            <SkeletonRows count={2} height="h-16" />
          </div>
        ) : reviews.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={CheckCircle2}
              title="Nothing waiting"
              description="Submitted result sheets appear here for review."
              size="inline"
            />
          </div>
        ) : (
          <ul className="divide-y divide-border/70">
            {reviews.map((r) => (
              <li
                key={r.offering_id}
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
                    {r.draft_count > 0 && (
                      <StatusBadge tone="warning">
                        {r.draft_count} still draft
                      </StatusBadge>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {describeBatch(r.batch_year)} · Semester {r.semester} ·{" "}
                    {r.academic_year} · {r.department}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Users className="h-3 w-3" aria-hidden="true" />
                    {r.submitted_count} of {r.total_count} submitted
                    {r.submitted_by && ` by ${r.submitted_by}`}
                    {r.submitted_at &&
                      ` on ${new Date(r.submitted_at).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}`}
                  </p>
                </div>

                <div className="flex flex-shrink-0 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() => {
                      setReturnNotes("");
                      setReturning(r);
                    }}
                  >
                    <Undo2 className="mr-1.5 h-3.5 w-3.5" />
                    Return
                  </Button>
                  <Button
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => setPublishing(r)}
                  >
                    <ClipboardCheck className="mr-1.5 h-3.5 w-3.5" />
                    {busy === r.offering_id ? "Working..." : "Publish"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <AlertDialog
        open={publishing !== null}
        onOpenChange={(open) => !open && setPublishing(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publish these results to students?</AlertDialogTitle>
            <AlertDialogDescription>
              {publishing?.submitted_count} result
              {publishing?.submitted_count === 1 ? "" : "s"} for{" "}
              {publishing?.course_code} become visible to students immediately.
              Students see their grade, GPV and continuous-assessment marks —
              not the End-Semester Examination mark.
              {publishing && publishing.draft_count > 0 &&
                ` ${publishing.draft_count} row${publishing.draft_count === 1 ? "" : "s"} still in draft will also be published if graded.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmPublish}>
              Publish
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={returning !== null}
        onOpenChange={(open) => !open && setReturning(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Return {returning?.course_code} to the lecturer?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The sheet goes back to draft and becomes editable by its assigned
              lecturers again. Your note is shown to them on the entry screen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            value={returnNotes}
            onChange={(e) => setReturnNotes(e.target.value)}
            rows={3}
            placeholder="What needs correcting? e.g. CA marks for three students look transposed."
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmReturn}>
              Return to lecturer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
