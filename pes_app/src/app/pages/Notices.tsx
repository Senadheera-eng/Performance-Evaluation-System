import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Megaphone, Search, SlidersHorizontal, X } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  EmptyState,
  PageHeader,
  SectionCard,
  SegmentedTabs,
  SkeletonRows,
} from "../components/common";
import { NoticeCard, categoryIcon } from "../components/notices/NoticeCard";
import { useAuth } from "../context/AuthContext";
import {
  fetchCategories,
  fetchNotices,
  type NoticeCategory,
  type NoticeSummary,
} from "../../lib/notices";
import { useSettings } from "../../lib/settings";

const PAGE_SIZE = 20;

/**
 * The academic notice board, as a student reads it.
 *
 * The proposal's complaint was that "academic records, examination results,
 * course details, and timetables are dispersed across multiple systems and
 * communication channels" — so the job of this page is to be the one place,
 * and the job of everything on it is to get somebody to the right document in
 * as few decisions as possible.
 *
 * Three ways in, deliberately, because people arrive knowing different
 * things. Quick Access is for "I want the exam timetable". Search is for "I
 * know roughly what it was called". For You is for "what should I know
 * about?" — and it is the default, because that is the commonest visit.
 *
 * None of the filtering happens here. The database decides what this student
 * may see and what is relevant to them, and returns one page at a time; a
 * page that fetched everything and hid most of it in React would be both
 * slow and, more importantly, not a boundary at all.
 */
