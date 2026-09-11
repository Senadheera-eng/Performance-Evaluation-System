import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../../lib/supabase";
import { AlertCard } from "./AlertCard";

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

const CARD_TYPE: Record<Severity, "error" | "warning" | "info" | "success"> = {
  critical: "error",
  warning: "warning",
  info: "info",
  positive: "success",
};

/* Worst first. A student scanning the top of their dashboard should meet the
   thing that can cost them a module before the thing that is merely nice. */
const ORDER: Record<Severity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
  positive: 3,
};

export function InsightsPanel() {
  const navigate = useNavigate();
  const [insights, setInsights] = useState<Insight[]>([]);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("get_my_insights");
    if (error) {
      // Never block the dashboard on this. A student who cannot see their
      // warnings should still see their marks.
      console.error("[insights]", error);
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

  if (insights.length === 0) return null;

  return (
    <div className="space-y-3">
      {insights.map((insight, i) => {
        const destination = DESTINATION[insight.kind];
        return (
          <AlertCard
            key={`${insight.kind}-${insight.course_code ?? i}`}
            type={CARD_TYPE[insight.severity] ?? "info"}
            title={insight.title}
            message={insight.detail}
            action={
              destination
                ? { label: destination.label, onClick: () => navigate(destination.to) }
                : undefined
            }
          />
        );
      })}
    </div>
  );
}
