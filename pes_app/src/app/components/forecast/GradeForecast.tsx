import { useCallback, useEffect, useId, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Link } from "react-router-dom";
import { AlertTriangle, BrainCircuit, ChevronDown, ChevronRight, MessageSquare } from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "../ui/utils";
import { CourseCode, SectionCard, SkeletonRows, StatusBadge, useExpandMotion } from "../common";
import type { StatusTone } from "../common/StatusBadge";
import {
  getMenteeEarlyWarnings,
  getMyGradeForecast,
  getStudentGradeForecast,
  modelCheck,
  pct,
  type Band,
  type ForecastBasis,
  type ForecastModel,
  type MenteeWarning,
  type MyGradeForecast,
  type StudentGradeForecast,
  type WarningLevel,
} from "../../../lib/gradeForecast";

/* ------------------------------------------------------------------ */
/* Shared pieces                                                       */
/* ------------------------------------------------------------------ */

const BAND_TONE: Record<Band, StatusTone> = {
  "A+/A": "success",
  "A-/B+": "info",
  "B/B-": "neutral",
  "C+/C": "warning",
  "R/F": "danger",
};

const LEVEL_TONE: Record<WarningLevel, StatusTone> = { high: "danger", watch: "warning", low: "success" };
const LEVEL_LABEL: Record<WarningLevel, string> = { high: "High", watch: "Watch", low: "On track" };

/** Marks the card as a model's prediction, not a record. */
function ModelBadge() {
  return (
    <StatusBadge tone="brand" icon={BrainCircuit}>
      Machine learning
    </StatusBadge>
  );
}

function basisLine(basis: ForecastBasis, n: number, forStudent: boolean): string {
  const s = n === 1 ? "" : "s";
  if (basis === "enrolled") return forStudent ? `Your ${n} enrolled course${s}.` : `Their ${n} enrolled course${s}.`;
  return forStudent
    ? `Your department's ${n} compulsory course${s}. Enrol to include your electives.`
    : `Their department's ${n} compulsory course${s}; they have not enrolled yet.`;
}

