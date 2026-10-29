import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Award, GraduationCap, Plus, Users, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../../components/ui/command";
import {
  CourseCode,
  EmptyState,
  ErrorState,
  PageHeader,
  PersonAvatar,
  SectionCard,
  SkeletonRows,
  StatStrip,
  StatusBadge,
} from "../../components/common";
import { useAuth } from "../../context/AuthContext";
import { getStaffCapabilities } from "../../../lib/staffScope";
import { describeBatch } from "../../../lib/batch";
import {
  assignLecturer,
  endAssignment,
  getAssignableLecturers,
  getDepartmentTeaching,
  setAssignmentRole,
  type AssignableLecturer,
  type DepartmentOffering,
} from "../../../lib/staffService";
import { departmentByCourseCode } from "../../../lib/departments";

/**
 * Course assignments for a Head of Department.
 *
 * Assignments are made against a course *offering* — a specific batch's
 * delivery in a specific academic year — not against the catalogue course, so
 * changing who teaches next year's intake never rewrites who taught this
 * year's. Ending an assignment keeps the row and marks it inactive, which is
 * what preserves the teaching history behind past results and feedback.
 */
export default function HodAssignments() {
  const { student, staff } = useAuth();
  const caps = getStaffCapabilities(staff);

  const [offerings, setOfferings] = useState<DepartmentOffering[]>([]);
  const [lecturers, setLecturers] = useState<AssignableLecturer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [batchFilter, setBatchFilter] = useState<string>("all");
  const [semesterFilter, setSemesterFilter] = useState<string>("all");

  useEffect(() => {
    if (staff) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staff?.lecturerId]);

  const load = async () => {
    setLoading(true);
    setError(null);
    const [teaching, assignable] = await Promise.all([
      getDepartmentTeaching(null, null),
      getAssignableLecturers(),
    ]);
    if (!teaching.ok) {
      setError(teaching.error);
      setLoading(false);
      return;
    }
    setOfferings(teaching.data);
    // Surfaced rather than swallowed: with no lecturer list the Assign panel
    // is empty, which looks like a broken button rather than a failed call.
    if (assignable.ok) setLecturers(assignable.data);
    else setError(assignable.error);
    setLoading(false);
  };

  const act = async (
    key: string,
    successMessage: string,
    fn: () => Promise<{ ok: boolean; error?: string }>,
  ) => {
    setBusy(key);
    const result = await fn();
    setBusy(null);
    if (!result.ok) {
      toast.error(result.error ?? "That change could not be saved.");
      return;
    }
    // Reload before showing the message, so the chip the HOD is being told
    // about is already on screen when they read it.
    await load();
    toast.success(successMessage);
  };

  const batches = useMemo(
    () => [...new Set(offerings.map((o) => o.batch_year))].sort((a, b) => b - a),
    [offerings],
  );
  const semesters = useMemo(
    () => [...new Set(offerings.map((o) => o.semester))].sort((a, b) => a - b),
    [offerings],
  );

  /* The semester the department's batches are sitting now. Assigning staff
     is work for the term about to run, so the page opens there rather than
     on a list that also holds every delivery since the batch's first year;
     the older ones are one choice away for a correction. */
  const currentSemester = useMemo(() => {
    const current = offerings.find(
      (o) =>
        o.is_current &&
        (batchFilter === "all" || o.batch_year === Number(batchFilter)),
    );
    return current?.semester ?? null;
  }, [offerings, batchFilter]);

  const [semesterTouched, setSemesterTouched] = useState(false);
  useEffect(() => {
    if (semesterTouched) return;
    setSemesterFilter(currentSemester === null ? "all" : String(currentSemester));
  }, [currentSemester, semesterTouched]);

  const visible = offerings.filter(
    (o) =>
      (batchFilter === "all" || o.batch_year === Number(batchFilter)) &&
      (semesterFilter === "all" || o.semester === Number(semesterFilter)),
  );

  const unassigned = visible.filter((o) => o.lecturers.length === 0).length;

  if (!caps.isHod && student?.role === "lecturer") {
    return (
      <div className="space-y-5">
        <PageHeader title="Course Assignments" />
        <EmptyState
          icon={GraduationCap}
          title="Only the Head of Department can assign teaching staff"
          description="You are seeing this because the page was opened directly. Course assignments for your department are managed by its head."
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Course Assignments"
        description={
          caps.hodDepartment
            ? `Assign lecturers and course coordinators for ${caps.hodDepartment}.`
            : "Assign lecturers and course coordinators."
        }
      />

      {error && <ErrorState message={error} onRetry={load} size="inline" />}

      {/* Which offerings, then how many of them have somebody. */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={batchFilter} onValueChange={setBatchFilter}>
            <SelectTrigger aria-label="Batch" className="h-9 w-56 rounded-control border-border bg-card">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All batches</SelectItem>
              {batches.map((b) => (
                <SelectItem key={b} value={String(b)}>
                  {describeBatch(b)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={semesterFilter}
            onValueChange={(v) => {
              setSemesterTouched(true);
              setSemesterFilter(v);
            }}
          >
            <SelectTrigger aria-label="Semester" className="h-9 w-52 rounded-control border-border bg-card">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All semesters</SelectItem>
              {semesters.map((s) => (
                <SelectItem key={s} value={String(s)}>
                  Semester {s}
                  {s === currentSemester ? " (Current)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {!loading && visible.length > 0 && (
          <StatStrip
            items={[
              {
                label: "offerings with a lecturer",
                value: `${visible.length - unassigned} of ${visible.length}`,
                icon: Users,
                tone: unassigned > 0 ? "warning" : "success",
              },
              ...(unassigned > 0
                ? [{ label: "with nobody assigned", value: unassigned, icon: GraduationCap, tone: "warning" as const }]
                : []),
            ]}
          />
        )}
      </div>

      <SectionCard
        title="Offerings"
        description={`${visible.length} of ${offerings.length} shown`}
        flush
      >
        {loading ? (
          <div className="p-4">
            <SkeletonRows count={6} height="h-16" />
          </div>
        ) : visible.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={GraduationCap}
              title="No course offerings match this filter"
              description="Offerings are created from the courses your department delivers to each batch."
            />
          </div>
        ) : (
          <ul className="divide-y divide-border/70">
            {visible.map((o) => (
              <li
                key={o.offering_id}
                className={`border-l-4 px-4 py-3 transition-colors ${
                  departmentByCourseCode(o.course_code)?.stripeClass ?? "border-l-transparent"
                } ${departmentByCourseCode(o.course_code)?.hoverClass ?? ""}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-foreground">
                      <CourseCode code={o.course_code} className="mr-2" />
                      {o.course_title}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {describeBatch(o.batch_year)} · Semester {o.semester} ·{" "}
                      {o.academic_year} · {o.credits} credits · {o.category}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Users className="h-4 w-4" aria-hidden="true" />
                      <span className="tabular-nums">{o.enrolled_count}</span>
                    </span>
                    <AssignPopover
                      offering={o}
                      lecturers={lecturers}
                      disabled={busy !== null}
                      onAssign={(lecturerId, role, name) =>
                        act(
                          `assign-${o.offering_id}`,
                          `${name} assigned to ${o.course_code}${role === "coordinator" ? " as course coordinator" : ""}.`,
                          () =>
                            assignLecturer(
                              o.offering_id,
                              lecturerId,
                              role,
                              student?.id ?? "",
                            ),
                        )
                      }
                    />
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap gap-1.5">
                  {o.lecturers.length === 0 ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-warning-fg">
                      <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                      No lecturer assigned yet.
                    </span>
                  ) : (
                    o.lecturers.map((l) => (
                      <span
                        key={l.assignment_id}
                        className={`inline-flex items-center gap-1.5 rounded-full border py-0.5 pl-1 pr-1 text-xs ${
                          l.assignment_role === "coordinator"
                            ? "border-primary/30 bg-primary/5"
                            : "border-border bg-muted/40"
                        }`}
                      >
                        <PersonAvatar name={l.name} department={o.department} size="sm" className="h-5 w-5 text-[9px]" />
                        {l.assignment_role === "coordinator" && (
                          <Award
                            className="h-3 w-3 text-primary"
                            aria-label="Course coordinator"
                          />
                        )}
                        <span className="text-foreground">{l.name}</span>
                        {l.assignment_role !== "coordinator" && (
                          <button
                            type="button"
                            title="Make course coordinator"
                            disabled={busy !== null}
                            onClick={() =>
                              act(
                                `role-${l.assignment_id}`,
                                `${l.name} is now the course coordinator for ${o.course_code}.`,
                                () =>
                                  setAssignmentRole(
                                    l.assignment_id,
                                    "coordinator",
                                  ),
                              )
                            }
                            className="rounded px-1 text-muted-foreground hover:text-primary disabled:opacity-50"
                          >
                            <Award className="h-3 w-3" />
                          </button>
                        )}
                        <button
                          type="button"
                          title="Remove from this offering"
                          disabled={busy !== null}
                          onClick={() =>
                            act(
                              `end-${l.assignment_id}`,
                              `${l.name} removed from ${o.course_code}.`,
                              () =>
                                endAssignment(
                                  l.assignment_id,
                                  student?.id ?? "",
                                ),
                            )
                          }
                          className="rounded px-1 text-muted-foreground hover:text-destructive disabled:opacity-50"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

function AssignPopover({
  offering,
  lecturers,
  disabled,
  onAssign,
}: {
  offering: DepartmentOffering;
  lecturers: AssignableLecturer[];
  disabled: boolean;
  onAssign: (
    lecturerId: string,
    role: "lecturer" | "coordinator",
    name: string,
  ) => void;
}) {
  const [open, setOpen] = useState(false);
  const assignedIds = new Set(offering.lecturers.map((l) => l.lecturer_id));
  const hasCoordinator = offering.lecturers.some(
    (l) => l.assignment_role === "coordinator",
  );
  const available = lecturers.filter((l) => !assignedIds.has(l.lecturer_id));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" disabled={disabled}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          Assign
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,90vw)] p-0">
        <Command>
          <CommandInput placeholder="Search lecturers..." />
          <CommandList>
            <CommandEmpty>
              {lecturers.length === 0
                ? "No lecturers in this department."
                : "Everyone is already assigned."}
            </CommandEmpty>
            <CommandGroup
              heading={
                hasCoordinator
                  ? "Adds as lecturer"
                  : "First assignment becomes the coordinator"
              }
            >
              {available.map((l) => (
                <CommandItem
                  key={l.lecturer_id}
                  value={`${l.name} ${l.email}`}
                  onSelect={() => {
                    setOpen(false);
                    // The first person on an offering becomes its coordinator;
                    // after that everyone is added as a lecturer and the
                    // coordinator can be moved explicitly.
                    onAssign(
                      l.lecturer_id,
                      hasCoordinator ? "lecturer" : "coordinator",
                      l.name,
                    );
                  }}
                  className="cursor-pointer"
                >
                  <span className="min-w-0 flex-1 truncate">{l.name}</span>
                  {l.is_hod && <StatusBadge tone="brand">HOD</StatusBadge>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
