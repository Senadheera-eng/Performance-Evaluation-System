import { useEffect, useState } from "react";
import { CheckCircle2, Copy, Loader2, Mail, UserPlus } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { DepartmentSelect, SegmentedTabs } from "../common";
import { accountCall, type InviteResult, type UserKind } from "../../../lib/accounts";
import { describeBatch } from "../../../lib/batch";

const STUDENT_DEPARTMENTS = [
  "Civil Engineering",
  "Computer Engineering",
  "Electrical and Electronic Engineering",
  "Mechanical Engineering",
];
const STAFF_DEPARTMENTS = [...STUDENT_DEPARTMENTS, "Interdisciplinary Studies"];

type NewKind = Exclude<UserKind, "super_admin">;

/**
 * Adding one person to PES. They get an email with a link to choose their
 * own password -- nobody else ever knows it. If email is not set up yet, the
 * link is shown here instead, for the Super Admin to pass on.
 */
export function AddUserDialog({
  open,
  onOpenChange,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
}) {
  const [kind, setKind] = useState<NewKind>("student");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [department, setDepartment] = useState("");
  const [reg, setReg] = useState("");
  const [index, setIndex] = useState("");
  const [batchYear, setBatchYear] = useState(String(new Date().getFullYear() - 1));
  const [title, setTitle] = useState("");
  const [staffNo, setStaffNo] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InviteResult | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName("");
    setEmail("");
    setDepartment("");
    setReg("");
    setIndex("");
    setTitle("");
    setStaffNo("");
    setError(null);
    setResult(null);
    setCopied(false);
  }, [open]);

  const defaultEmail = kind === "student" && reg.trim() ? `en${reg.trim().toLowerCase()}@foe.sjp.ac.lk` : "";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const { data, error: e2 } = await accountCall<InviteResult>({
      action: "invite",
      kind,
      name,
      email: email.trim() || defaultEmail,
      department: department || null,
      ...(kind === "student"
        ? { reg_number: reg, index_number: index, batch_year: Number(batchYear) }
        : kind === "lecturer"
          ? { title, staff_no: staffNo }
          : {}),
    });
    setSaving(false);
    if (e2 || !data) return setError(e2 ?? "The invitation could not be sent.");
    setResult(data);
    onAdded();
  };

  const copy = async () => {
    if (!result?.invite_link) return;
    await navigator.clipboard.writeText(result.invite_link).catch(() => undefined);
    setCopied(true);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !saving && onOpenChange(v)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto [&>*]:min-w-0 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-primary" aria-hidden="true" />
            Add user
          </DialogTitle>
          <DialogDescription>
            They receive an email with a link to choose their own password. The link works once and expires in 72 hours.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-4 py-1">
            <div className="flex items-start gap-3 rounded-xl border border-success-border bg-success-bg px-3 py-3 text-sm text-success-fg">
              <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0" aria-hidden="true" />
              <div>
                <p className="font-semibold">{name} has been added.</p>
                <p className="text-xs">
                  {result.emailed
                    ? `An invitation was emailed to ${result.email}.`
                    : `The account is ready, but the invitation email was not sent: ${result.email_error ?? "email is not set up"}`}
                </p>
              </div>
            </div>
            {!result.emailed && result.invite_link && (
              <div className="space-y-2 rounded-xl border border-warning-border bg-warning-bg px-3 py-3 text-sm text-warning-fg">
                <p className="font-semibold">Send them this link yourself</p>
                <p className="text-xs">
                  It lets whoever opens it set this account's password, so send it only to {result.email}. It works once and
                  expires in {result.expires_in_hours} hours.
                </p>
                <div className="flex gap-2">
                  <Input readOnly value={result.invite_link} className="h-8 flex-1 bg-card font-mono text-xs" onFocus={(e) => e.target.select()} />
                  <Button size="sm" variant="outline" onClick={copy}>
                    <Copy className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <form id="add-user" onSubmit={submit} className="space-y-4 py-1">
            <SegmentedTabs
              aria-label="Kind of user"
              layoutId="add-user-kind"
              value={kind}
              onChange={(v) => {
                setKind(v as NewKind);
                setDepartment("");
              }}
              tabs={[
                { value: "student", label: "Student" },
                { value: "lecturer", label: "Lecturer" },
                { value: "dept_admin", label: "Dept. Admin" },
              ]}
              equal
            />

            <div className="grid gap-3 sm:grid-cols-[6rem_1fr]">
              {kind === "lecturer" && (
                <div>
                  <Label htmlFor="u-title">Title</Label>
                  <Input id="u-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Dr." className="mt-1" />
                </div>
              )}
              <div className={kind === "lecturer" ? "" : "sm:col-span-2"}>
                <Label htmlFor="u-name">Full name</Label>
                <Input id="u-name" value={name} onChange={(e) => setName(e.target.value)} required className="mt-1" />
              </div>
            </div>

            {kind === "student" && (
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <Label htmlFor="u-reg">Registration No</Label>
                  <Input id="u-reg" value={reg} onChange={(e) => setReg(e.target.value)} required className="mt-1" />
                </div>
                <div>
                  <Label htmlFor="u-index">Index No</Label>
                  <Input id="u-index" value={index} onChange={(e) => setIndex(e.target.value)} placeholder="25/ENG/001" className="mt-1" />
                </div>
                <div>
                  <Label htmlFor="u-year">Intake year</Label>
                  <Input
                    id="u-year"
                    type="number"
                    value={batchYear}
                    onChange={(e) => setBatchYear(e.target.value)}
                    required
                    className="mt-1 tabular-nums"
                  />
                </div>
                <p className="-mt-1 text-xs text-muted-foreground sm:col-span-3">
                  {Number(batchYear) ? describeBatch(Number(batchYear)) : "Enter the intake year."}
                </p>
              </div>
            )}

            {kind === "lecturer" && (
              <div>
                <Label htmlFor="u-staff">Staff number (optional)</Label>
                <Input id="u-staff" value={staffNo} onChange={(e) => setStaffNo(e.target.value)} className="mt-1" />
              </div>
            )}

            <div>
              <Label htmlFor="u-email">Email {kind === "student" ? "(optional)" : ""}</Label>
              <div className="relative mt-1">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  id="u-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={defaultEmail || "name@sjp.ac.lk"}
                  required={kind !== "student"}
                  className="pl-9"
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                The invitation goes here, and it is the address they sign in with.
                {kind === "student" && " Left blank, it is the faculty address from the registration number."}
              </p>
            </div>

            <div>
              <Label>
                {kind === "dept_admin" ? "Department they look after" : "Department"}
                {kind === "student" ? " (optional — a first-year has none yet)" : ""}
              </Label>
              <DepartmentSelect
                value={department}
                onChange={setDepartment}
                departments={kind === "student" ? STUDENT_DEPARTMENTS : STAFF_DEPARTMENTS}
                {...(kind === "student" ? { allLabel: "No department yet", allValue: "" } : {})}
                className="mt-1"
              />
            </div>

            {error && (
              <p role="alert" className="text-sm text-danger-fg">
                {error}
              </p>
            )}
          </form>
        )}

        <DialogFooter>
          {result ? (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" form="add-user" disabled={saving}>
                {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Mail className="mr-1.5 h-4 w-4" aria-hidden="true" />}
                {saving ? "Sending…" : "Send invitation"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
