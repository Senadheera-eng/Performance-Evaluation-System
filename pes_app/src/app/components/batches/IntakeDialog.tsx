import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  KeyRound,
  Loader2,
  Upload,
  UserPlus,
} from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Progress } from "../ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { StatusBadge } from "../common";
import { cn } from "../ui/utils";
import { supabase } from "../../../lib/supabase";
import { describeBatch, getBatchNumber } from "../../../lib/batch";
import { getSettings } from "../../../lib/settings";
import {
  buildCredentialsWorkbook,
  buildIntakeTemplate,
  fileSafe,
  parseIntakeFile,
  saveBlob,
  type CreatedStudent,
  type IntakeStudent,
} from "../../../lib/batchIntake";
import {
  addStudents,
  createdStudents,
  INTAKE_CHUNK,
  type BatchSummary,
  type IntakeResult,
} from "../../../lib/batches";

type Step = "setup" | "review" | "creating" | "done";

/** The registration numbers and emails among these already in PES. */
async function alreadyInPes(rows: IntakeStudent[]) {
  const regs = new Set<string>();
  const emails = new Set<string>();
  const regList = [...new Set(rows.map((r) => r.reg_number).filter(Boolean))];
  const emailList = [...new Set(rows.map((r) => r.email).filter(Boolean))];
  for (let i = 0; i < Math.max(regList.length, emailList.length); i += 150) {
    const [byReg, byEmail] = await Promise.all([
      regList.length > i
        ? supabase.from("students").select("reg_number").in("reg_number", regList.slice(i, i + 150))
        : Promise.resolve({ data: [] as { reg_number: string }[] }),
      emailList.length > i
        ? supabase.from("students").select("email").in("email", emailList.slice(i, i + 150))
        : Promise.resolve({ data: [] as { email: string }[] }),
    ]);
    (byReg.data ?? []).forEach((r) => regs.add(r.reg_number));
    (byEmail.data ?? []).forEach((r) => emails.add(String(r.email).toLowerCase()));
  }
  return { regs, emails };
}

/**
 * Bringing a new intake into PES, in four steps: which batch, the list,
 * checking it, and creating the accounts. Each student gets a sign-in
 * account and a temporary password they must change at first sign-in; the
 * passwords come back once, as a sheet to hand out, and are kept nowhere.
 *
 * Nothing is created until the list has been read and every row checked, so
 * a mistake in the sheet is fixed in the sheet rather than in PES.
 */
