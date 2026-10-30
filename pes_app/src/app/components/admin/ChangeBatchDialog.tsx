import { useEffect, useState } from "react";
import { ArrowRight, History } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { ErrorState, SkeletonRows, StatusBadge } from "../common";
import { describeBatch } from "../../../lib/batch";
import {
  changeStudentBatch,
  getStudentBatchHistory,
  type BatchChange,
} from "../../../lib/registryService";

/**
 * Moving a student to another intake.
 *
 * Usually because a year GPA below 2.00 means repeating an academic year;
 * sometimes at the student's own request. Either way it needs a reason and,
 * where one exists, the Faculty Board reference that authorised it — the
 * database records both alongside who made the change.
 */
export function ChangeBatchDialog({
  open,
  onOpenChange,
  student,
  batches,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  student: { id: string; name: string; batchYear: number } | null;
  /** Intakes already present in the system, offered as the common choices. */
  batches: number[];
  onChanged: (message: string) => void;
}) {
  const [toBatch, setToBatch] = useState<string>("");
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [history, setHistory] = useState<BatchChange[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    if (!open || !student) return;
    setToBatch("");
    setReason("");
    setReference("");
    setError(null);
    loadHistory(student.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, student?.id]);

  const loadHistory = async (studentId: string) => {
    setHistoryLoading(true);
    const result = await getStudentBatchHistory(studentId);
    setHistory(result.ok ? result.data : []);
    setHistoryLoading(false);
  };

  const handleSubmit = async () => {
    if (!student) return;
    const target = Number(toBatch);
    if (!Number.isFinite(target) || toBatch === "") {
      setError("Choose the intake the student is moving to.");
      return;
    }
    if (target === student.batchYear) {
      setError("That is the student's current intake.");
      return;
    }
    if (!reason.trim()) {
      setError("A reason is required — this change is part of the student's record.");
      return;
    }

    setSaving(true);
    setError(null);
    const result = await changeStudentBatch(
      student.id,
      target,
      reason.trim(),
      reference.trim() || null,
    );
    setSaving(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (!result.data.ok) {
      setError(result.data.message);
      return;
    }
    onOpenChange(false);
    onChanged(result.data.message);
  };

  // Existing intakes, plus the neighbouring years, since repeating a year
  // most often means moving to the next intake — which may not exist in the
  // system yet.
  const options = [
    ...new Set([
      ...batches,
      ...(student ? [student.batchYear - 1, student.batchYear + 1] : []),
    ]),
  ]
    .filter((b) => b >= 2015 && b !== student?.batchYear)
    .sort((a, b) => b - a);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Change intake</DialogTitle>
          <DialogDescription>
            {student?.name} is currently in{" "}
            {student ? describeBatch(student.batchYear) : "—"}. Results already
            earned stay under that cohort — the student sat those examinations
            with it — so they will appear as a repeat candidate on those
            courses afterwards.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* From the intake they are in to the one they move to. */}
          <div className="flex flex-wrap items-center gap-3 rounded-control border border-border bg-muted/30 p-3">
            <StatusBadge tone="neutral">
              {student ? describeBatch(student.batchYear) : "—"}
            </StatusBadge>
            <ArrowRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
            <Select value={toBatch || undefined} onValueChange={setToBatch}>
              <SelectTrigger
                aria-label="New intake"
                className="h-9 min-w-[12rem] flex-1 rounded-control border-border bg-card"
              >
                <SelectValue placeholder="Select the new intake…" />
              </SelectTrigger>
              <SelectContent>
                {options.map((b) => (
                  <SelectItem key={b} value={String(b)}>
                    {describeBatch(b)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="change-batch-reason" className="mb-1.5 block">
              Reason <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="change-batch-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="e.g. Year 3 GPA below 2.00 — repeating the academic year"
            />
          </div>

          <div>
            <Label htmlFor="change-batch-reference" className="mb-1.5 block">
              Approval reference <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="change-batch-reference"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="e.g. FB/2026/114"
            />
          </div>

          {error && <ErrorState message={error} size="inline" />}

          <div className="rounded-control border border-border p-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-foreground">
              <History className="h-3.5 w-3.5" aria-hidden="true" />
              Previous changes
            </p>
            {historyLoading ? (
              <SkeletonRows count={1} height="h-6" />
            ) : history.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No intake changes recorded for this student.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {history.map((h) => (
                  <li key={h.id} className="text-xs text-muted-foreground">
                    <span className="text-foreground">
                      {h.from_batch_year} → {h.to_batch_year}
                    </span>{" "}
                    · {new Date(h.changed_at).toLocaleDateString()} · {h.changed_by_name}
                    {h.reference && ` · ${h.reference}`}
                    {h.reason && <div className="italic">{h.reason}</div>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Moving..." : "Change intake"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
