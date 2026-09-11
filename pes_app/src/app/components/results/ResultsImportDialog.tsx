import { AlertTriangle, CheckCircle2, FileSpreadsheet, Lock, XCircle } from "lucide-react";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import type { ImportReport } from "../../../lib/resultsWorkbook";

/**
 * What the spreadsheet says, before any of it is believed.
 *
 * An import that silently applied what it could and dropped the rest would be
 * the worst of both: the person would think forty rows landed when thirty-six
 * did, and would find out at the class list. So nothing is applied until this
 * dialog is confirmed, and every row that will not be applied is named here
 * with the reason and its row number in the file.
 *
 * Confirming still does not write to the database. It fills the sheet on
 * screen, which the person then saves and submits themselves — the marks get
 * one more look from the person answerable for them.
 */
export function ResultsImportDialog({
  report,
  onApply,
  onClose,
}: {
  report: ImportReport | null;
  onApply: () => void;
  onClose: () => void;
}) {
  if (!report) return null;

  const { fatal, ready, rejected, locked, absent, blankCount } = report;
  const applying = ready.length;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            {fatal ? "This file cannot be used" : "Check the import before it lands"}
          </DialogTitle>
          <DialogDescription>{report.fileName}</DialogDescription>
        </DialogHeader>

        {fatal ? (
          <div className="flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
            <XCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>{fatal}</span>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Tally label="Will be filled in" value={applying} tone="success" />
              <Tally label="Rejected" value={rejected.length} tone="danger" />
              <Tally label="Already locked" value={locked.length} tone="muted" />
              <Tally label="Not in the file" value={absent.length} tone="muted" />
            </div>

            {applying === 0 && (
              <p className="rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
                Nothing in this file can be applied, so the sheet on screen will
                be left exactly as it is.
              </p>
            )}

            {blankCount > 0 && (
              <p className="text-xs text-muted-foreground">
                {blankCount} of the accepted row{blankCount === 1 ? " is" : "s are"}{" "}
                empty — no marks and no grade. They will be filled in as blank,
                which is not the same as being ready to submit.
              </p>
            )}

            {rejected.length > 0 && (
              <Group
                icon={<XCircle className="h-4 w-4 text-destructive" />}
                title={`${rejected.length} row${rejected.length === 1 ? "" : "s"} rejected — nothing from ${rejected.length === 1 ? "it" : "them"} will be used`}
              >
                <ul className="space-y-1.5">
                  {rejected.map((r) => (
                    <li key={r.excelRow} className="text-xs">
                      <span className="font-medium text-foreground">
                        Row {r.excelRow}
                        {r.indexNumber ? ` · ${r.indexNumber}` : ""}
                      </span>
                      <ul className="ml-3 list-disc text-muted-foreground">
                        {r.problems.map((p, i) => (
                          <li key={i}>{p}</li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </Group>
            )}

            {locked.length > 0 && (
              <Group
                icon={<Lock className="h-4 w-4 text-muted-foreground" />}
                title={`${locked.length} student${locked.length === 1 ? "" : "s"} already submitted or published`}
              >
                <p className="mb-1.5 text-xs text-muted-foreground">
                  Their marks are out of your hands now, so the file's values for
                  them are ignored. Ask the department to return the sheet if
                  they need changing.
                </p>
                <p className="text-xs text-foreground">
                  {locked.map((r) => r.indexNumber).join(", ")}
                </p>
              </Group>
            )}

            {absent.length > 0 && (
              <Group
                icon={<AlertTriangle className="h-4 w-4 text-warning-fg" />}
                title={`${absent.length} student${absent.length === 1 ? "" : "s"} on the class list that the file did not mention`}
              >
                <p className="mb-1.5 text-xs text-muted-foreground">
                  Whatever is on screen for them stays as it is — the import will
                  not blank anyone out.
                </p>
                <p className="text-xs text-foreground">{absent.join(", ")}</p>
              </Group>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {fatal || applying === 0 ? "Close" : "Cancel"}
          </Button>
          {!fatal && applying > 0 && (
            <Button onClick={onApply}>
              <CheckCircle2 className="mr-1.5 h-4 w-4" />
              Fill in {applying} row{applying === 1 ? "" : "s"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Tally({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "success" | "danger" | "muted";
}) {
  const colour =
    tone === "success" && value > 0
      ? "text-success-fg"
      : tone === "danger" && value > 0
        ? "text-destructive"
        : "text-muted-foreground";
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2">
      <p className={`text-lg font-bold tabular-nums ${colour}`}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function Group({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border p-3">
      <div className="mb-2 flex items-center gap-1.5">
        {icon}
        <span className="text-sm font-medium text-foreground">{title}</span>
      </div>
      {children}
    </div>
  );
}
