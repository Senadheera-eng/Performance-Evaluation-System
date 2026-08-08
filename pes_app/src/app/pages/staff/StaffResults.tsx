import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Lock,
  Save,
  Search,
  Send,
  TrendingUp,
  Undo2,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../components/ui/alert-dialog";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  SectionCard,
  SkeletonRows,
  StatCard,
  StatusBadge,
  type StatusTone,
} from "../../components/common";
import { useAuth } from "../../context/AuthContext";
import { describeBatch } from "../../../lib/batch";
import { formatRegNumber } from "../../../lib/format";
import { gradeForMark, overallMark, useSettings } from "../../../lib/settings";
import { getStaffCapabilities } from "../../../lib/staffScope";
import {
  getDepartmentTeaching,
  getMyTeaching,
  getOfferingResults,
  getOfferingRoster,
  saveOfferingResults,
  submitOfferingResults,
  type OfferingResultRow,
  type RosterStudent,
} from "../../../lib/staffService";

/**
 * One offering as this page needs it, whichever call it came from.
 *
 * A head of department sees every offering their department delivers, not
 * only the ones they teach — that is the oversight half of the appointment.
 * But teaching authority is unchanged by it: marks stay editable only on
 * offerings they are actually assigned to, which is exactly what
 * `results_lecturer_update` enforces server-side regardless.
 */
interface SelectableOffering {
  offering_id: string;
  course_id: string;
  course_code: string;
  course_title: string;
  semester: number;
  academic_year: string;
  batch_year: number;
  department: string;
  canEdit: boolean;
}

/** Component maxima, mirroring the admin entry screen. */
const RANGES = {
  midSem: { max: 50, label: "Mid Sem" },
  ca: { max: 50, label: "CA" },
  ese: { max: 100, label: "ESE" },
} as const;

type Field = keyof typeof RANGES;

/** Empty is valid — a mark simply not entered yet. Anything else must be a
 *  number inside its range, or it is refused rather than fed into the grade. */
