import { useCallback, useEffect, useState } from "react";
import { ChevronDown, FileText } from "lucide-react";
import {
  ErrorState,
  SectionCard,
  SegmentedTabs,
  SkeletonRows,
  StatusBadge,
} from "../common";
import { supabase } from "../../../lib/supabase";
import { describeBatch } from "../../../lib/batch";

interface SheetRef {
  offering_id: string;
  course_code: string;
  course_title: string;
  semester: number;
  academic_year: string;
  batch_year: number | null;
  students: number;
  published_at: string | null;
}

interface SheetRow {
  index_number: string | null;
  name: string | null;
  grade: string | null;
  is_me: boolean;
}

interface Sheet {
  course_code: string;
  course_title: string;
  credits: number;
  semester: number;
  academic_year: string;
  batch_year: number | null;
  department: string | null;
  rows: SheetRow[];
}

/**
 * The official sheet, as it goes on the noticeboard.
 *
 * Distinct from My Results on purpose. My Results is one student's record;
 * this is the course's — every index number that sat it, against its grade,
 * the way the faculty publishes it on paper.
 *
 * Only courses this student took, and only once the department has published
 * them. Names are not shown: a published sheet is index numbers and grades,
 * and putting names beside them would expose more of a classmate's record
 * than the paper version ever did.
 */
export function PublishedResultSheets() {
  const [sheets, setSheets] = useState<SheetRef[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Record<string, Sheet>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Which semester the bar is showing; -1 until the first load picks one. */
  const [semester, setSemester] = useState(-1);

  const load = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc(
      "get_my_published_result_sheets",
    );
    if (rpcError) {
      setError("We could not load the published result sheets.");
      setLoading(false);
      return;
    }
    setSheets((data ?? []) as SheetRef[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openSheet = async (id: string) => {
    const next = open === id ? null : id;
    setOpen(next);
    if (!next || loaded[id]) return;

    const { data, error: rpcError } = await supabase.rpc(
      "get_published_result_sheet",
      { p_offering_id: id },
    );
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setLoaded((prev) => ({ ...prev, [id]: data as Sheet }));
  };

  if (loading) return <SkeletonRows count={3} height="h-14" />;
  if (sheets.length === 0 && !error) return null;

  /* One semester at a time, chosen from a bar at the top.
     Stacking every semester meant a student wanting Semester 1 scrolled past
     six of them to reach it. The RPC already returns them newest first, so the
     bar opens on the most recent. */
  const bySemester = sheets.reduce<Map<number, SheetRef[]>>((acc, s) => {
    const list = acc.get(s.semester) ?? [];
    list.push(s);
    acc.set(s.semester, list);
    return acc;
  }, new Map());
  const semesters = [...bySemester.keys()].sort((a, b) => b - a);
  const showing = semesters.includes(semester) ? semester : semesters[0];
  const rows = bySemester.get(showing) ?? [];

  return (
    <SectionCard
      title="Published result sheets"
      description="The official course sheets, as released by the department, for everyone who sat the course."
      flush
      actions={
        semesters.length > 1 ? (
          <SegmentedTabs
            aria-label="Semester"
            value={String(showing)}
            onChange={(v) => setSemester(Number(v))}
            layoutId="published-sheets-semester"
            scrollable
            tabs={semesters.map((n) => ({
              value: String(n),
              label: `Sem ${n}`,
              count: bySemester.get(n)!.length,
            }))}
          />
        ) : undefined
      }
    >
      {error && (
        <div className="p-4">
          <ErrorState message={error} size="inline" />
        </div>
      )}

      <div className="flex items-center gap-2.5 border-b border-border/70 bg-muted/40 px-4 py-2">
        <h3 className="text-sm font-semibold text-foreground">
          Semester {showing}
        </h3>
        <span className="rounded-full bg-card px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {rows.length} course{rows.length === 1 ? "" : "s"}
        </span>
        <span className="text-xs text-muted-foreground">
          {rows[0]?.academic_year}
        </span>
      </div>

      <ul className="divide-y divide-border/70">
        {rows.map((s) => (
          <li key={s.offering_id}>
            <button
              type="button"
              onClick={() => openSheet(s.offering_id)}
              className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/40"
            >
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2">
                  <FileText
                    className="h-4 w-4 flex-shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span className="text-sm font-semibold text-primary">
                    {s.course_code}
                  </span>
                  <span className="truncate text-sm text-foreground">
                    {s.course_title}
                  </span>
                </span>
                {/* Semester and year are on the group heading now, so the row
                    carries only what distinguishes it from its neighbours. */}
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {s.batch_year ? `${describeBatch(s.batch_year)} · ` : ""}
                  {s.students} student{s.students === 1 ? "" : "s"}
                </span>
              </span>
              <ChevronDown
                className={`h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform ${
                  open === s.offering_id ? "rotate-180" : ""
                }`}
                aria-hidden="true"
              />
            </button>

            {open === s.offering_id && (
              <div className="border-t border-border/70 bg-muted/20 px-4 py-3">
                {!loaded[s.offering_id] ? (
                  <SkeletonRows count={4} height="h-8" />
                ) : (
                  <>
                    <p className="mb-2 text-xs text-muted-foreground">
                      {loaded[s.offering_id].department} ·{" "}
                      {loaded[s.offering_id].credits} credits · released by the
                      department
                    </p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border/70 text-left text-xs text-muted-foreground">
                            <th className="pb-1.5 pr-4 font-medium">
                              Index No.
                            </th>
                            <th className="pb-1.5 pr-4 font-medium">Name</th>
                            <th className="pb-1.5 font-medium">Grade</th>
                          </tr>
                        </thead>
                        <tbody>
                          {loaded[s.offering_id].rows.map((r, i) => (
                            <tr
                              key={`${r.index_number}-${i}`}
                              className={
                                r.is_me
                                  ? "bg-primary/10 font-semibold"
                                  : undefined
                              }
                            >
                              <td className="whitespace-nowrap py-1.5 pr-4 tabular-nums text-foreground">
                                {r.index_number ?? "—"}
                                {r.is_me && (
                                  <StatusBadge tone="brand" className="ml-2">
                                    You
                                  </StatusBadge>
                                )}
                              </td>
                              <td className="py-1.5 pr-4 text-foreground">
                                {r.name ?? "—"}
                              </td>
                              <td className="py-1.5 text-foreground">
                                {r.grade ?? "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
