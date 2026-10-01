import { Fragment, type ReactNode } from "react";
import { CheckCircle2 } from "lucide-react";
import { StatusBadge } from "../common";
import { cn } from "../ui/utils";
import { departmentByCourseCode } from "../../../lib/departments";
import type { MinorPlan, MinorPlanBasket, MinorPlanCourse } from "../../../lib/minorPlan";

interface Row {
  basket: MinorPlanBasket;
  course: MinorPlanCourse | null;
  /** rowSpan for the semester cell on a semester's first row, else null. */
  semesterSpan: number | null;
  /** rowSpan for the basket's cells on its first row, else null. */
  basketSpan: number | null;
  endsBasket: boolean;
  endsSemester: boolean;
}

export interface BasketState {
  /** Credits the student has toward the basket. */
  have: number;
  met: boolean;
}

/**
 * A minor's study plan as the department prints it: Semester, Code, Title,
 * Credits and the minimum requirement of each basket, with the semester and
 * the basket written once against the block of rows they cover, the
 * mandatory course's title in red, and the total that claims the minor
 * underneath. A student holding the official sheet should be reading the
 * same table twice.
 *
 * One column is added to the sheet, Requirement, saying in words what the
 * red means — colour alone is not something every reader can see.
 *
 * Everything else is optional and comes from the caller: a leading column
 * of checkboxes, notes under a course, and how far the student has got with
 * each basket and with the whole minor.
 */