export default function Notices() {
  const navigate = useNavigate();
  const { student } = useAuth();
  const settings = useSettings();
  const [params, setParams] = useSearchParams();

  const [categories, setCategories] = useState<NoticeCategory[]>([]);
  const [items, setItems] = useState<NoticeSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  /* The URL owns the view, so a filtered board can be linked and the back
     button behaves the way people expect after opening a notice. */
  const scope = (params.get("scope") ?? "for_me") as "for_me" | "all";
  const category = params.get("category");
  const searchTerm = params.get("q") ?? "";
  const semester = params.get("semester");
  const academicYear = params.get("year");
  const includeExpired = params.get("archived") === "1";

  const [searchBox, setSearchBox] = useState(searchTerm);
  const [showFilters, setShowFilters] = useState(
    Boolean(semester || academicYear || includeExpired),
  );

  const setParam = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "") next.delete(k);
        else next.set(k, v);
      }
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  useEffect(() => {
    fetchCategories().then(setCategories);
  }, []);

  /* Debounced so typing does not fire a query per keystroke. */
  useEffect(() => {
    const id = window.setTimeout(() => {
      if (searchBox !== searchTerm) setParam({ q: searchBox || null });
    }, 300);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchBox]);

  const load = useCallback(
    async (offset: number) => {
      if (offset === 0) setLoading(true);
      else setLoadingMore(true);

      const { items: page, total: count } = await fetchNotices({
        scope,
        category,
        semester: semester ? Number(semester) : null,
        academicYear,
        includeExpired,
        search: searchTerm,
        limit: PAGE_SIZE,
        offset,
      });

      setItems((prev) => (offset === 0 ? page : [...prev, ...page]));
      setTotal(count);
      setLoading(false);
      setLoadingMore(false);
    },
    [scope, category, semester, academicYear, includeExpired, searchTerm],
  );

  useEffect(() => {
    load(0);
  }, [load]);

  const semesterOptions = useMemo(
    () => Array.from({ length: settings.totalSemesters }, (_, i) => i + 1),
    [settings.totalSemesters],
  );

  const academicYearOptions = useMemo(() => {
    const years = new Set<string>();
    for (const n of items) if (n.academic_year) years.add(n.academic_year);
    return [...years].sort().reverse();
  }, [items]);

  const activeFilters =
    (category ? 1 : 0) +
    (semester ? 1 : 0) +
    (academicYear ? 1 : 0) +
    (includeExpired ? 1 : 0);

  const clearAll = () =>
    setParams(new URLSearchParams({ scope }), { replace: true });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Notices"
        description="Timetables, results, schedules and announcements — everything official, in one place."
      />

      {/* Search */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={searchBox}
            onChange={(e) => setSearchBox(e.target.value)}
            placeholder="Search notices, course codes, documents..."
            aria-label="Search notices"
            className="h-10 bg-card pl-9"
          />
          {searchBox && (
            <button
              type="button"
              onClick={() => setSearchBox("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <Button
          variant={activeFilters > 0 ? "default" : "outline"}
          onClick={() => setShowFilters((v) => !v)}
          aria-expanded={showFilters}
          className="sm:w-auto"
        >
          <SlidersHorizontal className="mr-1.5 h-4 w-4" />
          Filter{activeFilters > 0 ? ` (${activeFilters})` : ""}
        </Button>
      </div>

      {/* Quick access — the six things people actually come for. */}
      <div>
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          Quick access
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {categories.slice(0, 10).map((c) => {
            const Icon = categoryIcon(c.icon);
            const active = category === c.slug;
            return (
              <button
                key={c.slug}
                type="button"
                aria-pressed={active}
                onClick={() => setParam({ category: active ? null : c.slug })}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors ${
                  active
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-card text-muted-foreground hover:bg-muted"
                }`}
              >
                <Icon className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                <span className="truncate">{c.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {showFilters && (
        <SectionCard title="Filters">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">
                Semester
              </span>
              <select
                value={semester ?? "all"}
                onChange={(e) =>
                  setParam({
                    semester: e.target.value === "all" ? null : e.target.value,
                  })
                }
                className="h-9 rounded-xl border border-border bg-card px-3 text-sm text-foreground"
              >
                <option value="all">Any semester</option>
                {semesterOptions.map((s) => (
                  <option key={s} value={s}>
                    Semester {s}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">
                Academic year
              </span>
              <select
                value={academicYear ?? "all"}
                onChange={(e) =>
                  setParam({
                    year: e.target.value === "all" ? null : e.target.value,
                  })
                }
                className="h-9 rounded-xl border border-border bg-card px-3 text-sm text-foreground"
              >
                <option value="all">Any year</option>
                {academicYearOptions.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col justify-end gap-1">
              <span className="text-xs font-medium text-muted-foreground">
                Archive
              </span>
              <button
                type="button"
                aria-pressed={includeExpired}
                onClick={() =>
                  setParam({ archived: includeExpired ? null : "1" })
                }
                className={`h-9 rounded-xl border px-3 text-sm transition-colors ${
                  includeExpired
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-card text-muted-foreground hover:bg-muted"
                }`}
              >
                {includeExpired ? "Showing expired notices" : "Hide expired notices"}
              </button>
            </label>
          </div>

          {activeFilters > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={clearAll}
            >
              Clear all filters
            </Button>
          )}
        </SectionCard>
      )}

      <SegmentedTabs
        aria-label="Notice scope"
        value={scope}
        onChange={(v) => setParam({ scope: v })}
        layoutId="notice-scope-tabs"
        tabs={[
          { value: "for_me", label: "For you" },
          { value: "all", label: "All notices" },
        ]}
      />

      <SectionCard
        title={
          category
            ? (categories.find((c) => c.slug === category)?.label ?? "Notices")
            : scope === "for_me"
              ? "Relevant to you"
              : "All notices"
        }
        description={
          loading
            ? undefined
            : `${total} notice${total === 1 ? "" : "s"}${
                scope === "for_me" && student?.batch_year
                  ? ` · ${student.department ?? "Faculty"}, Batch ${student.batch_year}`
                  : ""
              }`
        }
        flush
      >
        {loading ? (
          <div className="p-4">
            <SkeletonRows count={5} height="h-16" />
          </div>
        ) : items.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={Megaphone}
              title={
                searchTerm || activeFilters > 0
                  ? "Nothing matches that"
                  : scope === "for_me"
                    ? "Nothing new for you right now"
                    : "No notices yet"
              }
              description={
                searchTerm || activeFilters > 0
                  ? "Try a different search, or clear the filters."
                  : scope === "for_me"
                    ? "When your department publishes a timetable, a result sheet or an announcement for your batch, it appears here."
                    : "Official academic information published by the faculty will appear here."
              }
              action={
                activeFilters > 0 || searchTerm ? (
                  <Button variant="outline" onClick={clearAll}>
                    Clear filters
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <>
            <ul className="divide-y divide-border/60">
              {items.map((n) => (
                <li key={n.id}>
                  <NoticeCard
                    notice={n}
                    onOpen={(id) => navigate(`/app/notices/${id}`)}
                  />
                </li>
              ))}
            </ul>

            {items.length < total && (
              <div className="border-t border-border/60 p-3">
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={loadingMore}
                  onClick={() => load(items.length)}
                >
                  {loadingMore
                    ? "Loading..."
                    : `Show more (${total - items.length} left)`}
                </Button>
              </div>
            )}
          </>
        )}
      </SectionCard>
    </div>
  );
}
