import { useCallback, useEffect, useMemo, useState } from "react";
import { Award, ChevronDown, History, Shield, UserCog } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
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
  DepartmentDot,
  EmptyState,
  ErrorState,
  PageHeader,
  PersonAvatar,
  SectionCard,
  SkeletonRows,
} from "../../components/common";
import { cn } from "../../components/ui/utils";
import { supabase } from "../../../lib/supabase";
import { useAvatarUrls } from "../../../lib/avatars";
import { departmentByName } from "../../../lib/departments";
import { useAuth } from "../../context/AuthContext";

interface FacultyLecturer {
  lecturer_id: string;
  name: string;
  email: string;
  title: string | null;
  staff_no: string | null;
  department: string;
  status: string;
  is_hod: boolean;
  hod_since: string | null;
}

interface HodTerm {
  lecturer_id: string;
  name: string;
  email: string;
  valid_from: string;
  valid_to: string | null;
  is_active: boolean;
  notes: string | null;
}

/** What the confirmation dialog is being asked to carry out. */
type PendingChange =
  | { kind: "appoint"; department: string; lecturer: FacultyLecturer; outgoing: FacultyLecturer | null }
  | { kind: "stand-down"; department: string; outgoing: FacultyLecturer };

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

/**
 * Who heads each department, and moving it.
 *
 * A headship is an appointment with a start and an end rather than a flag on
 * the lecturer, so moving it never rewrites who led the department when past
 * results were approved or past feedback was read. The move itself is one
 * database call: closing the outgoing appointment and opening the new one are
 * a single statement, because a department left briefly headless — or briefly
 * with two heads — is a state nothing else in the system expects.
 */