function validate(field: Field, value: string): string | undefined {
  if (value.trim() === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return "Not a number";
  if (n < 0 || n > RANGES[field].max) return `0–${RANGES[field].max}`;
  return undefined;
}

interface Row {
  studentId: string;
  name: string;
  indexNumber: string;
  regNumber: string;
  isRepeat: boolean;
  midSem: string;
  ca: string;
  ese: string;
  oaMark: number | null;
  grade: string | null;
  gpv: number | null;
  status: OfferingResultRow["status"] | null;
  dirty: boolean;
  errors: Partial<Record<Field, string>>;
}

const gradeTone = (grade: string | null): StatusTone => {
  if (!grade) return "neutral";
  const g = grade.toUpperCase();
  if (g.startsWith("A")) return "success";
  if (g.startsWith("B")) return "info";
  if (g.startsWith("C") || g.startsWith("D")) return "warning";
  return "danger";
};

export default function StaffResults() {
  const { student, staff } = useAuth();
  const settings = useSettings();
  const caps = getStaffCapabilities(staff);

  const [offerings, setOfferings] = useState<SelectableOffering[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [rows, setRows] = useState<Row[]>([]);
  const [returnNotes, setReturnNotes] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const selected = offerings.find((o) => o.offering_id === selectedId) ?? null;

  useEffect(() => {
    if (staff) loadOfferings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staff?.lecturerId]);

  useEffect(() => {
    if (selectedId) loadSheet(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const loadOfferings = async () => {
    setLoading(true);
    setError(null);

    if (caps.isHod) {
      // Department-wide, with the caller's own assignments marked editable.
      const [dept, mine] = await Promise.all([
        getDepartmentTeaching(null, null),
        getMyTeaching(),
      ]);
      if (!dept.ok) {
        setError("We could not load your department's courses. Please try again.");
        setLoading(false);
        return;
      }
      const mineIds = new Set(
        mine.ok ? mine.data.map((o) => o.offering_id) : [],
      );
      const list: SelectableOffering[] = dept.data.map((o) => ({
        offering_id: o.offering_id,
        course_id: o.course_id,
        course_code: o.course_code,
        course_title: o.course_title,
        semester: o.semester,
        academic_year: o.academic_year,
        batch_year: o.batch_year,
        department: o.department,
        canEdit: mineIds.has(o.offering_id),
      }));
      // Courses they teach first — those are the ones they came to work on.
      list.sort((a, b) => Number(b.canEdit) - Number(a.canEdit));
      setOfferings(list);
      if (list.length > 0) setSelectedId(list[0].offering_id);
      setLoading(false);
      return;
    }

    const result = await getMyTeaching();
    if (!result.ok) {
      setError("We could not load your courses. Please try again.");
      setLoading(false);
      return;
    }
    setOfferings(
      result.data.map((o) => ({
        offering_id: o.offering_id,
        course_id: o.course_id,
        course_code: o.course_code,
        course_title: o.course_title,
        semester: o.semester,
        academic_year: o.academic_year,
        batch_year: o.batch_year,
        department: o.department,
        canEdit: true,
      })),
    );
    if (result.data.length > 0) setSelectedId(result.data[0].offering_id);
    setLoading(false);
  };

  const loadSheet = async (offeringId: string) => {
    setSheetLoading(true);
    setError(null);
    setNotice(null);

    const [roster, existing] = await Promise.all([
      getOfferingRoster(offeringId),
      getOfferingResults(offeringId),
    ]);

    if (!roster.ok) {
      setError("We could not load the class list for this course.");
      setRows([]);
      setSheetLoading(false);
      return;
    }
    if (!existing.ok) {
      setError("We could not load the existing marks for this course.");
      setRows([]);
      setSheetLoading(false);
      return;
    }

    const byStudent = new Map(existing.data.map((r) => [r.student_id, r]));
    setReturnNotes(
      existing.data.find((r) => r.return_notes)?.return_notes ?? null,
    );

    setRows(
      roster.data.map((s: RosterStudent) => {
        const r = byStudent.get(s.student_id);
        return {
          studentId: s.student_id,
          name: s.name,
          indexNumber: s.index_number ?? "—",
          regNumber: formatRegNumber(s.reg_number),
          isRepeat: s.is_repeat,
          midSem: r?.mid_sem_mark?.toString() ?? "",
          ca: r?.ca_mark?.toString() ?? "",
          ese: r?.ese_mark?.toString() ?? "",
          oaMark: r?.oa_mark ?? null,
          grade: r?.grade ?? null,
          gpv: r?.gpv ?? null,
          status: r?.status ?? null,
          dirty: false,
          errors: {},
        };
      }),
    );
    setSheetLoading(false);
  };

  const update = (studentId: string, field: Field, value: string) => {
    setRows((prev) =>
      prev.map((row) => {
        if (row.studentId !== studentId) return row;

        const fieldError = validate(field, value);
        const next: Row = {
          ...row,
          [field]: value,
          dirty: true,
          errors: { ...row.errors, [field]: fieldError },
        };

        const mid = parseFloat(field === "midSem" ? value : row.midSem);
        const ca = parseFloat(field === "ca" ? value : row.ca);
        const ese = parseFloat(field === "ese" ? value : row.ese);

        // An out-of-range component must block the grade, not quietly feed
        // into it — the same rule the admin entry screen enforces.
        const anyError =
          next.errors.midSem || next.errors.ca || next.errors.ese;

        if (!anyError && !isNaN(mid) && !isNaN(ca) && !isNaN(ese)) {
          const oa = overallMark(mid, ca, ese, settings);
          const { grade, gpv } = gradeForMark(oa, settings);
          next.oaMark = oa;
          next.grade = grade;
          next.gpv = gpv;
        } else {
          next.oaMark = null;
          next.grade = null;
          next.gpv = null;
        }
        return next;
      }),
    );
  };

  /**
   * Editability is per row, not per sheet.
   *
   * `results_lecturer_update` only permits a row whose status is still
   * 'draft'. On a sheet where some rows are published and others are not — a
   * repeat candidate re-sitting alongside a fresh cohort, say — an
   * all-or-nothing sheet lock would let the lecturer type into rows the
   * database will refuse, and the save would come back half-applied.
   */
  const rowEditable = (r: Row) =>
    (selected?.canEdit ?? false) && (r.status === null || r.status === "draft");

  const publishedCount = rows.filter((r) => r.status === "published").length;
  const submittedCount = rows.filter((r) => r.status === "submitted").length;
  const locked = rows.length > 0 && publishedCount === rows.length;
  const inReview = rows.length > 0 && submittedCount === rows.length;
  const anyEditable = rows.some(rowEditable);

  const invalidCount = rows.filter(
    (r) => rowEditable(r) && (r.errors.midSem || r.errors.ca || r.errors.ese),
  ).length;
  const dirtyValid = rows.filter(
    (r) =>
      r.dirty &&
      rowEditable(r) &&
      !r.errors.midSem &&
      !r.errors.ca &&
      !r.errors.ese,
  );
  const graded = rows.filter((r) => r.grade !== null).length;
  const ungraded = rows.length - graded;

  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    setNotice(null);

    const result = await saveOfferingResults(
      dirtyValid.map((r) => ({
        student_id: r.studentId,
        course_id: selected.course_id,
        academic_year: selected.academic_year,
        offering_id: selected.offering_id,
        mid_sem_mark: r.midSem === "" ? null : Number(r.midSem),
        ca_mark: r.ca === "" ? null : Number(r.ca),
        ese_mark: r.ese === "" ? null : Number(r.ese),
        oa_mark: r.oaMark,
        grade: r.grade,
        gpv: r.gpv,
      })),
      student?.id ?? "",
    );

    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotice(`Saved ${result.data} row${result.data === 1 ? "" : "s"} as draft.`);
    await loadSheet(selected.offering_id);
  };

  const handleSubmit = async () => {
    if (!selected) return;
    setConfirmSubmit(false);
    setSubmitting(true);
    setError(null);
    setNotice(null);

    // Save first: submitting is a whole-sheet transition, and unsaved edits
    // would otherwise be left behind in draft while the rest moved on.
    if (dirtyValid.length > 0) await handleSave();

    const result = await submitOfferingResults(selected.offering_id);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotice(result.data.message);
    await loadSheet(selected.offering_id);
  };

  const visible = useMemo(
    () =>
      rows.filter(
        (r) =>
          r.name.toLowerCase().includes(query.toLowerCase()) ||
          r.indexNumber.toLowerCase().includes(query.toLowerCase()) ||
          r.regNumber.toLowerCase().includes(query.toLowerCase()),
      ),
    [rows, query],
  );

  if (!loading && offerings.length === 0) {
    return (
      <div className="space-y-5">
        <PageHeader title="Results" />
        <EmptyState
          icon={TrendingUp}
          title="No courses assigned"
          description="Result entry appears here once your Head of Department assigns you to a course offering."
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Results"
        description="Enter marks for a course you teach, then submit the sheet to your department for review and publication."
      />

      {error && <ErrorState message={error} size="inline" />}
      {notice && (
        <div className="rounded-xl border border-success-border bg-success-bg px-3 py-2 text-sm text-success-fg">
          {notice}
        </div>
      )}

      <SectionCard title="Course">
        {loading ? (
          <SkeletonRows count={1} height="h-9" />
        ) : (
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm text-foreground sm:max-w-2xl"
          >
            {offerings.map((o) => (
              <option key={o.offering_id} value={o.offering_id}>
                {o.course_code} — {o.course_title} · {describeBatch(o.batch_year)} ·
                Sem {o.semester}
                {caps.isHod && !o.canEdit ? "  (view only)" : ""}
              </option>
            ))}
          </select>
        )}
        {caps.isHod && (
          <p className="mt-2 text-xs text-muted-foreground">
            As Head of {caps.hodDepartment} you can see every course the
            department delivers. Marks stay editable only on the courses you
            teach.
          </p>
        )}
      </SectionCard>

      {selected && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard index={0} label="Students" value={rows.length} icon={TrendingUp} tone="brand" />
            <StatCard index={1} label="Graded" value={graded} icon={CheckCircle2} tone="success" />
            <StatCard
              index={2}
              label="Not Graded"
              value={ungraded}
              icon={AlertCircle}
              tone={ungraded > 0 ? "warning" : "neutral"}
            />
            <StatCard
              index={3}
              label="Sheet Status"
              value={locked ? "Published" : inReview ? "In review" : "Draft"}
              icon={locked ? Lock : inReview ? Send : Save}
              tone={locked ? "success" : inReview ? "warning" : "info"}
            />
          </div>

          {returnNotes && (
            <div className="flex items-start gap-2 rounded-xl border border-warning-border bg-warning-bg px-3 py-2.5 text-sm text-warning-fg">
              <Undo2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>
                <span className="font-medium">Returned by the department:</span>{" "}
                {returnNotes}
              </span>
            </div>
          )}

          {selected && !selected.canEdit ? (
            <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
              <Lock className="mt-0.5 h-4 w-4 flex-shrink-0" />
              You are viewing this as Head of Department. Marks are entered by
              the lecturers assigned to this course.
            </div>
          ) : inReview ? (
            <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
              <Send className="mt-0.5 h-4 w-4 flex-shrink-0" />
              This sheet is with the department for review. It becomes editable
              again only if they return it to you.
            </div>
          ) : locked ? (
            <div className="flex items-start gap-2 rounded-xl border border-success-border bg-success-bg px-3 py-2.5 text-sm text-success-fg">
              <Lock className="mt-0.5 h-4 w-4 flex-shrink-0" />
              These results are published. Students can see their grade, and the
              sheet is no longer editable.
            </div>
          ) : publishedCount > 0 || submittedCount > 0 ? (
            <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
              <Lock className="mt-0.5 h-4 w-4 flex-shrink-0" />
              {publishedCount > 0 &&
                `${publishedCount} row${publishedCount === 1 ? " is" : "s are"} already published`}
              {publishedCount > 0 && submittedCount > 0 && " and "}
              {submittedCount > 0 &&
                `${submittedCount} ${submittedCount === 1 ? "is" : "are"} awaiting review`}
              . Those rows are read-only; the rest can still be edited.
            </div>
          ) : null}

          <SectionCard
            title={`${selected.course_code} — ${selected.course_title}`}
            description={`OA = Mid Sem ${Math.round(settings.oaWeights.mid_sem * 100)}% + CA ${Math.round(settings.oaWeights.ca * 100)}% + ESE ${Math.round(settings.oaWeights.ese * 100)}%. Grade and GPV are calculated for you.`}
            flush
          >
            <div className="border-b border-border/70 p-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search by name, index no. or reg no..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="h-9 bg-card pl-9"
                />
              </div>
            </div>

            {sheetLoading ? (
              <div className="p-4">
                <SkeletonRows count={6} height="h-11" />
              </div>
            ) : visible.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  icon={TrendingUp}
                  title={query ? "No students match that search" : "No students on this offering"}
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/70 text-left text-xs text-muted-foreground">
                      <th className="px-4 py-2 font-medium">Student</th>
                      <th className="w-24 px-2 py-2 text-center font-medium">Mid /50</th>
                      <th className="w-24 px-2 py-2 text-center font-medium">CA /50</th>
                      <th className="w-24 px-2 py-2 text-center font-medium">ESE /100</th>
                      <th className="w-28 px-2 py-2 text-center font-medium">OA</th>
                      <th className="w-20 px-4 py-2 text-center font-medium">Grade</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {visible.map((r) => (
                      <tr key={r.studentId} className={r.dirty ? "bg-warning-bg/40" : undefined}>
                        <td className="px-4 py-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-foreground">{r.name}</span>
                            {r.isRepeat && <StatusBadge tone="info">Repeat</StatusBadge>}
                            {r.status === "published" && (
                              <StatusBadge tone="success" icon={Lock}>
                                Published
                              </StatusBadge>
                            )}
                            {r.status === "submitted" && (
                              <StatusBadge tone="warning" icon={Send}>
                                In review
                              </StatusBadge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {r.indexNumber} · {r.regNumber}
                          </p>
                        </td>
                        {(["midSem", "ca", "ese"] as Field[]).map((field) => (
                          <td key={field} className="px-2 py-2">
                            <Input
                              type="number"
                              inputMode="decimal"
                              min={0}
                              max={RANGES[field].max}
                              value={r[field]}
                              disabled={!rowEditable(r)}
                              aria-label={`${RANGES[field].label} for ${r.name}`}
                              aria-invalid={Boolean(r.errors[field])}
                              onChange={(e) => update(r.studentId, field, e.target.value)}
                              className={`h-8 text-center text-sm ${
                                r.errors[field] ? "border-destructive" : "border-border"
                              }`}
                            />
                            {r.errors[field] && (
                              <p className="mt-0.5 text-center text-xs text-destructive">
                                {r.errors[field]}
                              </p>
                            )}
                          </td>
                        ))}
                        <td className="px-2 py-2 text-center tabular-nums text-muted-foreground">
                          {r.oaMark !== null ? r.oaMark.toFixed(1) : "—"}
                        </td>
                        <td className="px-4 py-2 text-center">
                          {r.grade ? (
                            <StatusBadge tone={gradeTone(r.grade)}>{r.grade}</StatusBadge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {rows.length > 0 && anyEditable && (
              <div className="space-y-3 border-t border-border/70 p-3">
                {invalidCount > 0 && (
                  <div className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                    {invalidCount} row{invalidCount === 1 ? "" : "s"} have a mark
                    outside its range. Fix {invalidCount === 1 ? "it" : "them"}{" "}
                    before saving.
                  </div>
                )}
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    variant="outline"
                    className="flex-1"
                    disabled={saving || dirtyValid.length === 0}
                    onClick={handleSave}
                  >
                    <Save className="mr-1.5 h-4 w-4" />
                    {saving ? "Saving..." : `Save Draft (${dirtyValid.length})`}
                  </Button>
                  <Button
                    className="flex-1"
                    disabled={submitting || ungraded > 0 || invalidCount > 0}
                    onClick={() => setConfirmSubmit(true)}
                    title={
                      ungraded > 0
                        ? "Every student needs a complete grade before the sheet can be submitted"
                        : undefined
                    }
                  >
                    <Send className="mr-1.5 h-4 w-4" />
                    {submitting ? "Submitting..." : "Submit for Review"}
                  </Button>
                </div>
                {ungraded > 0 && (
                  <p className="text-center text-xs text-muted-foreground">
                    {ungraded} student{ungraded === 1 ? "" : "s"} still need all
                    three marks before this sheet can be submitted.
                  </p>
                )}
              </div>
            )}
          </SectionCard>
        </>
      )}

      <AlertDialog open={confirmSubmit} onOpenChange={setConfirmSubmit}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Submit this sheet for review?</AlertDialogTitle>
            <AlertDialogDescription>
              {graded} graded result{graded === 1 ? "" : "s"} for{" "}
              {selected?.course_code} go to the {selected?.department} department
              admin. You will not be able to edit them unless the department
              returns the sheet to you. Publication to students is the
              department's decision, not yours.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleSubmit}>
              Submit {graded} result{graded === 1 ? "" : "s"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
