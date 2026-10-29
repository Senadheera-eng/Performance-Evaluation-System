import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Megaphone } from "lucide-react";
import { Button } from "../components/ui/button";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import {
  ActiveFilters,
  EmptyState,
  FilterButton,
  PageHeader,
  SearchField,
  SectionCard,
  SegmentedTabs,
  SkeletonRows,
  type ActiveFilter,
} from "../components/common";
import { cn } from "../components/ui/utils";
import { NoticeCard, categoryIcon } from "../components/notices/NoticeCard";
import { useAuth } from "../context/AuthContext";
import {
  fetchCategories,
  fetchNotices,
  fetchUnreadNoticeCounts,
  type NoticeCategory,
  type NoticeSummary,
} from "../../lib/notices";
import { useSettings } from "../../lib/settings";

const PAGE_SIZE = 20;
/* Radix's Select cannot hold an empty value, so "any" has its own. */
const ANY = "__any__";

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
  const [unreadByCategory, setUnreadByCategory] = useState<
    Record<string, number>
  >({});
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

  /* Reloaded whenever the list is, so coming back from a notice the student
     has just read shows the chip's count already down by one. */
  useEffect(() => {
    fetchUnreadNoticeCounts().then(setUnreadByCategory);
  }, [scope, category, searchTerm, semester, academicYear, includeExpired]);

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

  /* The filters in force as chips, so a short list never just looks short.
     The category's own tile shows it too, but it can be scrolled away. */
  const filterChips: ActiveFilter[] = [
    ...(category
      ? [
          {
            key: "category",
            label: categories.find((c) => c.slug === category)?.label ?? "Category",
            onRemove: () => setParam({ category: null }),
          },
        ]
      : []),
    ...(semester
      ? [{ key: "semester", label: `Semester ${semester}`, onRemove: () => setParam({ semester: null }) }]
      : []),
    ...(academicYear
      ? [{ key: "year", label: academicYear, onRemove: () => setParam({ year: null }) }]
      : []),
    ...(includeExpired
      ? [{ key: "archived", label: "Including expired", onRemove: () => setParam({ archived: null }) }]
      : []),
  ];
  // The Filters button counts what is behind it; the category is a tile.
  const panelFilters = activeFilters - (category ? 1 : 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Notices"
        description="Timetables, results, schedules and announcements — everything official, in one place."
      />

      {/* One row of controls, as on Courses: who the list is for, the
          search, and the rarer filters behind one button. */}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <SegmentedTabs
          aria-label="Notice scope"
          value={scope}
          onChange={(v) => setParam({ scope: v })}
          layoutId="notice-scope-tabs"
          className="lg:flex-shrink-0"
          tabs={[
            { value: "for_me", label: "For you" },
            { value: "all", label: "All notices" },
          ]}
        />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <SearchField
            value={searchBox}
            onChange={setSearchBox}
            placeholder="Search notices, course codes, documents…"
            label="Search notices"
          />
          <FilterButton count={panelFilters}>
            <div className="space-y-2">
              <Label htmlFor="notices-semester" className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Semester
              </Label>
              <Select
                value={semester ?? ANY}
                onValueChange={(v) => setParam({ semester: v === ANY ? null : v })}
              >
                <SelectTrigger id="notices-semester" className="h-9 w-full rounded-control border-border bg-card">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Any semester</SelectItem>
                  {semesterOptions.map((s) => (
                    <SelectItem key={s} value={String(s)}>
                      Semester {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="notices-year" className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Academic year
              </Label>
              <Select
                value={academicYear ?? ANY}
                onValueChange={(v) => setParam({ year: v === ANY ? null : v })}
              >
                <SelectTrigger id="notices-year" className="h-9 w-full rounded-control border-border bg-card">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Any year</SelectItem>
                  {/* The year in force stays a choice even when this page of
                      notices has none from it. */}
                  {(academicYear && !academicYearOptions.includes(academicYear)
                    ? [academicYear, ...academicYearOptions]
                    : academicYearOptions
                  ).map((y) => (
                    <SelectItem key={y} value={y}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-control border border-border px-3 py-2.5">
              <Label htmlFor="notices-archived" className="flex flex-col items-start gap-0.5 font-normal">
                <span className="text-sm font-medium text-foreground">Include expired notices</span>
                <span className="text-xs text-muted-foreground">Past deadlines and old timetables</span>
              </Label>
              <Switch
                id="notices-archived"
                checked={includeExpired}
                onCheckedChange={(v) => setParam({ archived: v ? "1" : null })}
              />
            </div>
          </FilterButton>
        </div>
      </div>

      <ActiveFilters filters={filterChips} onClearAll={clearAll} />

      {/* Quick access: the categories people actually come for, each with
          the unread count the sidebar's number is made of. */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Quick access
        </p>
        {/* One scrolling row on a phone. As a two-column grid the nine
            categories filled the first screen before any notice. */}
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 lg:grid-cols-5">
          {categories.slice(0, 10).map((c) => {
            const Icon = categoryIcon(c.icon);
            const active = category === c.slug;
            const unread = unreadByCategory[c.slug] ?? 0;
            return (
              <button
                key={c.slug}
                type="button"
                aria-pressed={active}
                aria-label={
                  unread > 0
                    ? `${c.label}, ${unread} unread`
                    : c.label
                }
                onClick={() => setParam({ category: active ? null : c.slug })}
                className={cn(
                  "group flex flex-shrink-0 items-center gap-2.5 whitespace-nowrap rounded-control border px-2.5 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "border-primary/40 bg-primary/10 text-foreground ring-1 ring-inset ring-primary/20"
                    : "border-border bg-card text-foreground hover:border-primary/30 hover:bg-muted/60",
                )}
              >
                <span
                  className={cn(
                    "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md transition-colors",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground group-hover:text-primary",
                  )}
                  aria-hidden="true"
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="font-medium sm:min-w-0 sm:flex-1 sm:truncate">{c.label}</span>
                {/* Says which category the sidebar's number is actually in.
                    Absent rather than zero, so a quiet category stays quiet. */}
                {unread > 0 && (
                  <span
                    aria-hidden="true"
                    className="ml-auto flex h-5 min-w-[1.25rem] flex-shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground"
                  >
                    {unread > 99 ? "99+" : unread}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

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
