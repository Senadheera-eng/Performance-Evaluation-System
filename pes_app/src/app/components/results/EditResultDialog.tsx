import { useEffect, useState } from "react";
import { History, Info, Loader2, Pencil } from "lucide-react";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { ErrorState, SkeletonRows } from "../common";
import { useSettings } from "../../../lib/settings";
import { MARK_MAX } from "../../../lib/resultsWorkbook";
import {
  changePublishedResult,
  describeChange,
  getResultChanges,
  parseMark,
  resitCapApplies,
  type ResultChange,
} from "../../../lib/resultChanges";

/* The faculty's cap on a re-sit (system_settings.resit_max_grade). The
   database applies it; this is only for saying so. */
const RESIT_MAX_GRADE = "C";

export interface EditableResult {
  id: string;
  studentName: string;
  /** "IS1302 Engineering Mathematics II" */
  courseLabel: string;
  midSem: number | null;
  ca: number | null;
  grade: string | null;
  /** The R or F a re-sit grade replaced, if any. */
  originalGrade: string | null;
}

/**
 * Changing a published result: its two marks and its grade.
 *
 * Who may do this is the database's decision (the Super Admin for any
 * course; a Department Admin or Head of Department for their department's
 * courses). Every change needs a reason, is kept with the result, and the
 * student is told. This replaces the grade-only correction: correcting an R
 * entered by mistake is the "recorded in error" box here.
 */
export function EditResultDialog({
  result,
  onOpenChange,
  onSaved,
}: {
  result: EditableResult | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (message: string) => void;
}) {
  const settings = useSettings();
  const grades = Object.keys(settings.gpvScale ?? {});
  const [midSem, setMidSem] = useState("");
  const [ca, setCa] = useState("");
  const [grade, setGrade] = useState("");
  const [inError, setInError] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<ResultChange[] | null>(null);

  useEffect(() => {
    if (!result) return;
    setMidSem(result.midSem?.toString() ?? "");
    setCa(result.ca?.toString() ?? "");
    setGrade(result.grade ?? "");
    setInError(false);
    setReason("");
    setError(null);
    setHistory(null);
    let live = true;
    getResultChanges(result.id).then((r) => {
      if (live) setHistory(r.ok ? r.data : []);
    });
    return () => {
      live = false;
    };
  }, [result]);

  const mid = parseMark(midSem, "midSem");
  const caMark = parseMark(ca, "ca");
  const capMatters = result ? resitCapApplies(result.grade, result.originalGrade) : false;
  const unchanged =
    result !== null &&
    mid.value === result.midSem &&
    caMark.value === result.ca &&
    grade === (result.grade ?? "") &&
    !inError;
  const canSave = result !== null && !mid.error && !caMark.error && grade !== "" && reason.trim() !== "" && !unchanged && !saving;

  const save = async () => {
    if (!result || !canSave) return;
    setSaving(true);
    setError(null);
    const r = await changePublishedResult(result.id, mid.value, caMark.value, grade, reason.trim(), inError);
    setSaving(false);
    if (!r.ok) return setError(r.error);
    if (!r.data.changed) return setError(r.data.message);
    onOpenChange(false);
    onSaved(r.data.message);
  };

  return (
    <Dialog open={result !== null} onOpenChange={(v) => !saving && onOpenChange(v)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto [&>*]:min-w-0 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-5 w-5 text-primary" aria-hidden="true" />
            Change result
          </DialogTitle>
          <DialogDescription>
            {result?.studentName} · {result?.courseLabel}. This result is published, so the change and its reason are kept
            with it, and the student is told.
          </DialogDescription>
        </DialogHeader>

        {result && (
          <div className="space-y-4 py-1">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="edit-mid" className="mb-1.5 block">
                  Mid Sem (/{MARK_MAX.midSem})
                </Label>
                <Input
                  id="edit-mid"
                  inputMode="decimal"
                  value={midSem}
                  onChange={(e) => setMidSem(e.target.value)}
                  aria-invalid={!!mid.error}
                  className="h-9 text-center tabular-nums"
                />
                {mid.error && <p className="mt-0.5 text-xs text-destructive">{mid.error}</p>}
              </div>
              <div>
                <Label htmlFor="edit-ca" className="mb-1.5 block">
                  CA (/{MARK_MAX.ca})
                </Label>
                <Input
                  id="edit-ca"
                  inputMode="decimal"
                  value={ca}
                  onChange={(e) => setCa(e.target.value)}
                  aria-invalid={!!caMark.error}
                  className="h-9 text-center tabular-nums"
                />
                {caMark.error && <p className="mt-0.5 text-xs text-destructive">{caMark.error}</p>}
              </div>
            </div>

            <div>
              <Label className="mb-1.5 block">Grade</Label>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Grade">
                {grades.map((g) => (
                  <Button
                    key={g}
                    type="button"
                    size="sm"
                    role="radio"
                    aria-checked={grade === g}
                    variant={grade === g ? "default" : "outline"}
                    onClick={() => setGrade(g)}
                    className="min-w-10"
                  >
                    {g}
                  </Button>
                ))}
              </div>
            </div>

            {capMatters && (
              <div className="space-y-2 rounded-xl border border-border bg-muted/30 px-3 py-2.5 text-sm">
                <p className="flex items-start gap-2 text-foreground">
                  <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span>
                    This result {result.grade === "R" || result.grade === "F" ? `is an ${result.grade}` : `replaced an ${result.originalGrade}`}.
                    A re-sit or repeat is capped: any grade above {RESIT_MAX_GRADE} is recorded as {RESIT_MAX_GRADE}.
                  </span>
                </p>
                <label className="flex items-start gap-2 text-sm text-foreground">
                  <Checkbox checked={inError} onCheckedChange={(v) => setInError(v === true)} className="mt-0.5" />
                  <span>
                    The {result.grade === "R" || result.grade === "F" ? result.grade : result.originalGrade} was recorded in error, so
                    the cap does not apply.
                  </span>
                </label>
              </div>
            )}

            <div>
              <Label htmlFor="edit-reason" className="mb-1.5 block">
                Reason <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="edit-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={300}
                rows={2}
                placeholder="e.g. CA mark re-checked by the examiners, board decision of 14 November"
              />
            </div>

            {error && <ErrorState message={error} size="inline" />}

            <div className="rounded-control border border-border p-3">
              <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-foreground">
                <History className="h-3.5 w-3.5" aria-hidden="true" />
                Earlier changes
              </p>
              {history === null ? (
                <SkeletonRows count={1} height="h-6" />
              ) : history.length === 0 ? (
                <p className="text-xs text-muted-foreground">No changes since it was published.</p>
              ) : (
                <ul className="space-y-1.5">
                  {history.map((h) => (
                    <li key={h.changed_at} className="text-xs text-muted-foreground">
                      <span className="text-foreground">{describeChange(h)}</span> ·{" "}
                      {new Date(h.changed_at).toLocaleDateString()} · {h.changed_by_name}
                      {h.recorded_in_error && " · recorded in error"}
                      <div className="italic">{h.reason}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!canSave}>
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
            {saving ? "Saving…" : "Save change"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