/** A fold under a card: what the model is, how well it did, and what it read. */
function HowItWorks({ model, reasons, audience }: { model: ForecastModel; reasons: string[]; audience: "student" | "mentor" }) {
  const [open, setOpen] = useState(false);
  const expand = useExpandMotion();
  const id = useId();
  const check = modelCheck(model);
  return (
    <div className="border-t border-border/70 pt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={id}
        className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
      >
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} aria-hidden="true" />
        How this forecast works
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={id}
            key="how"
            variants={expand}
            initial="collapsed"
            animate="open"
            exit="collapsed"
            className="overflow-hidden"
          >
            <div className="space-y-2 pt-2 text-xs leading-relaxed text-muted-foreground">
              <p>
                A random forest model (300 decision trees) learned from {model.train_rows.toLocaleString()} past
                results in the faculty: how each student had done so far, in the semester before and in each
                department's courses, and each course's credits and type.
              </p>
              {check && (
                <p>
                  Checked on Semester {check.semester} results it had not seen, its SGPA forecast was off by{" "}
                  {check.sgpa_mae.toFixed(2)} on average
                  {check.sgpa_within_0_25 !== undefined && <> and within 0.25 for {pct(check.sgpa_within_0_25)} of students</>}.
                  It named the exact grade band {pct(check.accuracy)} of the time, and was within one band{" "}
                  {pct(check.within_one_band)} of the time.
                  {audience === "mentor" && check.top25_flag_recall != null && (
                    <> Of the students who did get an R or F, {pct(check.top25_flag_recall)} were in the quarter it flagged most.</>
                  )}
                </p>
              )}
              {reasons.length > 0 && (
                <p>
                  <span className="font-medium text-foreground">
                    What it read from {audience === "student" ? "your" : "their"} record:
                  </span>{" "}
                  {reasons.join(" · ")}
                </p>
              )}
              <p>
                It sees grades only, not effort, attendance or anything that happens this semester, and it is
                retrained each semester.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SgpaFigure({ value, model, children }: { value: number | null; model: ForecastModel; children?: ReactNode }) {
  const check = modelCheck(model);
  return (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
      <div>
        <p className="text-xs text-muted-foreground">Forecast SGPA</p>
        <p className="text-3xl font-semibold tabular-nums text-foreground">{value !== null ? value.toFixed(2) : "—"}</p>
      </div>
      {value !== null && check && (
        <p className="pb-1 text-xs text-muted-foreground">usually within ±{check.sgpa_mae.toFixed(2)}</p>
      )}
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Student: their own forecast, in the Graduation Planner              */
/* ------------------------------------------------------------------ */

/**
 * The bands a student is likely to get this semester and the SGPA they add up
 * to. It shows nothing when there is no forecast (no model loaded, or every
 * course already graded), and a failed load is quiet: the planner around it
 * does not depend on it.
 *
 * The chance of an R or F is not in what the database returns to a student.
 * A course whose likeliest band is R/F says it needs attention and points to
 * the mentor, who sees the figures.
 */
export function MyGradeForecastCard() {
  const [data, setData] = useState<MyGradeForecast | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    void getMyGradeForecast().then((r) => {
      if (!live) return;
      setData(r.ok ? r.data : null);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, []);

  if (loading) return <SkeletonRows count={2} height="h-16" />;
  if (!data || data.courses.length === 0) return null;

  const attention = data.courses.filter((c) => c.needs_attention);
  return (
    <SectionCard
      title={`Semester ${data.semester} forecast`}
      description="What students with records like yours went on to get. A guide to plan with, not a verdict."
      actions={<ModelBadge />}
      collapsible
      storageKey="planner-forecast"
    >
      <div className="space-y-4">
        <SgpaFigure value={data.forecast_sgpa} model={data.model}>
          <p className="pb-1 text-xs text-muted-foreground">{basisLine(data.basis, data.courses.length, true)}</p>
        </SgpaFigure>

        <ul className="divide-y divide-border/70 rounded-control border border-border">
          {data.courses.map((c) => (
            <li key={c.course_id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0">
                <CourseCode code={c.course_code} className="text-sm" />
                <span className="ml-2 text-sm text-foreground">{c.title}</span>
                {!c.counts_this_semester && (
                  <span className="mt-0.5 block text-xs text-muted-foreground">not in this semester's GPA</span>
                )}
              </span>
              <span className="flex flex-shrink-0 items-center gap-2">
                {c.needs_attention || c.band === null ? (
                  <StatusBadge tone="danger" icon={AlertTriangle}>
                    Needs attention
                  </StatusBadge>
                ) : (
                  <>
                    <span className="hidden text-xs tabular-nums text-muted-foreground sm:inline">
                      {c.chance !== null ? `${pct(c.chance)} likely` : ""}
                    </span>
                    <StatusBadge tone={BAND_TONE[c.band]}>{c.band}</StatusBadge>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>

        {attention.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-danger-border bg-danger-bg px-3 py-2.5">
            <p className="text-sm text-foreground">
              Students with records like yours often found {attention.length === 1 ? "this course" : "these courses"}{" "}
              hard. Planning for {attention.length === 1 ? "it" : "them"} with your mentor now leaves the most room to
              change that.
            </p>
            <Button size="sm" variant="outline" asChild>
              <Link to="/app/mentor">
                <MessageSquare className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Talk to your mentor
              </Link>
            </Button>
          </div>
        )}

        <HowItWorks model={data.model} reasons={data.reasons} audience="student" />
      </div>
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ */
/* Mentor: who to talk to first                                        */
/* ------------------------------------------------------------------ */

/**
 * The mentees the model gives an above-usual chance of an R or F this
 * semester, likeliest first. In past results 22% of students got at least
 * one in a semester; "watch" starts at 25% and "high" at 40% (set in the
 * database, so this list and a mentee's own page agree). Opening a row opens
 * that mentee, as the list below does.
 */
export function MenteeEarlyWarnings({ onOpen }: { onOpen: (studentId: string) => void }) {
  const [rows, setRows] = useState<MenteeWarning[] | null>(null);

  const load = useCallback(async () => {
    const r = await getMenteeEarlyWarnings();
    setRows(r.ok ? r.data : null);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!rows || rows.length === 0) return null;
  const flagged = rows.filter((r) => r.level !== "low");
  const semester = Math.max(...rows.map((r) => r.semester));
  const others = rows.length - flagged.length;

  return (
    <SectionCard
      title={`Early warnings · Semester ${semester}`}
      description="Mentees with an above-usual chance of an R or F this semester, predicted from their grades so far. Likeliest first."
      actions={<ModelBadge />}
      collapsible
      storageKey="mentees-early-warnings"
      summary={flagged.length > 0 ? `${flagged.length} to talk to` : "nobody stands out"}
      flush
    >
      {flagged.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">
          None of your {rows.length} mentees stands out this semester: each has a below-usual chance of an R or F.
        </p>
      ) : (
        <ul className="divide-y divide-border/70">
          {flagged.map((m) => (
            <li key={m.student_id}>
              <button
                type="button"
                onClick={() => onOpen(m.student_id)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
              >
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground">{m.name}</span>
                    <StatusBadge tone={LEVEL_TONE[m.level]} dot>
                      {LEVEL_LABEL[m.level]}
                    </StatusBadge>
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {m.index_number ?? "—"} · {pct(m.risk)} chance of an R or F
                    {m.forecast_sgpa !== null && ` · forecast SGPA ${m.forecast_sgpa.toFixed(2)}`}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    {m.watch_courses.length > 0 ? (
                      <>
                        Watch:
                        {m.watch_courses.slice(0, 3).map((c) => (
                          <span
                            key={c.course_code}
                            title={`${c.title}: ${pct(c.at_risk)} chance of an R or F`}
                            className="rounded-full border border-border bg-card px-2 py-0.5"
                          >
                            <CourseCode code={c.course_code} className="text-xs" /> {pct(c.at_risk)}
                          </span>
                        ))}
                        {m.watch_courses.length > 3 && <span>+{m.watch_courses.length - 3}</span>}
                      </>
                    ) : (
                      <>Spread across courses; no single one stands out.</>
                    )}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {flagged.length > 0 && others > 0 && (
        <p className="border-t border-border/70 px-4 py-2 text-xs text-muted-foreground">
          {others} other mentee{others === 1 ? "" : "s"} {others === 1 ? "has" : "have"} a below-usual chance.
        </p>
      )}
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ */
/* Mentor: one mentee's forecast                                       */
/* ------------------------------------------------------------------ */

/** A mentee's full forecast, with the chance of an R or F in each course. */
export function MenteeForecastCard({ studentId }: { studentId: string }) {
  const [data, setData] = useState<StudentGradeForecast | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    void getStudentGradeForecast(studentId).then((r) => {
      if (!live) return;
      setData(r.ok ? r.data : null);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [studentId]);

  if (loading) return <SkeletonRows count={2} height="h-16" />;
  if (!data || data.courses.length === 0) return null;

  return (
    <SectionCard
      title={`Semester ${data.semester} forecast`}
      description="Predicted from their grades so far. The student sees the likely bands and SGPA, not the R or F figures."
      actions={<ModelBadge />}
      collapsible
      storageKey="mentee-forecast"
    >
      <div className="space-y-4">
        <SgpaFigure value={data.forecast_sgpa} model={data.model}>
          <div className="pb-1">
            <StatusBadge tone={LEVEL_TONE[data.level]} dot>
              {LEVEL_LABEL[data.level]} · {pct(data.risk)} chance of an R or F
            </StatusBadge>
          </div>
        </SgpaFigure>
        <p className="-mt-2 text-xs text-muted-foreground">{basisLine(data.basis, data.courses.length, false)}</p>

        <ul className="divide-y divide-border/70 rounded-control border border-border">
          {data.courses.map((c) => (
            <li key={c.course_id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0">
                <CourseCode code={c.course_code} className="text-sm" />
                <span className="ml-2 text-sm text-foreground">{c.title}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  <span className={cn("tabular-nums", c.watch && "font-medium text-danger-fg")}>
                    R or F {pct(c.at_risk)}
                  </span>
                  {!c.counts_this_semester && " · not in this semester's GPA"}
                </span>
              </span>
              <span className="flex flex-shrink-0 items-center gap-2">
                <span className="text-xs tabular-nums text-muted-foreground">
                  {pct(c.probabilities[c.band] ?? 0)} likely
                </span>
                <StatusBadge tone={BAND_TONE[c.band]}>{c.band}</StatusBadge>
              </span>
            </li>
          ))}
        </ul>

        <HowItWorks model={data.model} reasons={data.reasons} audience="mentor" />
      </div>
    </SectionCard>
  );
}
