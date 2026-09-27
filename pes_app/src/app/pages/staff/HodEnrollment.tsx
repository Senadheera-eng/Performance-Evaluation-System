import { formatDateTime } from "../../../lib/format";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, GraduationCap, Users } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  SectionCard,
  SkeletonRows,
  StatusBadge,
  type StatusTone,
} from "../../components/common";
import { PeriodCourseBreakdown } from "../../components/enrollment/PeriodCourseBreakdown";
import { supabase } from "../../../lib/supabase";
import { useAuth } from "../../context/AuthContext";
import { getStaffCapabilities } from "../../../lib/staffScope";
import { describeBatch } from "../../../lib/batch";
import { departmentStripeClass } from "../../../lib/departments";

type PeriodStatus = "scheduled" | "open" | "closed" | "archived";

/* On the status tokens, so the badges keep their contrast in the dark
   theme; the words carry the meaning, the colour only repeats it. */
const STATUS_TONE: Record<string, StatusTone> = {
  scheduled: "info",
  open: "success",
  closed: "warning",
  archived: "neutral",
};

const STATUS_LABEL: Record<string, string> = {
  scheduled: "Scheduled",
  open: "Open",
  closed: "Closed",
  archived: "Archived",
};

interface Period {
  id: string;
  title: string;
  academic_year: string;
  semester: number;
  batch_year: number | null;
  department: string | null;
  opens_at: string;
  closes_at: string;
  status: PeriodStatus;
  instructions: string | null;
  enrolledCount?: number;
  eligibleCount?: number;
}

/**
 * Enrolment, as the head of a department sees it: batch by batch, course by
 * course, and nothing to click that changes anything.
 *
 * A head needs to know whether their department's students have enrolled
 * before teaching starts — which courses are filling, which are empty, who is
 * missing. They do not open or close the windows themselves; that stays with
 * the Super Admin, so this page has no buttons beyond the ones that expand a
 * row.
 *
 * The restriction is not a matter of what is rendered here. `enrollment_periods`
 * carries a single write policy, for the super admin, and the three functions
 * behind this page admit a lecturer only while they hold an active
 * appointment — so a head who edits the client still cannot open a window, and
 * a lecturer who guesses the URL gets nothing back to render.
 */
