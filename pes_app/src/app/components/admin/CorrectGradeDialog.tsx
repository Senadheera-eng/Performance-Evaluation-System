import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { ErrorState } from "../common";
import { supabase } from "../../../lib/supabase";
import { useSettings } from "../../../lib/settings";

/**
 * Putting a grade right when it was recorded in error.
 *
 * This is deliberately not the same control as entering marks. The cap on a
 * repeat re-sit is enforced on the row, so simply editing an R back to the
 * student's real grade clamps it to C — correct for a re-sit, wrong for a
 * typo. A correction says "this was never a repeat", which is a claim the
 * department makes on the record, with a reason attached.
 */
export function CorrectGradeDialog({
  open,
  onOpenChange,
  result,
  onCorrected,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: { id: string; studentName: string; currentGrade: string | null } | null;
  onCorrected: () => void;
}) {
  const settings = useSettings();
  const [grade, setGrade] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setGrade(result?.currentGrade ?? "");
    setReason("");
    setError(null);
  }, [open, result]);

  const grades = Object.keys(settings.gpvScale ?? {});

  const save = async () => {
    if (!result) return;
    if (!grade) return setError("Choose the grade that should be recorded.");
    if (!reason.trim()) {
      return setError("Say why it is being corrected — it goes on the record.");
    }

    setSaving(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc("correct_result_grade", {
      p_result_id: result.id,
      p_grade: grade,
      p_reason: reason.trim(),
    });
    setSaving(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    onOpenChange(false);
    onCorrected();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Correct a grade</DialogTitle>
          <DialogDescription>
            For a grade recorded in error — an R entered by mistake, say. A
            genuine repeat re-sit is capped at C and should be entered as marks
            instead.
          </DialogDescription>
        </DialogHeader>

        {error && <ErrorState message={error} size="inline" />}

        {result && (
          <p className="text-sm text-muted-foreground">
            {result.studentName} — currently{" "}
            <strong className="text-foreground">
              {result.currentGrade ?? "no grade"}
            </strong>
          </p>
        )}

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">
            Grade to record
          </label>
          <div className="flex flex-wrap gap-1.5">
            {grades.map((g) => (
              <Button
                key={g}
                type="button"
                size="sm"
                variant={grade === g ? "default" : "outline"}
                onClick={() => setGrade(g)}
              >
                {g}
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">Reason</label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="e.g. R entered in error during the results import"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Record correction"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
