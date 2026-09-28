import { Lock, MessageSquareQuote, Star } from "lucide-react";
import { CourseCode, SectionCard, StatusBadge, type StatusTone } from "../common";
import { describeBatch } from "../../../lib/batch";
import type {
  CourseFeedbackReport,
  ReportChoice,
  ReportSection,
} from "../../../lib/staffService";

/**
 * The order the faculty prints its sections in.
 *
 * The database returns them in the order the student answers them, which puts
 * the course before the lecturer. The report leads with the lecturer, because
 * that is what the reader opened it for. Continuous Assessments is missing on
 * purpose: its two questions exist to decide whether the lab section is shown
 * at all, and a report page saying "13 of 13 students had lab classes" is a
 * fact about the form rather than about the course.
 */
const PRINT_ORDER = [
  "lecturers",
  "course_content",
  "learning_resources",
  "delivery_mode",
  "teaching_approach",
  "practical_work",
  "field_visits",
  "course_specific",
  "other_comments",
];

/**
 * Sections whose first choice question asks what was actually used, not what
 * students would have preferred. One is a fact about the course and prints as
 * a single value; the rest are opinions and print as distributions.
 */
const ADOPTED_FIRST = new Set(["delivery_mode", "teaching_approach"]);

const ADOPTED_LABEL: Record<string, string> = {
  delivery_mode: "Mode adopted",
  teaching_approach: "Approach adopted",
};

export const ratingTone = (avg: number | null): StatusTone => {
  if (avg === null) return "neutral";
  if (avg >= 4) return "success";
  if (avg >= 3) return "info";
  if (avg >= 2) return "warning";
  return "danger";
};

const when = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

