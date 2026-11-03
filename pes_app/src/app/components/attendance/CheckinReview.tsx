import { useCallback, useEffect, useId, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, RefreshCw, ScanSearch, ShieldCheck } from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "../ui/utils";
import { SectionCard, StatusBadge, useExpandMotion } from "../common";
import { ModelBadge } from "../forecast/GradeForecast";
import {
  getCheckinReview,
  reviewCheck,
  type CheckinReview as Review,
} from "../../../lib/checkinReview";

const pct = (v: number) => `${Math.round(v * 100)}%`;
const time = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * The sign-ins of one lecture that look unusual, for its lecturer to look at.
 *
 * Scored in the database by the attendance anomaly model, so the list is the
 * same wherever it is opened. It says what was unusual about each sign-in and
 * leaves the judgement to the lecturer: a flat battery, a new phone or a
 * friend's private window can look alike, which is why nothing here marks
 * anyone absent. It stays out of the way when the lecture had no sign-ins or
 * no model is loaded.
 */
export function CheckinReview({
  offeringId,
  lectureDate,
  refreshKey = 0,
}: {
  offeringId: string;
  lectureDate: string;
  /** Changes when the register closes, so the list catches up. */
  refreshKey?: number;
}) {
  const [review, setReview] = useState<Review | null>(null);
  const [loading, setLoading] = useState(false);
  const [howOpen, setHowOpen] = useState(false);
  const expand = useExpandMotion();
  const howId = useId();

  const load = useCallback(async () => {
    setLoading(true);
    const r = await getCheckinReview(offeringId, lectureDate);
    setReview(r.ok ? r.data : null);
    setLoading(false);
  }, [offeringId, lectureDate]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (!review || review.signed_in === 0) return null;
  const { flagged, signed_in } = review;
  const check = reviewCheck(review);

  return (
    <SectionCard
      title="Sign-ins to review"
      description="Sign-ins whose pattern is unusual, most unusual first. A flag is a reason to look, never a mark: check with the student before changing anything."
      actions={
        <>
          <ModelBadge />
          <Button size="sm" variant="ghost" onClick={() => void load()} disabled={loading} aria-label="Check again">
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} aria-hidden="true" />
          </Button>
        </>
      }
      flush
    >
      {flagged.length === 0 ? (
        <p className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
          <ShieldCheck className="h-4 w-4 flex-shrink-0 text-success-fg" aria-hidden="true" />
          All {signed_in} sign-in{signed_in === 1 ? "" : "s"} on this date look ordinary.
        </p>
      ) : (
        <ul className="divide-y divide-border/70">
          {flagged.map((f) => (
            <li key={f.student_id + f.checked_in_at} className="flex items-start justify-between gap-3 px-4 py-3">
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium text-foreground">{f.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {f.index_number ?? "—"} · signed in {time(f.checked_in_at)}
                  </span>
                </span>
                <ul className="mt-1 space-y-0.5">
                  {(f.reasons.length > 0 ? f.reasons : ["An unusual combination of small differences"]).map((r) => (
                    <li key={r} className="flex gap-1.5 text-xs text-muted-foreground">
                      <span aria-hidden="true">·</span>
                      {r}
                    </li>
                  ))}
                </ul>
              </span>
              <StatusBadge tone="warning" icon={ScanSearch}>
                Review
              </StatusBadge>
            </li>
          ))}
        </ul>
      )}

      <div className="border-t border-border/70 px-4 py-2.5">
        <button
          type="button"
          onClick={() => setHowOpen((o) => !o)}
          aria-expanded={howOpen}
          aria-controls={howId}
          className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
        >
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", howOpen && "rotate-180")} aria-hidden="true" />
          How sign-ins are checked
        </button>
        <AnimatePresence initial={false}>
          {howOpen && (
            <motion.div
              id={howId}
              key="how"
              variants={expand}
              initial="collapsed"
              animate="open"
              exit="collapsed"
              className="overflow-hidden"
            >
              <div className="space-y-2 pt-2 text-xs leading-relaxed text-muted-foreground">
                <p>
                  An Isolation Forest of 100 decision trees learned what ordinary sign-ins look like from six
                  signals: how old the code was, how far the phone was from the lecture, location withheld by a
                  phone that usually sends it, a student's first sign-in from a device, a device that has signed in
                  other students, and presence checks missed. Each alone has innocent causes; the model looks for
                  unusual combinations. A sign-in a kilometre or more from the lecture is always listed.
                </p>
                {check.model && check.rules && (
                  <p>
                    Tested on {check.lectures?.toLocaleString()} simulated lectures with {check.proxies} proxy
                    sign-ins hidden in them, it listed {pct(check.model.recall)} of the proxies while flagging{" "}
                    {check.model.false_alarms_per_lecture.toFixed(1)} honest students per lecture. Flagging every
                    sign-in far from the hall or without a location would list {pct(check.rules.recall)} of them,
                    but {check.rules.false_alarms_per_lecture.toFixed(1)} honest students per lecture.
                  </p>
                )}
                <p>
                  PES has few real sign-ins yet, so those figures come from a simulation; the model is retrained
                  once real lectures have been recorded. A proxy on the student's own phone, carried in by a
                  friend, leaves no trace in the data.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </SectionCard>
  );
}
