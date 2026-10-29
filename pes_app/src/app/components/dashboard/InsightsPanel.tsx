import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Info,
  PartyPopper,
  type LucideIcon,
} from "lucide-react";
import { supabase } from "../../../lib/supabase";
import { SectionCard, listItem, stagger } from "../common";
import { cn } from "../ui/utils";

/**
 * What the system noticed without being asked.
 *
 * The project report describes a system that warns rather than waiting to be
 * questioned: attendance slipping, a semester GPA falling, a medical
 * certificate about to fall due, an enrolment window closing. Only the first
 * of those existed, and it was worked out here in the browser — which meant
 * the AI assistant could not see it, and the rules lived in two places the
 * moment anything else wanted them.
 *
 * They all come from get_my_insights() now: one function, one set of
 * thresholds, all of them read from system_settings rather than written into
 * the logic. The Dashboard and the assistant read the same thing, so they
 * cannot tell a student different stories about the same term.
 *
 * On the Dashboard they are one compact list, "Needs your attention", beside
 * the CGPA: worst first, each with the page to act on it.
 */

type Severity = "critical" | "warning" | "info" | "positive";

interface Insight {
  kind: string;
  severity: Severity;
  title: string;
  detail: string;
  course_code?: string;
  value?: number;
}

/** Which page a student can actually do something about this on. */
const DESTINATION: Record<string, { label: string; to: string }> = {
  attendance_risk: { label: "View attendance", to: "/app/attendance" },
  gpa_decline: { label: "View results", to: "/app/results" },
  gpa_improvement: { label: "View results", to: "/app/results" },
  medical_deadline: { label: "View medical certificates", to: "/app/medical" },
  enrolment_open: { label: "Go to enrolment", to: "/app/enrollment" },
  outstanding_modules: { label: "Go to enrolment", to: "/app/enrollment" },
};

const LOOK: Record<Severity, { icon: LucideIcon; chip: string }> = {
  critical: { icon: AlertCircle, chip: "bg-danger-bg text-danger-fg" },
  warning: { icon: AlertTriangle, chip: "bg-warning-bg text-warning-fg" },
  info: { icon: Info, chip: "bg-info-bg text-info-fg" },
  positive: { icon: CheckCircle2, chip: "bg-success-bg text-success-fg" },
};

/* Worst first. A student scanning the top of their dashboard should meet the
   thing that can cost them a module before the thing that is merely nice. */
const ORDER: Record<Severity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
  positive: 3,
};

export function InsightsPanel({ className }: { className?: string }) {
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const [insights, setInsights] = useState<Insight[] | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("get_my_insights");
    if (error) {
      // Never block the dashboard on this. A student who cannot see their
      // warnings should still see their marks.
      console.error("[insights]", error);
      setInsights([]);
      return;
    }
    const list = ((data as { insights?: Insight[] } | null)?.insights ?? [])
      .slice()
      .sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
    setInsights(list);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <SectionCard
      title="Needs your attention"
      description={
        insights && insights.length > 0
          ? `${insights.length} thing${insights.length === 1 ? "" : "s"}, most urgent first.`
          : undefined
      }
      className={className}
      flush
    >
      {insights === null ? (
        <div className="space-y-2 p-4" aria-hidden="true">
          <div className="skeleton-shimmer h-12 rounded-control bg-muted" />
          <div className="skeleton-shimmer h-12 rounded-control bg-muted" />
        </div>
      ) : insights.length === 0 ? (
        <div className="flex items-center gap-3 px-4 py-5">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-success-bg text-success-fg">
            <PartyPopper className="h-4 w-4" aria-hidden="true" />
          </span>
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">You're all caught up.</span> Nothing needs you
            right now.
          </p>
        </div>
      ) : (
        <motion.ul
          variants={stagger(0.05)}
          initial={reduce ? false : "hidden"}
          animate="show"
          className="divide-y divide-border/60"
        >
          {insights.map((insight, i) => {
            const destination = DESTINATION[insight.kind];
            const look = LOOK[insight.severity] ?? LOOK.info;
            const Icon = look.icon;
            return (
              <motion.li
                key={`${insight.kind}-${insight.course_code ?? i}`}
                variants={listItem}
                className="flex items-start gap-3 px-4 py-3"
              >
                <span className={cn("mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full", look.chip)}>
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">{insight.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{insight.detail}</p>
                  {destination && (
                    <button
                      type="button"
                      onClick={() => navigate(destination.to)}
                      className="group mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary/80"
                    >
                      {destination.label}
                      <ArrowRight
                        className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
                        aria-hidden="true"
                      />
                    </button>
                  )}
                </div>
              </motion.li>
            );
          })}
        </motion.ul>
      )}
    </SectionCard>
  );
}
