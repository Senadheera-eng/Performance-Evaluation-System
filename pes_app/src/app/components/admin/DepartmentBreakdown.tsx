import { useEffect, useState } from "react";
import { DepartmentDot, SectionCard, SkeletonRows } from "../common";
import { supabase } from "../../../lib/supabase";
import { DEPARTMENTS, departmentByName } from "../../../lib/departments";
import { cn } from "../ui/utils";

interface Row {
  name: string;
  students: number;
  courses: number;
}

/**
 * Students and courses by department, for the Super Admin's dashboard.
 *
 * Each department is a row in its Handbook colour, with a bar for its share
 * of the faculty's students. Students not yet divided into a department (a
 * first-year) get a neutral row of their own, so the rows add up to the
 * total above.
 */
export function DepartmentBreakdown() {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ data: students }, { data: courses }] = await Promise.all([
        supabase
          .from("students")
          .select("department")
          .eq("role", "student")
          .eq("status", "active"),
        supabase.from("courses").select("department"),
      ]);
      if (cancelled) return;

      const byName = new Map<string, Row>();
      const get = (name: string) => {
        let row = byName.get(name);
        if (!row) {
          row = { name, students: 0, courses: 0 };
          byName.set(name, row);
        }
        return row;
      };
      // Every department appears, even one with no students (IS teaches
      // every student but admits none).
      for (const d of Object.values(DEPARTMENTS)) get(d.name);
      for (const s of students ?? []) get(s.department ?? "No department yet").students++;
      for (const c of courses ?? []) if (c.department) get(c.department).courses++;

      setRows(
        [...byName.values()].sort((a, b) =>
          !departmentByName(a.name) ? 1 : !departmentByName(b.name) ? -1 : b.students - a.students || a.name.localeCompare(b.name),
        ),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const maxStudents = Math.max(1, ...(rows ?? []).map((r) => r.students));

  return (
    <SectionCard
      title="By department"
      description="Active students and catalogue courses in each department."
      flush
    >
      {rows === null ? (
        <div className="p-4">
          <SkeletonRows count={5} height="h-10" />
        </div>
      ) : (
        <ul className="divide-y divide-border/70">
          {rows.map((r) => {
            const dept = departmentByName(r.name);
            return (
              <li
                key={r.name}
                className={cn(
                  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 border-l-4 px-4 py-2.5 transition-colors sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)_auto]",
                  dept ? cn(dept.stripeClass, dept.hoverClass) : "border-l-transparent hover:bg-muted/50",
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  {dept ? (
                    <DepartmentDot dept={dept} className="h-2.5 w-2.5" />
                  ) : (
                    <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full bg-muted-foreground/40" aria-hidden="true" />
                  )}
                  <span className={cn("truncate text-sm font-medium", dept?.textClass ?? "text-muted-foreground")}>
                    {r.name}
                  </span>
                </span>
                {/* The share of the faculty's students, in the department's
                    colour. Hidden on a phone, where the numbers say it. */}
                <span
                  className="hidden h-2 w-full overflow-hidden rounded-full bg-muted sm:block"
                  role="img"
                  aria-label={`${r.students} students`}
                >
                  <span
                    className={cn("block h-full rounded-full", dept?.swatchClass ?? "bg-muted-foreground/40")}
                    style={{ width: `${(r.students / maxStudents) * 100}%` }}
                  />
                </span>
                <span className="text-right text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                  <span className="font-semibold text-foreground">{r.students}</span> students
                  {dept && (
                    <>
                      {" · "}
                      <span className="font-semibold text-foreground">{r.courses}</span> courses
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
