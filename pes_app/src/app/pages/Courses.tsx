import { useState, useEffect } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { BookOpen, ChevronDown } from "lucide-react";
import {
  CourseListRow,
  type CourseListItem,
  type CourseStatus,
} from "../components/courses/CourseListRow";
import { CourseDetailDialog } from "../components/courses/CourseDetailDialog";
import {
  ActiveFilters,
  DepartmentChips,
  EmptyState,
  FilterButton,
  PageHeader,
  SearchField,
  SegmentedTabs,
  useExpandMotion,
  type ActiveFilter,
} from "../components/common";
import { cn } from "../components/ui/utils";
import {
  DEPARTMENTS,
  departmentByCourseCode,
  departmentByName,
  type DepartmentKey,
} from "../../lib/departments";
import { Button } from "../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { getMyAttendance } from "../../lib/studentAttendance";
import { MyMinor } from "../components/courses/MyMinor";
import type { StudentMinorPlan } from "../../lib/minorPlan";

interface Course {
  id: string;
  code: string;
  name: string;
  credits: number;
  status: "ongoing" | "completed" | "upcoming" | "not_recorded";
  attendance?: number;
  grade?: string;
  progress?: number;
  category: string;
  minor_category: string | null;
  semester: number;
  year: number;
}

export default function Courses() {
  const { student } = useAuth();
  const reduce = useReducedMotion();
  const [allCourses, setAllCourses] = useState<Course[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const [semesterFilter, setSemesterFilter] = useState<string>("all");
  /* One department's courses at a time, from the colour key: the student's
     own department, or the shared Interdisciplinary modules. */
  const [deptFilter, setDeptFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /* Opening a course tells the student how it is marked, which is the one
     thing about a course they cannot work out from their own grade. */
  const [detailId, setDetailId] = useState<string | null>(null);
  /* The department's minors with where the student stands in each. Null
     until loaded; a department with no minors gets no Minor view at all. */
  const [minorPlan, setMinorPlan] = useState<
    (StudentMinorPlan & { current_semester: number }) | null
  >(null);
  const [view, setView] = useState<"courses" | "minor">("courses");
  /* Semester groups the student has opened or closed by hand. Forgotten
     whenever the list is narrowed, so a search always shows what it found. */
  const [openGroups, setOpenGroups] = useState<Record<number, boolean>>({});
  useEffect(() => {
    setOpenGroups({});
  }, [searchQuery, activeTab, semesterFilter, deptFilter]);

  const loadMinorPlan = async () => {
    const { data, error } = await supabase.rpc("get_my_minor_progress");
    if (error || !data) return;
    setMinorPlan(data as StudentMinorPlan & { current_semester: number });
  };

  useEffect(() => {
    if (!student?.id) return;
    fetchCourses();
    loadMinorPlan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student?.id]);

  const hasMinors = (minorPlan?.minors.length ?? 0) > 0;

  const fetchCourses = async () => {
    setLoading(true);

    // Ongoing courses: the student's active enrollment for the current semester.
    const { data: enrollments } = await supabase
      .from("enrollments")
      .select(
        `
        course_id,
        courses (
          id,
          course_code,
          title,
          credits,
          semester,
          year,
          category,
          minor_category
        )
      `,
      )
      .eq("student_id", student!.id)
      .eq("status", "enrolled");

    const enrolledIds = (enrollments ?? []).map((e: any) => e.course_id);

    // Attendance belongs to the delivery the student is sitting now. A course
    // being repeated has an earlier register too, and averaging the two
    // together described neither term.
    const attendanceMap: Record<string, number> = {};
    if (enrolledIds.length > 0) {
      const attendance = await getMyAttendance();
      if (attendance.ok) {
        attendance.data.deliveries
          .filter((d) => d.is_latest_attempt && d.percentage !== null)
          .forEach((d) => {
            attendanceMap[d.course_id] = Math.round(d.percentage!);
          });
      }
    }

    const progressMap: Record<string, number> = {};
    if (enrolledIds.length > 0) {
      // Continuous-assessment progress. Unpublished drafts are the lecturer's
      // working copy and have never been readable here, so this only ever
      // shows courses whose marks the department has already released.
      const { data: currentResults } = await supabase
        .from("my_published_results")
        .select("course_id, mid_sem_mark, ca_mark")
        .in("course_id", enrolledIds)
        // A repeated course has an earlier attempt's marks too; the attempt
        // being sat now is the one this progress bar is about.
        .eq("is_latest_attempt", true);

      currentResults?.forEach((r: any) => {
        if (r.mid_sem_mark !== null && r.ca_mark !== null) {
          progressMap[r.course_id] = Math.min(
            100,
            Math.round(((r.mid_sem_mark + r.ca_mark) / 90) * 100),
          );
        }
      });
    }

    const ongoingCourses: Course[] = (enrollments ?? []).map((e: any) => {
      const c = e.courses;
      return {
        id: c.id,
        code: c.course_code,
        name: c.title,
        credits: c.credits,
        status: "ongoing" as const,
        attendance: attendanceMap[c.id],
        progress: progressMap[c.id],
        category: c.category,
        minor_category: c.minor_category,
        semester: c.semester,
        year: c.year,
      };
    });

    // Completed courses: published results are the authoritative record of
    // "did the student finish this course" — unlike `enrollments`, this isn't
    // missing rows for semesters that were bulk-imported directly into `results`.
    const { data: resultsData } = await supabase
      .from("my_published_results")
      .select(
        "course_id, grade, course_code, course_title, credits, semester, course_year, category, minor_category",
      )
      .not("grade", "is", null);

    const completedCourses: Course[] = (resultsData ?? [])
      .filter((r: any) => !enrolledIds.includes(r.course_id))
      .map((r: any) => ({
        id: r.course_id,
        code: r.course_code,
        name: r.course_title,
        credits: r.credits,
        status: "completed" as const,
        grade: r.grade,
        category: r.category,
        minor_category: r.minor_category,
        semester: r.semester,
        year: r.course_year,
      }));

    // Remaining catalogue courses: everything in the student's own curriculum
    // (their department plus shared Interdisciplinary Studies courses) that
    // they haven't taken or aren't currently taking.
    const { data: catalogueData } = await supabase
      .from("courses")
      .select(
        "id, course_code, title, credits, semester, year, category, minor_category",
      )
      .in("department", [
        student!.department ?? "",
        "Interdisciplinary Studies",
      ]);

    const knownIds = new Set([
      ...enrolledIds,
      ...(resultsData ?? []).map((r: any) => r.course_id),
    ]);

    // The furthest semester we have *actual evidence* for — an active
    // enrollment or a published graded result. A leftover catalogue course is
    // only genuinely "upcoming" if it sits beyond that point. Below it, the
    // student has clearly already been through that semester; a missing
    // record there just means no result has been entered for that specific
    // course, which is a data gap, not a future course. Conflating the two
    // is what made semester 1/2 courses show up as "Upcoming" long after
    // graduation from those semesters.
    const furthestKnownSemester = Math.max(
      0,
      ...ongoingCourses.map((c) => c.semester),
      ...completedCourses.map((c) => c.semester),
    );

    const upcomingCourses: Course[] = [];
    const notRecordedCourses: Course[] = [];

    (catalogueData ?? [])
      .filter((c: any) => !knownIds.has(c.id))
      .forEach((c: any) => {
        const course: Course = {
          id: c.id,
          code: c.course_code,
          name: c.title,
          credits: c.credits,
          status:
            c.semester > furthestKnownSemester ? "upcoming" : "not_recorded",
          category: c.category,
          minor_category: c.minor_category,
          semester: c.semester,
          year: c.year,
        };
        (course.status === "upcoming" ? upcomingCourses : notRecordedCourses).push(
          course,
        );
      });

    const courses: Course[] = [
      ...ongoingCourses,
      ...completedCourses,
      ...notRecordedCourses,
      ...upcomingCourses,
    ];

    const statusOrder: Record<Course["status"], number> = {
      ongoing: 0,
      completed: 1,
      not_recorded: 2,
      upcoming: 3,
    };
    courses.sort((a, b) => {
      if (a.status !== b.status) return statusOrder[a.status] - statusOrder[b.status];
      if (a.status === "completed") return b.semester - a.semester;
      return a.semester - b.semester;
    });

    setAllCourses(courses);
    setLoading(false);
  };

  const filteredCourses = allCourses.filter((course) => {
    const matchesSearch =
      course.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      course.code.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesSemester =
      semesterFilter === "all" || course.semester === Number(semesterFilter);
    if (!matchesSearch || !matchesSemester) return false;
    if (deptFilter && departmentByCourseCode(course.code)?.name !== deptFilter) return false;
    if (activeTab === "all") return true;
    if (activeTab === "ongoing") return course.status === "ongoing";
    if (activeTab === "completed") return course.status === "completed";
    if (activeTab === "upcoming") return course.status === "upcoming";
    if (activeTab === "not_recorded") return course.status === "not_recorded";
    return true;
  });

  const semesterOptions = Array.from(
    new Set(allCourses.map((c) => c.semester)),
  ).sort((a, b) => a - b);

  const coursesBySemester = semesterOptions
    .map((sem) => ({
      semester: sem,
      courses: filteredCourses.filter((c) => c.semester === sem),
    }))
    .filter((group) => group.courses.length > 0)
    .sort((a, b) => b.semester - a.semester);

  /* The departments this curriculum draws on, own department first, each
     with how many of its courses are in the list. */
  const ownKey = departmentByName(student?.department)?.key;
  const deptCounts = new Map<DepartmentKey, number>();
  for (const c of allCourses) {
    const k = departmentByCourseCode(c.code)?.key;
    if (k) deptCounts.set(k, (deptCounts.get(k) ?? 0) + 1);
  }
  const curriculumDepts = [...deptCounts.entries()]
    .sort(([a, na], [b, nb]) =>
      a === ownKey ? -1 : b === ownKey ? 1 : nb - na,
    )
    .map(([key, n]) => ({ dept: DEPARTMENTS[key], n }));

  const stats = {
    all: allCourses.length,
    ongoing: allCourses.filter((c) => c.status === "ongoing").length,
    completed: allCourses.filter((c) => c.status === "completed").length,
    upcoming: allCourses.filter((c) => c.status === "upcoming").length,
    notRecorded: allCourses.filter((c) => c.status === "not_recorded").length,
  };

  // No counts until the courses arrive: a row of noughts while loading
  // reads as "you have no courses".
  const count = (n: number) => (loading ? undefined : n);
  const tabs = [
    { value: "all", label: "All", count: count(stats.all) },
    { value: "ongoing", label: "Ongoing", count: count(stats.ongoing) },
    { value: "completed", label: "Completed", count: count(stats.completed) },
    { value: "upcoming", label: "Upcoming", count: count(stats.upcoming) },
    { value: "not_recorded", label: "Not Recorded", count: count(stats.notRecorded) },
  ];

  const activeFilters: ActiveFilter[] = [
    ...(deptFilter
      ? [{ key: "dept", label: deptFilter, onRemove: () => setDeptFilter(null) }]
      : []),
    ...(semesterFilter !== "all"
      ? [{ key: "sem", label: `Semester ${semesterFilter}`, onRemove: () => setSemesterFilter("all") }]
      : []),
  ];

  /* The semester being taught now opens; the rest wait behind one line each.
     Once the student narrows the list (a search, a filter, a status tab)
     every group that is left opens, since those are what they asked for. */
  const currentSemester = allCourses.some((c) => c.status === "ongoing")
    ? Math.max(...allCourses.filter((c) => c.status === "ongoing").map((c) => c.semester))
    : null;
  const narrowed =
    searchQuery !== "" || activeTab !== "all" || semesterFilter !== "all" || deptFilter !== null;
  const defaultOpen = (semester: number) =>
    narrowed ||
    (currentSemester !== null
      ? semester === currentSemester
      : semester === coursesBySemester[0]?.semester);
  const isOpen = (semester: number) => openGroups[semester] ?? defaultOpen(semester);
  const allOpen = coursesBySemester.every((g) => isOpen(g.semester));

  return (
    <div className="space-y-5">
      <PageHeader
        title="My Courses"
        description="Every course in your curriculum: what you are taking now, what you have finished, and what is still to come."
      />

      {/* The courses, or the minor the student is taking -- its whole study
          plan, as the department prints it. */}
      {hasMinors && (
        <SegmentedTabs
          aria-label="Courses or minor"
          layoutId="courses-view-tabs"
          value={view}
          onChange={(v) => setView(v as "courses" | "minor")}
          equal
          className="w-full sm:w-80"
          tabs={[
            { value: "courses", label: "My Courses" },
            /* "Minor", not the minor's name: the view is the same for every
               minor, and the name is the first thing it shows. */
            { value: "minor", label: "Minor" },
          ]}
        />
      )}

      {view === "minor" && minorPlan && hasMinors ? (
        <MyMinor
          plan={minorPlan}
          semester={minorPlan.current_semester}
          onChanged={loadMinorPlan}
        />
      ) : (
        <>
      {/* One row of controls: the status tabs, the search, and the rest
          behind Filters. The department chips, the key to the stripe on every
          row, and the semester picker wait in there until wanted. */}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <SegmentedTabs
          tabs={tabs}
          value={activeTab}
          onChange={setActiveTab}
          layoutId="courses-tab-indicator"
          scrollable
          className="lg:flex-shrink-0"
          aria-label="Filter courses by status"
        />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <SearchField
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search by name or code"
            label="Search courses"
          />
          <FilterButton count={activeFilters.length}>
            {!loading && curriculumDepts.length > 1 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Department
                </p>
                <DepartmentChips
                  items={curriculumDepts.map(({ dept, n }) => ({ name: dept.name, count: n }))}
                  value={deptFilter}
                  onChange={setDeptFilter}
                  total={allCourses.length}
                  ariaLabel="Show courses from"
                  wrap
                />
              </div>
            )}
            <div className="space-y-2">
              <label
                htmlFor="courses-semester-filter"
                className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                Semester
              </label>
              <Select value={semesterFilter} onValueChange={setSemesterFilter}>
                <SelectTrigger id="courses-semester-filter" className="h-9 w-full">
                  <SelectValue placeholder="Filter by semester" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Semesters</SelectItem>
                  {semesterOptions.map((sem) => (
                    <SelectItem key={sem} value={String(sem)}>
                      Semester {sem}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </FilterButton>
        </div>
      </div>

      <ActiveFilters
        filters={activeFilters}
        onClearAll={() => {
          setSemesterFilter("all");
          setDeptFilter(null);
        }}
      />

      <div className="w-full">
        {/* Tab Content — keyed on the active tab so switching tabs plays a
            real transition (the panel slides out, the new one slides in and
            its rows stagger). Without the key, rows shared between two tabs
            stay mounted and nothing visibly happens on the switch. */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={activeTab}
            initial={reduce ? { opacity: 0 } : { opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, x: -16 }}
            transition={{ duration: reduce ? 0 : 0.18, ease: [0.4, 0, 0.2, 1] }}
          >
            {loading ? (
              <div className="grid grid-cols-1 gap-1.5 xl:grid-cols-2 min-[1700px]:grid-cols-3">
                {Array.from({ length: 12 }, (_, i) => (
                  <div
                    key={i}
                    className="skeleton-shimmer h-[38px] rounded-control bg-muted"
                  />
                ))}
              </div>
            ) : filteredCourses.length === 0 ? (
              <EmptyState
                icon={BookOpen}
                title={
                  allCourses.length === 0
                    ? "No courses to show yet"
                    : "No courses match"
                }
                description={
                  allCourses.length === 0
                    ? "Your curriculum appears here once your department's catalogue and your enrolments are recorded."
                    : "Nothing in this view matches your search or semester filter."
                }
                action={
                  allCourses.length > 0 &&
                  (searchQuery !== "" || semesterFilter !== "all" || deptFilter !== null) ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setSearchQuery("");
                        setSemesterFilter("all");
                        setDeptFilter(null);
                      }}
                    >
                      Clear search and filter
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <p>
                    {filteredCourses.length} course{filteredCourses.length === 1 ? "" : "s"} in{" "}
                    {coursesBySemester.length} semester{coursesBySemester.length === 1 ? "" : "s"}
                  </p>
                  {coursesBySemester.length > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        const next = !allOpen;
                        setOpenGroups(
                          Object.fromEntries(coursesBySemester.map((g) => [g.semester, next])),
                        );
                      }}
                      className="text-xs font-medium text-primary underline-offset-2 hover:underline"
                    >
                      {allOpen ? "Collapse all" : "Expand all"}
                    </button>
                  )}
                </div>
                {coursesBySemester.map((group) => (
                  <SemesterGroup
                    key={group.semester}
                    semester={group.semester}
                    courses={group.courses}
                    open={isOpen(group.semester)}
                    onToggle={() =>
                      setOpenGroups((prev) => ({ ...prev, [group.semester]: !isOpen(group.semester) }))
                    }
                    onOpenCourse={setDetailId}
                  />
                ))}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
        </>
      )}

      <CourseDetailDialog
        courseId={detailId}
        onOpenChange={(open) => !open && setDetailId(null)}
      />
    </div>
  );
}

const GROUP_STATUS_ORDER: { status: CourseStatus; label: string }[] = [
  { status: "ongoing", label: "ongoing" },
  { status: "completed", label: "completed" },
  { status: "not_recorded", label: "not recorded" },
  { status: "upcoming", label: "upcoming" },
];

/**
 * One semester of the curriculum: a header that says what is in it, and the
 * courses under it, opening and closing with an animation. The header stays
 * pinned while its courses scroll past, so a row is never far from the
 * semester it belongs to.
 */
function SemesterGroup({
  semester,
  courses,
  open,
  onToggle,
  onOpenCourse,
}: {
  semester: number;
  courses: CourseListItem[];
  open: boolean;
  onToggle: () => void;
  onOpenCourse: (id: string) => void;
}) {
  const expand = useExpandMotion();
  const bodyId = `courses-semester-${semester}`;
  const credits = courses.reduce((n, c) => n + c.credits, 0);
  const breakdown = GROUP_STATUS_ORDER.map(({ status, label }) => ({
    label,
    n: courses.filter((c) => c.status === status).length,
  }))
    .filter((b) => b.n > 0)
    .map((b) => `${b.n} ${b.label}`)
    .join(" · ");

  return (
    <section>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={bodyId}
        className={cn(
          "sticky top-14 z-10 flex w-full items-center gap-2.5 rounded-control border border-border bg-card/95 px-3 py-2.5 text-left backdrop-blur-sm transition-colors hover:bg-muted/60",
          open && "mb-2",
        )}
      >
        <ChevronDown
          className={cn(
            "h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform duration-200",
            !open && "-rotate-90",
          )}
          aria-hidden="true"
        />
        <h3 className="text-sm font-semibold text-foreground">Semester {semester}</h3>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {courses.length} course{courses.length !== 1 ? "s" : ""}
        </span>
        <span className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground sm:block">
          {breakdown}
        </span>
        <span className="ml-auto flex-shrink-0 text-xs tabular-nums text-muted-foreground">
          {credits} cr
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={bodyId}
            key="body"
            variants={expand}
            initial="collapsed"
            animate="open"
            exit="collapsed"
            className="overflow-hidden"
          >
            {/* Two across from xl, three only on genuinely wide screens.
                Three columns any earlier leaves each cell too narrow and
                every course title truncates. */}
            <div className="grid grid-cols-1 gap-1.5 pb-1 xl:grid-cols-2 min-[1700px]:grid-cols-3">
              {courses.map((course, index) => (
                <CourseListRow
                  key={course.id}
                  course={course}
                  index={index}
                  onClick={() => onOpenCourse(course.id)}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