/** A row of bars: label, count, and share of the students who answered. */
function Distribution({ choice }: { choice: ReportChoice }) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium text-foreground">{choice.question}</p>
      <ul className="space-y-1">
        {choice.tallies.map((t) => (
          <li key={t.value} className="flex items-center gap-2">
            <span className="w-48 flex-shrink-0 truncate text-xs text-muted-foreground">
              {t.label}
            </span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full bg-primary"
                style={{ width: `${t.pct}%` }}
              />
            </span>
            <span className="w-20 flex-shrink-0 text-right text-xs tabular-nums text-muted-foreground">
              {t.count} ({t.pct}%)
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RatingTable({
  section,
  numbered,
}: {
  section: ReportSection;
  numbered: boolean;
}) {
  if (section.ratings.length === 0) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[28rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            <th
              scope="col"
              className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              {numbered ? "Attribute" : "Statement"}
            </th>
            <th
              scope="col"
              className="w-28 px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              Rating Avg
            </th>
          </tr>
        </thead>
        <tbody>
          {section.ratings.map((r, i) => (
            <tr key={r.question_id} className="border-b border-border/40">
              <td className="px-3 py-2 text-foreground">
                {numbered && (
                  <span className="mr-1.5 tabular-nums text-muted-foreground">
                    {i + 1}.
                  </span>
                )}
                {r.question}
              </td>
              <td className="px-3 py-2 text-right">
                <span
                  className={`tabular-nums font-semibold ${
                    r.average >= 4
                      ? "text-success-fg"
                      : r.average >= 3
                        ? "text-foreground"
                        : "text-warning-fg"
                  }`}
                >
                  {r.average.toFixed(2)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Free text, numbered the way the printed report numbers it. */
function TextList({
  question,
  answers,
}: {
  question: string;
  answers: string[];
}) {
  return (
    <div className="space-y-1.5">
      <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
        <MessageSquareQuote
          className="h-3.5 w-3.5 text-muted-foreground"
          aria-hidden="true"
        />
        {question}
      </p>
      <ol className="space-y-1">
        {answers.map((a, i) => (
          <li
            key={`${i}-${a.slice(0, 24)}`}
            className="flex gap-2 rounded-lg bg-muted/40 px-2.5 py-1.5 text-sm text-foreground"
          >
            <span className="tabular-nums text-muted-foreground">{i + 1}</span>
            <span className="min-w-0 flex-1">{a}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * A course's feedback, laid out as the faculty's printed report.
 *
 * The report is confidential to the person reading it: the fifteen lecturer
 * attributes are about them, not about whoever else teaches the course, and
 * the free text is shown without any student attached to it however the
 * student answered. Anonymity is not a display choice here — the database
 * never sends the names.
 */
export function FeedbackReport({ report }: { report: CourseFeedbackReport }) {
  if (!report.visible) {
    const short = report.threshold - report.response_count;
    return (
      <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/40 px-4 py-3">
        <Lock
          className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <div>
          <p className="text-sm font-medium text-foreground">
            {report.response_count} response
            {report.response_count === 1 ? "" : "s"} so far
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Results open up at {report.threshold} responses —{" "}
            {short === 1 ? "one more" : `${short} more`} to go. Below that a
            report would be about students who could be picked out of it.
          </p>
        </div>
      </div>
    );
  }

  const byKey = new Map(report.sections.map((s) => [s.section_key, s]));
  const ordered = PRINT_ORDER.map((k) => byKey.get(k)).filter(
    (s): s is ReportSection => s !== undefined,
  );

  return (
    <div className="space-y-4">
      {/* The header block the printed report opens with. */}
      <SectionCard flush>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 p-4 sm:grid-cols-3">
          {[
            [
              "Course",
              <>
                <CourseCode code={report.course_code} /> — {report.course_title}
              </>,
            ],
            ["Lecturer", report.lecturer_name],
            [
              "Feedback type",
              report.feedback_type === "end_semester"
                ? "End Semester Feedback"
                : "Mid Semester Feedback",
            ],
            ["Semester", `Semester ${report.semester}`],
            [
              "Academic year",
              report.batch_year !== null
                ? `${report.academic_year} · ${describeBatch(report.batch_year)}`
                : report.academic_year,
            ],
            ["Responses", `${report.response_count} student(s)`],
          ].map(([label, value]) => (
            <div key={label as string} className="min-w-0">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {label}
              </dt>
              <dd className="mt-0.5 text-sm text-foreground">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="grid grid-cols-1 gap-px border-t border-border bg-border sm:grid-cols-2">
          {[
            ["Overall lecturer score", report.scores.lecturer_overall],
            ["Course content score", report.scores.course_content],
          ].map(([label, score]) => (
            <div key={label as string} className="bg-card px-4 py-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {label as string}
              </p>
              <p className="mt-1 flex items-baseline gap-1.5">
                <span className="text-2xl font-bold tabular-nums text-foreground">
                  {score !== null ? (score as number).toFixed(2) : "—"}
                </span>
                {score !== null && (
                  <>
                    <span className="text-sm text-muted-foreground">/ 5</span>
                    <StatusBadge
                      tone={ratingTone(score as number)}
                      icon={Star}
                      className="ml-1"
                    >
                      {(score as number) >= 4
                        ? "Strong"
                        : (score as number) >= 3
                          ? "Fair"
                          : "Needs attention"}
                    </StatusBadge>
                  </>
                )}
              </p>
            </div>
          ))}
        </div>
      </SectionCard>

      {ordered.map((section) => {
        const adoptedFirst =
          ADOPTED_FIRST.has(section.section_key) && section.choices.length > 0;
        const adopted = adoptedFirst ? section.choices[0] : null;
        const distributions = adoptedFirst
          ? section.choices.slice(1)
          : section.choices;

        return (
          <SectionCard
            key={section.section_key}
            title={`${section.section_icon ?? ""} ${section.section_title}`.trim()}
            actions={
              section.average !== null ? (
                <StatusBadge tone={ratingTone(section.average)}>
                  Average {section.average.toFixed(2)} / 5
                </StatusBadge>
              ) : undefined
            }
            flush={section.ratings.length > 0 && section.choices.length === 0 &&
                   section.texts.length === 0}
          >
            <div className="space-y-4">
              <RatingTable
                section={section}
                numbered={section.section_key === "lecturers"}
              />

              {adopted && adopted.tallies.length > 0 && (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {ADOPTED_LABEL[section.section_key] ?? "Adopted"}
                  </p>
                  <p className="mt-0.5 text-sm font-semibold text-foreground">
                    {adopted.tallies[0].label}
                  </p>
                </div>
              )}

              {distributions.map((c) => (
                <Distribution key={c.question_id} choice={c} />
              ))}

              {section.texts.map((t) => (
                <TextList
                  key={t.question_id}
                  question={t.question}
                  answers={t.answers}
                />
              ))}
            </div>
          </SectionCard>
        );
      })}

      <p className="px-1 text-xs text-muted-foreground">
        This report is confidential and intended for the recipient only. Free
        text is shown without any student attached to it. Generated{" "}
        {when(report.generated_on)}.
      </p>
    </div>
  );
}
