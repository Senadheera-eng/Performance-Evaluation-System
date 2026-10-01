import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Loader2, Trash2 } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { SkeletonRows } from "../common";
import { supabase } from "../../../lib/supabase";
import { describeBatch, getBatchNumber } from "../../../lib/batch";
import { buildBatchArchive, fileSafe, saveBlob, type BatchRecords } from "../../../lib/batchIntake";
import {
  describeStage,
  removeBatch,
  type BatchFootprint,
  type RemovalResult,
} from "../../../lib/batches";

const n = (x: number) => x.toLocaleString("en-GB");

/**
 * Removing a batch that has left: its students, and everything PES holds
 * about them -- results, attendance, enrolments, medical submissions and
 * their files, mentoring, sign-in accounts. It cannot be undone, so the
 * dialog counts what would go, offers to keep the records as a workbook
 * first, and asks for the batch's name to be typed before it will act.
 *
 * Course feedback is the one thing that is not only theirs: it is part of
 * every course's feedback report. By default it stays, with the student's
 * name taken off it.
 */
export function RemoveBatchDialog({
  batchYear,
  onOpenChange,
  onRemoved,
}: {
  /** The batch to remove; null when closed. */
  batchYear: number | null;
  onOpenChange: (open: boolean) => void;
  onRemoved: () => void;
}) {
  const open = batchYear !== null;
  const [footprint, setFootprint] = useState<BatchFootprint | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [keepFeedback, setKeepFeedback] = useState(true);
  const [typed, setTyped] = useState("");
  const [archiving, setArchiving] = useState(false);
  const [archived, setArchived] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RemovalResult | null>(null);

  useEffect(() => {
    if (batchYear === null) return;
    setFootprint(null);
    setLoadError(null);
    setKeepFeedback(true);
    setTyped("");
    setArchived(false);
    setError(null);
    setResult(null);
    supabase.rpc("get_batch_footprint", { p_batch_year: batchYear }).then(({ data, error: e }) => {
      if (e) setLoadError(e.message);
      else setFootprint(data as BatchFootprint);
    });
  }, [batchYear]);

  if (batchYear === null) return null;

  const label = describeBatch(batchYear);
  const phrase = `Batch ${getBatchNumber(batchYear)}`;
  const confirmed = typed.trim().toLowerCase() === phrase.toLowerCase();
  const unfinished = footprint !== null && footprint.semester <= 8;

  const archive = async () => {
    setArchiving(true);
    setError(null);
    const { data, error: e } = await supabase.rpc("export_batch_records", { p_batch_year: batchYear });
    if (e || !data) {
      setArchiving(false);
      setError(e?.message ?? "The records could not be read.");
      return;
    }
    const blob = await buildBatchArchive(data as BatchRecords);
    saveBlob(blob, `PES-records-${fileSafe(label)}.xlsx`);
    setArchiving(false);
    setArchived(true);
  };

  const remove = async () => {
    setRemoving(true);
    setError(null);
    const { data, error: e } = await removeBatch(batchYear, keepFeedback);
    setRemoving(false);
    if (e || !data) {
      setError(e ?? "The batch could not be removed.");
      onRemoved(); // Part of it may have gone; show what is left.
      return;
    }
    setResult(data);
    onRemoved();
  };

  const rows: [string, number][] = footprint
    ? [
        ["Students and their sign-in accounts", footprint.students],
        ["Results", footprint.results],
        ["Attendance marks", footprint.attendance],
        ["Course enrolments", footprint.enrollments],
        ["Medical submissions, with their files", footprint.medical_submissions],
        ["Mentoring messages", footprint.mentor_messages],
        ["Notifications", footprint.notifications],
      ]
    : [];

  return (
    <Dialog open={open} onOpenChange={(next) => !removing && onOpenChange(next)}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto [&>*]:min-w-0 sm:max-w-lg"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-danger-fg">
            <Trash2 className="h-5 w-5" aria-hidden="true" />
            Remove {label}
          </DialogTitle>
          <DialogDescription>
            {result
              ? "The batch has been removed."
              : "Every student in the batch, and everything PES holds about them. This cannot be undone."}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3 py-1">
            <div className="flex items-start gap-3 rounded-xl border border-success-border bg-success-bg px-3 py-3 text-sm text-success-fg">
              <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0" aria-hidden="true" />
              <div className="space-y-0.5">
                <p className="font-semibold">
                  {n(result.removed.students)} students removed, with {n(result.removed.results)} results and{" "}
                  {n(result.removed.attendance)} attendance marks.
                </p>
                <p className="text-xs">
                  {n(result.removed.accounts)} sign-in accounts and {n(result.removed.files)} stored files deleted.{" "}
                  {result.feedback_kept_anonymously
                    ? `${n(result.removed.feedback_submissions)} course feedback answers kept, without names.`
                    : `${n(result.removed.feedback_deleted)} course feedback answers deleted.`}
                </p>
              </div>
            </div>
            {result.failures.length > 0 && (
              <div className="rounded-xl border border-warning-border bg-warning-bg px-3 py-2.5 text-sm text-warning-fg">
                <p className="font-semibold">Some things could not be removed</p>
                <p className="text-xs">
                  The students' records are gone; these leftovers can be removed from the Supabase dashboard.
                </p>
                <ul className="mt-1 max-h-32 list-disc overflow-auto pl-5 text-xs">
                  {result.failures.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : loadError ? (
          <p className="text-sm text-danger-fg">{loadError}</p>
        ) : !footprint ? (
          <SkeletonRows count={3} height="h-10" />
        ) : (
          <div className="space-y-4 py-1">
            {unfinished && (
              <p className="flex items-start gap-2 rounded-xl border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger-fg">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
                This batch is in {describeStage(footprint.semester)} — it has not finished its degree. Remove it
                only if it was added by mistake or has really left.
              </p>
            )}

            <div className="rounded-xl border border-border">
              <p className="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
                What will be deleted
              </p>
              <dl className="divide-y divide-border/70 text-sm">
                {rows.map(([what, count]) => (
                  <div key={what} className="flex items-center justify-between px-3 py-1.5">
                    <dt className="text-foreground">{what}</dt>
                    <dd className="font-semibold tabular-nums text-foreground">{n(count)}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5">
              <div className="min-w-0 text-sm">
                <p className="font-medium text-foreground">Keep a copy first</p>
                <p className="text-xs text-muted-foreground">
                  The students, every result, enrolment and attendance mark, as an Excel workbook.
                </p>
              </div>
              <Button size="sm" variant={archived ? "outline" : "default"} onClick={archive} disabled={archiving}>
                {archiving ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
                ) : archived ? (
                  <CheckCircle2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
                ) : (
                  <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />
                )}
                {archived ? "Downloaded" : "Download records"}
              </Button>
            </div>

            {footprint.feedback_submissions > 0 && (
              <label className="flex items-start gap-2.5 text-sm">
                <Checkbox
                  checked={keepFeedback}
                  onCheckedChange={(v) => setKeepFeedback(v === true)}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium text-foreground">
                    Keep their {n(footprint.feedback_submissions)} course feedback answers, without names
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    They stay in the courses' feedback reports that lecturers and departments read. Untick to
                    delete them too.
                  </span>
                </span>
              </label>
            )}

            <div>
              <Label htmlFor="confirm-batch">
                Type <span className="font-semibold">{phrase}</span> to confirm
              </Label>
              <Input
                id="confirm-batch"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                className="mt-1"
                placeholder={phrase}
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-danger-fg">
                {error}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {result ? (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={removing}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={remove} disabled={!footprint || !confirmed || removing}>
                {removing ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Trash2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
                )}
                {removing ? "Removing…" : `Remove ${footprint ? n(footprint.students) : ""} students`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