export default function HodEnrollment() {
  const { student, staff } = useAuth();
  const caps = getStaffCapabilities(staff);

  const [periods, setPeriods] = useState<Period[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [batchFilter, setBatchFilter] = useState<string>("all");

  useEffect(() => {
    if (caps.isHod) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caps.isHod]);

  const load = async () => {
    setLoading(true);
    setError(null);

    /* RLS decides what comes back: the department's windows and the
       faculty-wide ones, never another department's, and never a draft. */
    const { data, error: readError } = await supabase
      .from("enrollment_periods")
      .select(
        "id, title, academic_year, semester, batch_year, department, opens_at, closes_at, status, instructions",
      )
      .order("opens_at", { ascending: false });

    if (readError) {
      console.error("[HodEnrollment] failed to load periods", readError);
      setError("Unable to load enrolment windows.");
      setLoading(false);
      return;
    }

    const list = (data ?? []) as Period[];
    const withCounts = await Promise.all(
      list.map(async (p) => {
        const { data: summary, error: summaryError } = await supabase.rpc(
          "get_enrollment_period_summary",
          { p_period_id: p.id },
        );
        if (summaryError) {
          console.error("[HodEnrollment] summary failed", p.id, summaryError);
          return p;
        }
        const row = summary?.[0];
        return {
          ...p,
          eligibleCount: row?.eligible_count ?? 0,
          enrolledCount: row?.enrolled_count ?? 0,
        };
      }),
    );

    setPeriods(withCounts);
    setLoading(false);
  };

  /* Batch first, because that is how a head thinks about a cohort: "has the
     2021 batch enrolled for semester 7 yet?" The filter is the batches and
     nothing else. A window opened with no batch used to get its own "Repeat
     students only" category, a distinction no other screen makes; it now
     sits in the one list under "All batches", labelled "Any batch". */
  const batches = useMemo(() => {
    const years = [
      ...new Set(
        periods
          .map((p) => p.batch_year)
          .filter((y): y is number => y !== null),
      ),
    ].sort((a, b) => b - a);
    return years;
  }, [periods]);

  const visible = useMemo(
    () =>
      batchFilter === "all"
        ? periods
        : periods.filter((p) => p.batch_year === Number(batchFilter)),
    [periods, batchFilter],
  );

  if (!caps.isHod && student?.role === "lecturer") {
    return (
      <div className="space-y-5">
        <PageHeader title="Enrolment" />
        <EmptyState
          icon={GraduationCap}
          title="Only the Head of Department can review enrolment"
          description="You are seeing this because the page was opened directly. Enrolment for your department is reviewed by its head, and the windows themselves are opened by the Super Admin."
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Enrolment"
        description={
          caps.hodDepartment
            ? `${caps.hodDepartment} — who has enrolled, batch by batch. Windows are opened by the Super Admin.`
            : "Who has enrolled, batch by batch."
        }
      />

      {loading ? (
        <SectionCard title="Enrolment windows">
          <SkeletonRows count={4} />
        </SectionCard>
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : periods.length === 0 ? (
        <EmptyState
          icon={GraduationCap}
          title="No enrolment windows yet"
          description="Once the Super Admin schedules a window for your department, it appears here with its courses and the students who enrolled."
        />
      ) : (
        <>
          {batches.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                Batch
              </span>
              <select
                value={batchFilter}
                onChange={(e) => setBatchFilter(e.target.value)}
                className="h-9 rounded-xl border border-border bg-card px-3 text-sm text-foreground"
              >
                <option value="all">All batches</option>
                {batches.map((y) => (
                  <option key={y} value={String(y)}>
                    {describeBatch(y)}
                  </option>
                ))}
              </select>
            </div>
          )}

          <SectionCard
            title={
              batchFilter === "all"
                ? "Enrolment windows"
                : describeBatch(Number(batchFilter))
            }
            description={`${visible.length} window${visible.length === 1 ? "" : "s"}`}
          >
            <div className="space-y-3">
                {visible.map((p) => (
                  <Card key={p.id} className={`border-border ${departmentStripeClass(p.department)}`}>
                    <CardContent className="p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-foreground">
                              {p.title}
                            </span>
                            <StatusBadge tone={STATUS_TONE[p.status] ?? "neutral"} dot>
                              {STATUS_LABEL[p.status] ?? p.status}
                            </StatusBadge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {p.department ?? "All Departments"} ·{" "}
                            {p.batch_year === null
                              ? "Any batch"
                              : describeBatch(p.batch_year)}{" "}
                            · Sem {p.semester} · {p.academic_year}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatDateTime(p.opens_at)} →{" "}
                            {formatDateTime(p.closes_at)}
                          </p>
                          {p.instructions && (
                            <p className="text-xs text-foreground mt-1 max-w-md">
                              {p.instructions}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                            <Users className="h-4 w-4" />
                            {p.enrolledCount ?? 0} / {p.eligibleCount ?? 0}{" "}
                            enrolled
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={
                              openId === p.id
                                ? `Hide courses in ${p.title}`
                                : `Show courses in ${p.title}`
                            }
                            onClick={() =>
                              setOpenId((prev) =>
                                prev === p.id ? null : p.id,
                              )
                            }
                          >
                            {openId === p.id ? (
                              <ChevronUp className="h-4 w-4" />
                            ) : (
                              <ChevronDown className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </div>

                      {openId === p.id && (
                        <div className="pt-2 border-t border-border/70">
                          <PeriodCourseBreakdown
                            periodId={p.id}
                            batchYear={p.batch_year}
                          />
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
            </div>
          </SectionCard>
        </>
      )}
    </div>
  );
}
