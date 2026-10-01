import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Loader2, Split, Upload } from "lucide-react";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { DepartmentDot } from "../common";
import { supabase } from "../../../lib/supabase";
import { describeBatch } from "../../../lib/batch";
import { departmentByName } from "../../../lib/departments";
import {
  fileSafe,
  parseDepartmentsFile,
  saveBlob,
  STUDENT_DEPARTMENTS,
  type DepartmentAssignment,
} from "../../../lib/batchIntake";

interface Outcome {
  updated: number;
  not_in_batch: string[];
  unknown_department: string[];
}

/**
 * Dividing a batch into departments. A first-year intake comes into PES with
 * no department; partway through, the faculty divides it, and the Super Admin
 * records that from the faculty's list in one go. The batch's own list is the
 * starting point: download it, fill in the Department column, upload it.
 */
export function DepartmentsDialog({
  batchYear,
  onOpenChange,
  onSaved,
}: {
  batchYear: number | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [rows, setRows] = useState<DepartmentAssignment[]>([]);
  const [fatal, setFatal] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setRows([]);
    setFatal(null);
    setFileName("");
    setOutcome(null);
    setError(null);
  }, [batchYear]);

  if (batchYear === null) return null;
  const label = describeBatch(batchYear);
  const valid = rows.filter((r) => !r.issue);
  const invalid = rows.filter((r) => r.issue);
  const counts = STUDENT_DEPARTMENTS.map((d) => ({
    name: d,
    count: valid.filter((r) => r.department === d).length,
  })).filter((c) => c.count > 0);

  const downloadList = async () => {
    setBusy(true);
    const { data, error: e } = await supabase
      .from("students")
      .select("reg_number, index_number, name, department")
      .eq("batch_year", batchYear)
      .eq("role", "student")
      .order("index_number")
      .range(0, 4999);
    if (e) {
      setBusy(false);
      setError(e.message);
      return;
    }
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Departments");
    ws.columns = [
      { header: "Registration No", key: "reg", width: 16 },
      { header: "Index No", key: "index", width: 14 },
      { header: "Name", key: "name", width: 34 },
      { header: "Department", key: "department", width: 38 },
    ];
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    (data ?? []).forEach((s) =>
      ws.addRow({ reg: s.reg_number, index: s.index_number, name: s.name, department: s.department ?? "" }),
    );
    // A drop-down of the four departments in every row.
    const last = Math.max(2, (data ?? []).length + 1);
    for (let r = 2; r <= last; r++) {
      ws.getCell(`D${r}`).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [`"${STUDENT_DEPARTMENTS.join(",")}"`],
      };
    }
    const blob = new Blob([await wb.xlsx.writeBuffer()], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    saveBlob(blob, `PES-departments-${fileSafe(label)}.xlsx`);
    setBusy(false);
  };

  const read = async (f: File) => {
    setFileName(f.name);
    setOutcome(null);
    setError(null);
    const parsed = await parseDepartmentsFile(f);
    setRows(parsed.rows);
    setFatal(parsed.fatal);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    const { data, error: e } = await supabase.rpc("assign_batch_departments", {
      p_batch_year: batchYear,
      p_rows: valid.map((r) => ({ reg_number: r.reg_number, department: r.department })),
    });
    setBusy(false);
    if (e) {
      setError(e.message);
      return;
    }
    setOutcome(data as Outcome);
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto [&>*]:min-w-0 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Split className="h-5 w-5 text-primary" aria-hidden="true" />
            Departments — {label}
          </DialogTitle>
          <DialogDescription>
            Download the batch's list, fill in each student's department, and upload it. Students left blank
            keep the department they have.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={downloadList} disabled={busy}>
              <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />
              The batch's list
            </Button>
            <Button size="sm" onClick={() => input.current?.click()} disabled={busy}>
              <Upload className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Upload filled list
            </Button>
            <input
              ref={input}
              type="file"
              accept=".xlsx,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) read(f);
              }}
            />
          </div>

          {fatal && (
            <p role="alert" className="text-sm text-danger-fg">
              {fileName}: {fatal}
            </p>
          )}

          {rows.length > 0 && !outcome && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                {counts.map((c) => {
                  const dept = departmentByName(c.name);
                  return (
                    <span
                      key={c.name}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs"
                    >
                      {dept && <DepartmentDot dept={dept} className="h-2.5 w-2.5" />}
                      {dept?.code ?? c.name}
                      <span className="tabular-nums text-muted-foreground">{c.count}</span>
                    </span>
                  );
                })}
              </div>
              {invalid.length > 0 && (
                <div className="rounded-xl border border-warning-border bg-warning-bg px-3 py-2 text-xs text-warning-fg">
                  <p className="font-semibold">{invalid.length} rows left out</p>
                  <ul className="mt-1 max-h-28 list-disc overflow-auto pl-5">
                    {invalid.slice(0, 50).map((r) => (
                      <li key={r.row}>
                        Row {r.row}
                        {r.reg_number ? ` (${r.reg_number})` : ""}: {r.issue}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {outcome && (
            <div className="space-y-2">
              <p className="flex items-center gap-2 text-sm text-success-fg">
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                {outcome.updated} student{outcome.updated === 1 ? "" : "s"} moved into their department.
              </p>
              {outcome.not_in_batch.length > 0 && (
                <p className="flex items-start gap-2 text-xs text-warning-fg">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                  Not in this batch: {outcome.not_in_batch.join(", ")}
                </p>
              )}
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-danger-fg">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          {outcome ? (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={save} disabled={busy || valid.length === 0}>
                {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
                Save {valid.length || ""} departments
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