export function MinorPlanTable({
  plan,
  semesters,
  showSemester = true,
  caption,
  select,
  courseNote,
  basketState,
  totalHave,
  rowClassName,
}: {
  plan: MinorPlan;
  /** Only these semesters; all of them when omitted. */
  semesters?: number[];
  /** The Semester column. Off when the table shows a single semester. */
  showSemester?: boolean;
  caption: string;
  select?: {
    label: string;
    render: (course: MinorPlanCourse, basket: MinorPlanBasket) => ReactNode;
  };
  courseNote?: (course: MinorPlanCourse, basket: MinorPlanBasket) => ReactNode;
  basketState?: (basket: MinorPlanBasket) => BasketState | null;
  /** Credits toward the minor, shown against its total. */
  totalHave?: number | null;
  rowClassName?: (course: MinorPlanCourse, basket: MinorPlanBasket) => string | undefined;
}) {
  const baskets = plan.baskets
    .filter((b) => !semesters || semesters.includes(b.semester))
    .sort((a, b) => a.semester - b.semester || a.position - b.position);

  /* One row per course; a basket with no courses yet still gets a row, so
     it can be seen and filled. */
  const rows: Row[] = [];
  baskets.forEach((basket) => {
    const courses = [...basket.courses].sort(
      (a, b) => (a.position ?? 0) - (b.position ?? 0) || a.course_code.localeCompare(b.course_code),
    );
    const list = courses.length > 0 ? courses : [null];
    list.forEach((course, i) =>
      rows.push({
        basket,
        course,
        semesterSpan: null,
        basketSpan: i === 0 ? list.length : null,
        endsBasket: i === list.length - 1,
        endsSemester: false,
      }),
    );
  });
  rows.forEach((row, i) => {
    const first = i === 0 || rows[i - 1].basket.semester !== row.basket.semester;
    if (first) {
      let n = 0;
      while (i + n < rows.length && rows[i + n].basket.semester === row.basket.semester) n++;
      row.semesterSpan = n;
    }
    row.endsSemester = i === rows.length - 1 || rows[i + 1].basket.semester !== row.basket.semester;
  });

  const columns = (select ? 1 : 0) + (showSemester ? 1 : 0) + 5;
  const allSemesters = semesters === undefined;

  const requirement = (b: MinorPlanBasket) =>
    b.mandatory ? (
      <StatusBadge tone="danger">Mandatory</StatusBadge>
    ) : (
      <span className="text-sm text-foreground">Elective</span>
    );

  const minimum = (b: MinorPlanBasket, compact = false) => {
    const state = basketState?.(b);
    return (
      <span className={cn("flex flex-col", compact ? "items-end" : "items-center")}>
        <span className={cn("font-semibold tabular-nums text-foreground", !compact && "text-base")}>
          {compact ? `${b.min_credits} credit${b.min_credits === 1 ? "" : "s"}` : b.min_credits}
        </span>
        {state && (
          <span
            className={cn(
              "mt-0.5 inline-flex items-center gap-1 whitespace-nowrap text-xs",
              state.met ? "text-success-fg" : "text-warning-fg",
            )}
          >
            {state.met && <CheckCircle2 className="h-3 w-3" aria-hidden="true" />}
            {state.have} of {b.min_credits}
          </span>
        )}
      </span>
    );
  };

  const codeClass = (code: string) =>
    cn("font-semibold tabular-nums", departmentByCourseCode(code)?.textClass ?? "text-foreground");

  const titleClass = (b: MinorPlanBasket) =>
    b.mandatory ? "font-medium text-danger-fg" : "text-foreground";

  const total = (
    <span className="flex flex-col items-center">
      <span className="text-base font-semibold tabular-nums text-foreground">
        {plan.required_credits}
      </span>
      {totalHave !== undefined && totalHave !== null && (
        <span
          className={cn(
            "mt-0.5 whitespace-nowrap text-xs",
            totalHave >= plan.required_credits ? "text-success-fg" : "text-muted-foreground",
          )}
        >
          {totalHave} of {plan.required_credits}
        </span>
      )}
    </span>
  );

  if (rows.length === 0) {
    return (
      <p className="px-4 py-3 text-sm text-muted-foreground">
        Nothing in the plan for {semesters?.length === 1 ? `Semester ${semesters[0]}` : "these semesters"}.
      </p>
    );
  }

  return (
    <>
      {/* A phone gets the same plan as a list: semester, then each basket
          headed by what it asks for. */}
      <div className="sm:hidden">
        {rows.map((row, i) => {
          const b = row.basket;
          return (
            <Fragment key={`${b.id}-${row.course?.course_id ?? "empty"}`}>
              {row.semesterSpan !== null && (showSemester || allSemesters) && (
                <p className="bg-muted/80 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Semester {b.semester}
                </p>
              )}
              {row.basketSpan !== null && (
                <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/40 px-4 py-2">
                  {requirement(b)}
                  <span className="text-right text-xs text-muted-foreground">
                    {b.mandatory ? "Required" : "At least"} {minimum(b, true)}
                  </span>
                </div>
              )}
              {row.course ? (
                <div
                  className={cn(
                    "flex items-start gap-3 border-l-4 px-4 py-2.5",
                    departmentByCourseCode(row.course.course_code)?.stripeClass ?? "border-l-transparent",
                    rowClassName?.(row.course, b) ??
                      departmentByCourseCode(row.course.course_code)?.hoverClass,
                    i < rows.length - 1 && "border-b border-b-border/50",
                  )}
                >
                  {select && <span className="mt-0.5">{select.render(row.course, b)}</span>}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-xs">
                      <span className={codeClass(row.course.course_code)}>{row.course.course_code}</span>
                      <span className="text-muted-foreground">
                        {row.course.credits} credit{row.course.credits === 1 ? "" : "s"}
                      </span>
                    </span>
                    <span className={cn("block text-sm", titleClass(b))}>{row.course.title}</span>
                    {courseNote && (
                      <span className="mt-1 flex flex-wrap items-center gap-1.5 empty:hidden">
                        {courseNote(row.course, b)}
                      </span>
                    )}
                  </span>
                </div>
              ) : (
                <p className="px-4 py-2.5 text-sm text-muted-foreground">No courses in this basket yet.</p>
              )}
            </Fragment>
          );
        })}
        <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/60 px-4 py-2.5">
          <span className="text-sm font-semibold text-foreground">
            Minimum credit requirement for claiming the minor
          </span>
          {total}
        </div>
      </div>

      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[42rem] border-collapse text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-y border-border bg-muted/60 text-left">
              {select && (
                <th scope="col" className="w-10 px-3 py-2">
                  <span className="sr-only">{select.label}</span>
                </th>
              )}
              {showSemester && (
                <th scope="col" className="w-24 px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Semester
                </th>
              )}
              <th scope="col" className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Code
              </th>
              <th scope="col" className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Title
              </th>
              <th scope="col" className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Credits
              </th>
              <th scope="col" className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Requirement
              </th>
              <th scope="col" className="w-40 px-3 py-2 text-center text-xs font-semibold uppercase leading-tight tracking-wide text-muted-foreground">
                Minimum requirement of each basket
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const b = row.basket;
              const c = row.course;
              const dept = c ? departmentByCourseCode(c.course_code) : null;
              return (
                <tr
                  key={`${b.id}-${c?.course_id ?? "empty"}`}
                  className={cn(
                    "transition-colors",
                    c && (rowClassName?.(c, b) ?? dept?.hoverClass),
                    row.endsSemester
                      ? "border-b-2 border-border"
                      : row.endsBasket
                        ? "border-b border-border"
                        : "border-b border-border/40",
                  )}
                >
                  {select && (
                    <td className="px-3 py-2 align-top">{c && select.render(c, b)}</td>
                  )}
                  {showSemester && row.semesterSpan !== null && (
                    <td
                      rowSpan={row.semesterSpan}
                      className="border-r border-border bg-card px-3 py-2 text-center align-middle font-medium text-foreground"
                    >
                      {b.semester}
                    </td>
                  )}
                  {c ? (
                    <>
                      <td
                        className={cn(
                          "whitespace-nowrap border-l-4 px-3 py-2 align-top",
                          dept?.stripeClass ?? "border-l-transparent",
                          codeClass(c.course_code),
                        )}
                      >
                        {c.course_code}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <span className={titleClass(b)}>{c.title}</span>
                        {courseNote && (
                          <span className="mt-1 flex flex-wrap items-center gap-1.5 empty:hidden">
                            {courseNote(c, b)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center align-top tabular-nums text-foreground">
                        {c.credits}
                      </td>
                    </>
                  ) : (
                    <td colSpan={3} className="px-3 py-2 text-sm text-muted-foreground">
                      No courses in this basket yet.
                    </td>
                  )}
                  {row.basketSpan !== null && (
                    <>
                      <td
                        rowSpan={row.basketSpan}
                        className="border-l border-border bg-card px-3 py-2 align-middle"
                      >
                        {requirement(b)}
                      </td>
                      <td
                        rowSpan={row.basketSpan}
                        className="border-l border-border bg-card px-3 py-2 text-center align-middle"
                      >
                        {minimum(b)}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
            <tr className="bg-muted/40">
              <td
                colSpan={columns - 1}
                className="px-3 py-2.5 text-right text-sm font-semibold text-foreground"
              >
                Minimum credit requirement for claiming the minor
              </td>
              <td className="border-l border-border px-3 py-2 text-center align-middle">{total}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
