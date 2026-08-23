import { useCallback, useEffect, useState } from "react";
import { ChevronDown, FileText } from "lucide-react";
import {
  ErrorState,
  SectionCard,
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

  return (
    <SectionCard
      title="Published result sheets"
      description="The official course sheets, as released by the department. Index numbers and grades for everyone who sat the course."
      flush
    >
      {error && (
        <div className="p-4">
          <ErrorState message={error} size="inline" />
        </div>
      )}

      <ul className="divide-y divide-border/70">
        {sheets.map((s) => (
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
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Semester {s.semester} · {s.academic_year}
                  {s.batch_year ? ` · ${describeBatch(s.batch_year)}` : ""} ·{" "}
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
                              <td className="py-1.5 pr-4 tabular-nums text-foreground">
                                {r.index_number ?? "—"}
                                {r.is_me && (
                                  <StatusBadge tone="brand" className="ml-2">
                                    You
                                  </StatusBadge>
                                )}
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
