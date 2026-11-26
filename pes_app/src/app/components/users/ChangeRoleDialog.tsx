import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, Info, Loader2, UserCog } from "lucide-react";
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
import { DepartmentSelect, ErrorState, SegmentedTabs, SkeletonRows, StatusBadge } from "../common";
import {
  changeStaffRole,
  getStaffRolePreview,
  KIND_LABEL,
  roleChangeBlocker,
  STAFF_DEPARTMENTS,
  STAFF_ROLES,
  type StaffRole,
  type StaffRolePreview,
} from "../../../lib/accounts";

const ROLE_TAB_LABEL: Record<StaffRole, string> = {
  lecturer: "Lecturer",
  dept_admin: "Dept. Admin",
  super_admin: "Super Admin",
};

/**
 * Changing what a member of staff can do in PES: Lecturer, Department Admin
 * or Super Admin.
 *
 * Nothing is deleted. A lecturer who becomes an admin keeps their lecturer
 * record -- the courses they taught, the results they entered, the feedback
 * about them -- it just no longer signs them in; if they become a lecturer
 * again, the same record comes back. The database checks every rule shown
 * here again, and records who made the change and why.
 */
export function ChangeRoleDialog({
  user,
  onOpenChange,
  onChanged,
}: {
  user: { id: string; name: string } | null;
  onOpenChange: (open: boolean) => void;
  onChanged: (message: string) => void;
}) {
  const [preview, setPreview] = useState<StaffRolePreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [role, setRole] = useState<StaffRole>("lecturer");
  const [department, setDepartment] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    setPreview(null);
    setLoadError(null);
    setReason("");
    setError(null);
    let live = true;
    getStaffRolePreview(user.id).then((result) => {
      if (!live) return;
      if (!result.ok) return setLoadError(result.error);
      const p = result.data;
      setPreview(p);
      // Start on a role they do not hold, in the department they are in.
      setRole(STAFF_ROLES.find((r) => r !== p.role) ?? "lecturer");
      setDepartment(p.department && (STAFF_DEPARTMENTS as readonly string[]).includes(p.department) ? p.department : "");
    });
    return () => {
      live = false;
    };
  }, [user]);

  const needsDepartment = role !== "super_admin";
  const sameRole = preview !== null && role === preview.role;
  // Moving a department admin to another department is a change too; the
  // same role in the same place is not.
  const nothingToChange =
    preview !== null && sameRole && (role !== "dept_admin" || department === (preview.department ?? ""));
  const blocker = preview ? roleChangeBlocker(preview, role) : null;
  const canSubmit =
    preview !== null && !blocker && !nothingToChange && (!needsDepartment || department !== "") && !saving;

  const submit = async () => {
    if (!user || !canSubmit) return;
    setSaving(true);
    setError(null);
    const result = await changeStaffRole(user.id, role, needsDepartment ? department : null, reason.trim() || null);
    setSaving(false);
    if (!result.ok) return setError(result.error);
    onOpenChange(false);
    onChanged(result.data.message);
  };

  const current = preview
    ? `${KIND_LABEL[preview.role]}${preview.role !== "super_admin" && preview.department ? ` · ${preview.department}` : ""}`
    : "";

  return (
    <Dialog open={user !== null} onOpenChange={(v) => !saving && onOpenChange(v)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto [&>*]:min-w-0 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCog className="h-5 w-5 text-primary" aria-hidden="true" />
            Change role
          </DialogTitle>
          <DialogDescription>
            What {user?.name ?? "this person"} can do in PES. Nothing they have done is lost: their courses, results,
            reviews and messages stay as they are.
          </DialogDescription>
        </DialogHeader>

        {loadError ? (
          <ErrorState message={loadError} size="inline" />
        ) : !preview ? (
          <SkeletonRows count={3} height="h-10" />
        ) : (
          <div className="space-y-4 py-1">
            {/* From the role they hold to the one they move to. */}
            <div className="flex flex-wrap items-center gap-2 rounded-control border border-border bg-muted/30 p-3 text-sm">
              <StatusBadge tone="neutral">{current}</StatusBadge>
              <ArrowRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="font-medium text-foreground">
                {nothingToChange ? "Choose a new role" : `${KIND_LABEL[role]}${needsDepartment && department ? ` · ${department}` : ""}`}
              </span>
            </div>

            <div>
              <Label className="mb-1.5 block">New role</Label>
              <SegmentedTabs
                aria-label="New role"
                layoutId="change-role"
                value={role}
                onChange={(v) => setRole(v as StaffRole)}
                tabs={STAFF_ROLES.map((r) => ({ value: r, label: ROLE_TAB_LABEL[r] }))}
                equal
              />
            </div>

            {needsDepartment && (
              <div>
                <Label className="mb-1.5 block">{role === "dept_admin" ? "Department they look after" : "Department"}</Label>
                <DepartmentSelect value={department} onChange={setDepartment} departments={STAFF_DEPARTMENTS} />
              </div>
            )}

            {blocker ? (
              <div role="alert" className="flex items-start gap-2 rounded-xl border border-warning-border bg-warning-bg px-3 py-2.5 text-sm text-warning-fg">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
                <p>{blocker}</p>
              </div>
            ) : (
              !nothingToChange && <WhatHappens preview={preview} to={role} />
            )}

            <div>
              <Label htmlFor="change-role-reason" className="mb-1.5 block">
                Reason <span className="font-normal text-muted-foreground">(optional, kept with the change)</span>
              </Label>
              <Textarea
                id="change-role-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={300}
                rows={2}
                placeholder="e.g. Appointed department admin from 1 December"
              />
            </div>

            {error && <ErrorState message={error} size="inline" />}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {saving ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <UserCog className="mr-1.5 h-4 w-4" aria-hidden="true" />
            )}
            {saving ? "Changing…" : "Change role"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** What the change does, in the Super Admin's terms, before they make it. */
function WhatHappens({ preview, to }: { preview: StaffRolePreview; to: StaffRole }) {
  const points: string[] = [];
  if (preview.role === "lecturer" && to !== "lecturer") {
    points.push(
      "Their lecturer record stays, with the courses they taught, the results they entered and the feedback about them. It no longer signs them in.",
    );
    if (preview.current_courses > 0) {
      points.push(
        `They are assigned to ${preview.current_courses} course${preview.current_courses === 1 ? "" : "s"} now. They stay listed there but can no longer take attendance or enter results, so ask the Head of ${preview.department ?? "their department"} to assign another lecturer.`,
      );
    }
  }
  if (preview.role !== "lecturer" && to === "lecturer") {
    points.push(
      "Their admin record stays, so the medicals they reviewed and the windows they opened still say who did it. If they were a lecturer before, their old lecturer record comes back.",
    );
    points.push("The Head of Department can then give them courses and mentees.");
  }
  if (to === "super_admin" && preview.role !== "super_admin") {
    points.push("A Super Admin manages the whole faculty, including users, roles and batches.");
  }
  if (to === "dept_admin" && preview.role !== "dept_admin") {
    points.push("A Department Admin looks after one department's students, courses, results and medicals.");
  }
  if (to !== preview.role) {
    points.push("PES signs them out within a few minutes, and they see their new pages when they sign in again.");
  }
  if (points.length === 0) return null;
  return (
    <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2.5 text-sm text-foreground">
      <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
      <ul className="space-y-1">
        {points.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </div>
  );
}