export function IntakeDialog({
  open,
  onOpenChange,
  batches,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batches: BatchSummary[];
  onAdded: () => void;
}) {
  /* Intakes start a year behind the calendar: the 2025 intake starts its
     degree in 2026. A newer intake than the newest in PES is the likelier. */
  const suggestedYear = useMemo(() => {
    const newest = Math.max(0, ...batches.map((b) => b.batch_year));
    return Math.max(newest + 1, new Date().getFullYear() - 1);
  }, [batches]);

  const [step, setStep] = useState<Step>("setup");
  const [year, setYear] = useState(String(suggestedYear));
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<IntakeStudent[]>([]);
  const [fatal, setFatal] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<IntakeResult[]>([]);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Each opening starts again from the first step.
  useEffect(() => {
    if (!open) return;
    setStep("setup");
    setYear(String(suggestedYear));
    setFile(null);
    setRows([]);
    setFatal(null);
    setResults([]);
    setRequestError(null);
    setSaved(false);
  }, [open, suggestedYear]);

  const batchYear = Number(year);
  const firstYear = getSettings().firstBatchIntakeYear;
  const yearValid = Number.isInteger(batchYear) && batchYear >= firstYear && batchYear <= 2100;
  const label = yearValid ? describeBatch(batchYear) : "";
  const existing = batches.find((b) => b.batch_year === batchYear);

  const ready = rows.filter((r) => !r.issue);
  const withIssues = rows.filter((r) => r.issue);
  const created = useMemo(() => createdStudents(results), [results]);
  const failed = results.filter((r) => !r.ok);

  const read = async (f: File) => {
    setFile(f);
    setReading(true);
    setFatal(null);
    const first = await parseIntakeFile(f, { regs: new Set(), emails: new Set() });
    if (first.fatal) {
      setRows([]);
      setFatal(first.fatal);
      setReading(false);
      return;
    }
    const taken = await alreadyInPes(first.rows);
    const checked = await parseIntakeFile(f, taken);
    setRows(checked.rows);
    setFatal(checked.fatal);
    setReading(false);
    setStep("review");
  };

  const downloadTemplate = async () => {
    const blob = await buildIntakeTemplate(label || "New intake");
    saveBlob(blob, `PES-intake-${fileSafe(label || "template")}.xlsx`);
  };

  const saveCredentials = async (list: CreatedStudent[] = created) => {
    if (list.length === 0) return;
    const blob = await buildCredentialsWorkbook(label, list);
    saveBlob(blob, `PES-sign-in-${fileSafe(label)}.xlsx`);
    setSaved(true);
  };

  const create = async () => {
    setStep("creating");
    setRequestError(null);
    setProgress({ done: 0, total: ready.length });
    const all: IntakeResult[] = [];
    for (let i = 0; i < ready.length; i += INTAKE_CHUNK) {
      const part = ready.slice(i, i + INTAKE_CHUNK);
      const { data, error } = await addStudents(
        batchYear,
        part.map((r) => ({
          name: r.name,
          reg_number: r.reg_number,
          index_number: r.index_number,
          email: r.email,
          department: r.department,
        })),
      );
      if (error || !data) {
        // What was not sent is reported as not added, so the sheet of
        // passwords still covers everyone who was.
        setRequestError(error ?? "The request failed.");
        ready.slice(i).forEach((r) =>
          all.push({ reg_number: r.reg_number, name: r.name, email: r.email, ok: false, error: "Not sent: the request failed" }),
        );
        break;
      }
      all.push(...data.results);
      setProgress({ done: Math.min(i + part.length, ready.length), total: ready.length });
    }
    setResults(all);
    setStep("done");
    onAdded();
    // The sheet is the only copy of the passwords: save it straight away.
    await saveCredentials(createdStudents(all));
  };

  const busy = step === "creating";
  const closeBlocked = busy || (step === "done" && created.length > 0 && !saved);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && closeBlocked) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="max-h-[90vh] overflow-y-auto [&>*]:min-w-0 sm:max-w-3xl"
        onInteractOutside={(e) => step !== "setup" && e.preventDefault()}
        onEscapeKeyDown={(e) => closeBlocked && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-primary" aria-hidden="true" />
            New intake{label ? ` — ${label}` : ""}
          </DialogTitle>
          <DialogDescription>
            {step === "setup" &&
              "Choose the intake year and upload the list of students. Each one gets a sign-in account and a temporary password."}
            {step === "review" && "Check the list. Only the rows without a problem are added."}
            {step === "creating" && "Creating the sign-in accounts. Keep this window open."}
            {step === "done" && "The intake is in PES."}
          </DialogDescription>
        </DialogHeader>

        {step === "setup" && (
          <div className="space-y-5 py-1">
            <div className="grid gap-3 sm:grid-cols-[10rem_1fr] sm:items-end">
              <div>
                <Label htmlFor="intake-year">Intake year</Label>
                <Input
                  id="intake-year"
                  type="number"
                  inputMode="numeric"
                  min={firstYear}
                  max={2100}
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  className="mt-1 tabular-nums"
                />
              </div>
              <div className="rounded-xl border border-border bg-muted/40 px-3 py-2 text-sm">
                {yearValid ? (
                  <>
                    <span className="font-semibold text-foreground">{label}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      · starts in Semester 1
                    </span>
                  </>
                ) : (
                  <span className="text-danger-fg">
                    Give a year from {firstYear} (Batch 1) onwards.
                  </span>
                )}
              </div>
            </div>
            {existing && (
              <p className="flex items-start gap-2 rounded-xl border border-warning-border bg-warning-bg px-3 py-2 text-sm text-warning-fg">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
                Batch {getBatchNumber(batchYear)} already has {existing.students} students. The list is added to
                them — use this for late admissions, not to bring the same batch in twice.
              </p>
            )}

            <div className="rounded-xl border border-dashed border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <FileSpreadsheet className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 text-sm">
                    <p className="font-medium text-foreground">The list of students</p>
                    <p className="text-xs text-muted-foreground">
                      .xlsx or .csv with the columns Name and Registration No; Index No, Email and Department
                      are optional.
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={downloadTemplate} disabled={!yearValid}>
                    <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    Template
                  </Button>
                  <Button size="sm" onClick={() => fileInput.current?.click()} disabled={!yearValid || reading}>
                    {reading ? (
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Upload className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    )}
                    {reading ? "Reading…" : "Upload list"}
                  </Button>
                  <input
                    ref={fileInput}
                    type="file"
                    accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) read(f);
                    }}
                  />
                </div>
              </div>
              {fatal && (
                <p role="alert" className="mt-3 text-sm text-danger-fg">
                  {file?.name}: {fatal}
                </p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              A first-year is not in a department yet: leave Department blank, and record the division from
              the Batches page when the faculty makes it. Students sign in with their email — by default
              en&lt;registration no&gt;@foe.sjp.ac.lk.
            </p>
          </div>
        )}

        {step === "review" && (
          <div className="space-y-3 py-1">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <StatusBadge tone="success" icon={CheckCircle2}>
                {ready.length} ready
              </StatusBadge>
              {withIssues.length > 0 && (
                <StatusBadge tone="danger" icon={AlertTriangle}>
                  {withIssues.length} with a problem
                </StatusBadge>
              )}
              <span className="text-xs text-muted-foreground">from {file?.name}</span>
            </div>
            <div className="max-h-[45vh] overflow-auto rounded-xl border border-border">
              <table className="w-full min-w-[40rem] text-left text-xs">
                <thead className="sticky top-0 bg-muted text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">Row</th>
                    <th className="px-2 py-1.5 font-medium">Name</th>
                    <th className="px-2 py-1.5 font-medium">Reg. No</th>
                    <th className="px-2 py-1.5 font-medium">Index No</th>
                    <th className="px-2 py-1.5 font-medium">Email</th>
                    <th className="px-2 py-1.5 font-medium">Department</th>
                  </tr>
                </thead>
                <tbody>
                  {[...withIssues, ...ready].map((r) => (
                    <tr
                      key={r.row}
                      className={cn("border-t border-border/70", r.issue && "bg-danger-bg/60")}
                    >
                      <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{r.row}</td>
                      <td className="px-2 py-1.5">
                        <span className="text-foreground">{r.name || "—"}</span>
                        {r.issue && <span className="block font-medium text-danger-fg">{r.issue}</span>}
                      </td>
                      <td className="px-2 py-1.5 tabular-nums">{r.reg_number || "—"}</td>
                      <td className="px-2 py-1.5 tabular-nums">{r.index_number ?? "—"}</td>
                      <td className="px-2 py-1.5">{r.email}</td>
                      <td className="px-2 py-1.5 text-muted-foreground">{r.department ?? "Not yet"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {withIssues.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Rows with a problem are left out. Fix them in the sheet and upload it again, or add the rest
                now and upload the fixed rows afterwards.
              </p>
            )}
          </div>
        )}

        {step === "creating" && (
          <div className="space-y-3 py-6">
            <Progress value={progress.total ? (progress.done / progress.total) * 100 : 0} />
            <p className="text-center text-sm text-muted-foreground tabular-nums">
              {progress.done} of {progress.total} students added…
            </p>
          </div>
        )}

        {step === "done" && (
          <div className="space-y-4 py-1">
            <div className="flex items-start gap-3 rounded-xl border border-success-border bg-success-bg px-3 py-3 text-sm text-success-fg">
              <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0" aria-hidden="true" />
              <div>
                <p className="font-semibold">
                  {created.length} student{created.length === 1 ? "" : "s"} added to {label}.
                </p>
                <p className="text-xs">
                  They are in Semester 1. Their department admin — or you, for a first-year — opens their
                  enrolment window as for any batch.
                </p>
              </div>
            </div>

            {created.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border px-3 py-3">
                <div className="flex min-w-0 items-start gap-3 text-sm">
                  <KeyRound className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary" aria-hidden="true" />
                  <div>
                    <p className="font-medium text-foreground">Sign-in details</p>
                    <p className="text-xs text-muted-foreground">
                      Email and temporary password for each student. This sheet is the only copy — PES does
                      not keep the passwords. Each student must change theirs at first sign-in.
                    </p>
                  </div>
                </div>
                <Button size="sm" variant={saved ? "outline" : "default"} onClick={() => saveCredentials()}>
                  <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  {saved ? "Download again" : "Download"}
                </Button>
              </div>
            )}

            {(failed.length > 0 || requestError) && (
              <div className="rounded-xl border border-danger-border bg-danger-bg px-3 py-2.5 text-sm text-danger-fg">
                <p className="font-semibold">
                  {failed.length} not added{requestError ? ` — ${requestError}` : ""}
                </p>
                <ul className="mt-1 max-h-40 list-disc space-y-0.5 overflow-auto pl-5 text-xs">
                  {failed.map((f) => (
                    <li key={f.reg_number + f.email}>
                      {f.reg_number} {f.name}: {f.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {step === "setup" && (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          )}
          {step === "review" && (
            <>
              <Button variant="outline" onClick={() => setStep("setup")}>
                Back
              </Button>
              <Button onClick={create} disabled={ready.length === 0}>
                <UserPlus className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Add {ready.length} student{ready.length === 1 ? "" : "s"} to Batch {getBatchNumber(batchYear)}
              </Button>
            </>
          )}
          {step === "done" && (
            <>
              {closeBlocked && (
                <p className="mr-auto self-center text-xs text-danger-fg">Download the sign-in details first.</p>
              )}
              <Button onClick={() => onOpenChange(false)} disabled={closeBlocked}>
                Done
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