export default function AdminHods() {
  const { student } = useAuth();
  const isSuperAdmin = student?.role === "super_admin";

  const [lecturers, setLecturers] = useState<FacultyLecturer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [pending, setPending] = useState<PendingChange | null>(null);
  const [reason, setReason] = useState("");

  const [openHistory, setOpenHistory] = useState<string | null>(null);
  const [history, setHistory] = useState<Record<string, HodTerm[]>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc("get_faculty_lecturers");
    if (rpcError) {
      setError(rpcError.message);
      setLoading(false);
      return;
    }
    setLecturers((data ?? []) as FacultyLecturer[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (isSuperAdmin) load();
    else setLoading(false);
  }, [isSuperAdmin, load]);

  const departments = useMemo(() => {
    const byDept = new Map<string, FacultyLecturer[]>();
    for (const l of lecturers) {
      const list = byDept.get(l.department) ?? [];
      list.push(l);
      byDept.set(l.department, list);
    }
    return [...byDept.entries()]
      .map(([department, staff]) => ({
        department,
        staff,
        head: staff.find((l) => l.is_hod) ?? null,
      }))
      .sort((a, b) => a.department.localeCompare(b.department));
  }, [lecturers]);

  const avatars = useAvatarUrls(
    departments.map((d) => d.head?.lecturer_id),
  );

  const loadHistory = async (department: string) => {
    if (history[department]) return;
    const { data, error: rpcError } = await supabase.rpc("get_hod_history", {
      p_department: department,
    });
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setHistory((prev) => ({ ...prev, [department]: (data ?? []) as HodTerm[] }));
  };

  const apply = async () => {
    if (!pending) return;
    setSaving(true);
    setError(null);
    setNotice(null);

    const { error: rpcError } =
      pending.kind === "appoint"
        ? await supabase.rpc("set_department_hod", {
            p_department: pending.department,
            p_lecturer_id: pending.lecturer.lecturer_id,
            p_notes: reason.trim() || null,
          })
        : await supabase.rpc("end_department_hod", {
            p_department: pending.department,
          });

    setSaving(false);

    if (rpcError) {
      setError(rpcError.message);
      setPending(null);
      return;
    }

    // The history for this department is now stale — drop it so the next
    // expand re-reads rather than showing the previous head as current.
    setHistory((prev) => {
      const next = { ...prev };
      delete next[pending.department];
      return next;
    });

    await load();
    setNotice(
      pending.kind === "appoint"
        ? `${pending.lecturer.name} is now Head of ${pending.department}.`
        : `${pending.outgoing.name} has stood down. ${pending.department} has no head until one is appointed.`,
    );
    setPending(null);
    setReason("");
  };

  if (!isSuperAdmin) {
    return (
      <div className="space-y-5">
        <PageHeader title="Heads of Department" />
        <EmptyState
          icon={Shield}
          title="Only the super admin can appoint heads of department"
          description="A headship covers a whole department, so it is granted from the faculty level rather than within the department itself."
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Heads of Department"
        description="Every lecturer in the faculty, by department. One lecturer heads each department at a time."
      />

      {error && <ErrorState message={error} onRetry={load} size="inline" />}
      {notice && (
        <div className="rounded-xl border border-success-border bg-success-bg px-3 py-2 text-sm text-success-fg">
          {notice}
        </div>
      )}

      {loading ? (
        <SkeletonRows count={4} height="h-28" />
      ) : (
        departments.map(({ department, staff, head }) => {
          const appointable = staff.filter(
            (l) => l.status === "active" && !l.is_hod,
          );
          const dept = departmentByName(department);
          return (
            <SectionCard
              key={department}
              className={cn("border-l-4", dept?.stripeClass)}
              title={
                <span className="flex items-center gap-2">
                  {dept && <DepartmentDot dept={dept} className="h-2.5 w-2.5" />}
                  <span className={dept?.textClass}>{department}</span>
                  {dept && (
                    <span className="text-xs font-medium text-muted-foreground">
                      {dept.code}
                    </span>
                  )}
                </span>
              }
              description={`${staff.length} lecturer${staff.length === 1 ? "" : "s"}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  {head ? (
                    <div className="flex items-center gap-3">
                      <PersonAvatar
                        name={head.name}
                        url={avatars[head.lecturer_id]}
                        department={department}
                        size="md"
                      />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-foreground">
                            {head.title ? `${head.title} ` : ""}
                            {head.name}
                          </span>
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                              dept?.chipClass ?? "bg-primary/10 text-primary",
                            )}
                          >
                            <Award className="h-3 w-3" aria-hidden="true" />
                            Head of Department
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {head.email}
                          {head.hod_since
                            ? ` · since ${formatDate(head.hod_since)}`
                            : ""}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No head appointed. Nobody has department-wide access to{" "}
                      {department} until one is.
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <ChoosePopover
                    department={department}
                    lecturers={appointable}
                    disabled={saving}
                    label={head ? "Change head" : "Appoint a head"}
                    onChoose={(lecturer) =>
                      setPending({
                        kind: "appoint",
                        department,
                        lecturer,
                        outgoing: head,
                      })
                    }
                  />
                  {head && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={saving}
                      onClick={() =>
                        setPending({
                          kind: "stand-down",
                          department,
                          outgoing: head,
                        })
                      }
                    >
                      Stand down
                    </Button>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  const next = openHistory === department ? null : department;
                  setOpenHistory(next);
                  if (next) loadHistory(department);
                }}
                className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <History className="h-3.5 w-3.5" aria-hidden="true" />
                Past heads
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${
                    openHistory === department ? "rotate-180" : ""
                  }`}
                  aria-hidden="true"
                />
              </button>

              {openHistory === department && (
                <ul
                  className={cn(
                    "mt-2 space-y-1.5 border-l-2 pl-3",
                    dept?.stripeClass ?? "border-border",
                  )}
                >
                  {(history[department] ?? []).length === 0 ? (
                    <li className="text-xs text-muted-foreground">
                      No appointments on record.
                    </li>
                  ) : (
                    history[department].map((t) => (
                      <li
                        key={`${t.lecturer_id}-${t.valid_from}`}
                        className="text-xs text-muted-foreground"
                      >
                        <span className="text-foreground">{t.name}</span> ·{" "}
                        {formatDate(t.valid_from)} →{" "}
                        {t.valid_to ? formatDate(t.valid_to) : "present"}
                        {t.notes ? ` · ${t.notes}` : ""}
                      </li>
                    ))
                  )}
                </ul>
              )}
            </SectionCard>
          );
        })
      )}

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPending(null);
            setReason("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.kind === "appoint"
                ? "Move the headship?"
                : "Stand this head down?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.kind === "appoint" ? (
                <>
                  {pending.lecturer.name} becomes Head of {pending.department}
                  {pending.outgoing
                    ? `, replacing ${pending.outgoing.name}. ${pending.outgoing.name} keeps their lecturer account and their courses — only the headship moves.`
                    : "."}
                </>
              ) : pending ? (
                <>
                  {pending.outgoing.name} loses department-wide access to{" "}
                  {pending.department}. Their lecturer account and courses are
                  untouched, and {pending.department} will have no head until
                  one is appointed.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {pending?.kind === "appoint" && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                Reason (optional)
              </label>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Appointed by Faculty Board, August 2026"
              />
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                apply();
              }}
              disabled={saving}
            >
              {saving
                ? "Saving…"
                : pending?.kind === "appoint"
                  ? "Appoint"
                  : "Stand down"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ChoosePopover({
  department,
  lecturers,
  disabled,
  label,
  onChoose,
}: {
  department: string;
  lecturers: FacultyLecturer[];
  disabled: boolean;
  label: string;
  onChoose: (lecturer: FacultyLecturer) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" disabled={disabled}>
          <UserCog className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,90vw)] p-0">
        <Command>
          <CommandInput placeholder={`Search ${department} lecturers...`} />
          <CommandList>
            <CommandEmpty>No other lecturer in this department.</CommandEmpty>
            <CommandGroup heading="Appoint as head of department">
              {lecturers.map((l) => (
                <CommandItem
                  key={l.lecturer_id}
                  value={`${l.name} ${l.email} ${l.staff_no ?? ""}`}
                  onSelect={() => {
                    setOpen(false);
                    onChoose(l);
                  }}
                  className="cursor-pointer"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-foreground">
                      {l.title ? `${l.title} ` : ""}
                      {l.name}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {l.email}
                    </span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
