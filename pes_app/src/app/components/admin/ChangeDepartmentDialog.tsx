import { useEffect, useState } from "react";
import { ArrowRight, History, Info, Loader2, Split } from "lucide-react";
import { Button } from "../ui/button";
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
import { DepartmentSelect, ErrorState, SkeletonRows, StatusBadge } from "../common";
import { STUDENT_DEPARTMENTS } from "../../../lib/accounts";
import {
  changeStudentDepartment,
  getStudentDepartmentPreview,
  type StudentDepartmentPreview,
} from "../../../lib/registryService";

const NO_DEPARTMENT = "No department yet";

/**
 * Moving a student to another department (Super Admin only).
 *
 * What the student has already done stays where it was earned: results,
 * attendance and enrolments are not touched. From now on they belong to the
 * new department -- its admin and head look after them, and they choose from
 * its courses and minors. A mentor from the old department stops being their
 * mentor (the record of it is kept). The change, its reason and who made it
 * are kept with the student's record.
 */
export function ChangeDepartmentDialog({
  student,
  onOpenChange,
  onChanged,
}: {
  student: { id: string; name: string } | null;
  onOpenChange: (open: boolean) => void;
  onChanged: (message: string) => void;
}) {
  const [preview, setPreview] = useState<StudentDepartmentPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [department, setDepartment] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!student) return;
    setPreview(null);
    setLoadError(null);
    setDepartment("");
    setReason("");
    setError(null);
    let live = true;
    getStudentDepartmentPreview(student.id).then((result) => {
      if (!live) return;
      if (result.ok) setPreview(result.data);
      else setLoadError(result.error);
    });
    return () => {
      live = false;
    };
  }, [student]);

  const choices = STUDENT_DEPARTMENTS.filter((d) => d !== preview?.department);
  const canSubmit = preview !== null && department !== "" && reason.trim() !== "" && !saving;

  const submit = async () => {
    if (!student || !canSubmit) return;
    setSaving(true);
    setError(null);
    const result = await changeStudentDepartment(student.id, department, reason.trim());
    setSaving(false);
    if (!result.ok) return setError(result.error);
    if (!result.data.ok) return setError(result.data.message);
    onOpenChange(false);
    onChanged(result.data.message);
  };

  const mentorLeaves =
    preview?.mentor_name && department !== "" && preview.mentor_department !== department;
  const minorLapses = preview?.minor && department !== "" && preview.minor_department !== department;

  return (
    <Dialog open={student !== null} onOpenChange={(v) => !saving && onOpenChange(v)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto [&>*]:min-w-0 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Split className="h-5 w-5 text-primary" aria-hidden="true" />
            Change department
          </DialogTitle>
          <DialogDescription>
            Results, attendance and enrolments {student?.name ?? "the student"} already has stay exactly as they are,
            under the courses they belong to. From now on the new department looks after them.
          </DialogDescription>
        </DialogHeader>

        {loadError ? (
          <ErrorState message={loadError} size="inline" />
        ) : !preview ? (
          <SkeletonRows count={3} height="h-10" />
        ) : (
          <div className="space-y-4 py-1">
            <div className="flex flex-wrap items-center gap-3 rounded-control border border-border bg-muted/30 p-3">
              <StatusBadge tone="neutral">{preview.department ?? NO_DEPARTMENT}</StatusBadge>
              <ArrowRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-[12rem] flex-1">
                <DepartmentSelect
                  value={department}
                  onChange={setDepartment}
                  departments={choices}
                  ariaLabel="New department"
                />
              </div>
            </div>

            {(mentorLeaves || minorLapses) && (
              <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2.5 text-sm text-foreground">
                <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
                <ul className="space-y-1">
                  {mentorLeaves && (
                    <li>
                      Their mentor, {preview.mentor_name} ({preview.mentor_department}), stops being their mentor; the
                      record of it and their messages are kept. The Head of {department} can assign a new one.
                    </li>
                  )}
                  {minorLapses && (
                    <li>
                      Their minor, {preview.minor}, is one of {preview.minor_department}'s. They choose again from{" "}
                      {department}'s minors.
                    </li>
                  )}
                </ul>
              </div>
            )}

            <div>
              <Label htmlFor="change-dept-reason" className="mb-1.5 block">
                Reason <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="change-dept-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={300}
                rows={2}
                placeholder="e.g. Transfer approved by the Faculty Board, FB/2026/121"
              />
            </div>

            {error && <ErrorState message={error} size="inline" />}

            <div className="rounded-control border border-border p-3">
              <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-foreground">
                <History className="h-3.5 w-3.5" aria-hidden="true" />
                Previous changes
              </p>
              {preview.history.length === 0 ? (
                <p className="text-xs text-muted-foreground">No department changes recorded for this student.</p>
              ) : (
                <ul className="space-y-1.5">
                  {preview.history.map((h) => (
                    <li key={h.changed_at} className="text-xs text-muted-foreground">
                      <span className="text-foreground">
                        {h.from_department ?? NO_DEPARTMENT} → {h.to_department ?? NO_DEPARTMENT}
                      </span>{" "}
                      · {new Date(h.changed_at).toLocaleDateString()} · {h.changed_by_name}
                      {h.reason && <div className="italic">{h.reason}</div>}
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
          <Button onClick={submit} disabled={!canSubmit}>
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
            {saving ? "Moving…" : "Change department"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
