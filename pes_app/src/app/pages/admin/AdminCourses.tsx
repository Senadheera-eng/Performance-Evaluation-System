import { useEffect, useMemo, useState } from "react";
import { Search, BookOpen, Pencil, Plus } from "lucide-react";
import { Button } from "../../components/ui/button";
import {
  CourseEditorDialog,
  type EditableCourse,
} from "../../components/courses/CourseEditorDialog";
import { MinorSpecifications } from "../../components/courses/MinorSpecifications";
import { Input } from "../../components/ui/input";
import {
  DepartmentName,
  DepartmentSelect,
  EmptyState,
  PageHeader,
  SectionCard,
  SegmentedTabs,
  SkeletonRows,
  StatusBadge,
} from "../../components/common";
import { cn } from "../../components/ui/utils";
import { departmentByCourseCode } from "../../../lib/departments";
import { supabase } from "../../../lib/supabase";
import { useAuth } from "../../context/AuthContext";
import {
  getAdminScope,
  describeAdminScope,
  type AdminScope,
} from "../../../lib/adminScope";

interface Course {
  id: string;
  code: string;
  name: string;
  credits: number;
  semester: number;
  year: number;
  department: string;
  category: string;
  minorCategory: string | null;
  contributesToGpa: boolean;
  enrolledCount: number;
  caWeight: number;
  eseWeight: number;
}

/**
 * A department's catalogue, and the minors built out of it.
 *
 * Two jobs, two tabs: the courses themselves, and the streams a course can
 * belong to. They were one page, which put a minors panel between the stats
 * and the course list on every visit, most of which are about a course.
 *
 * The same screen serves the department office and the sitting head of
 * department, who reaches it from the staff portal — row security has always
 * let both write their department's courses and minors, so the page takes the
 * department it is working in rather than assuming the signed-in role.
 */
export function CourseManagement({
  departmentOverride,
}: {
  /** Set when a head of department opens this from the staff portal. */
  departmentOverride?: string;
}) {
  const { student } = useAuth();
  const [tab, setTab] = useState<"courses" | "minors">("courses");
  const scope: AdminScope = departmentOverride
    ? { kind: "department", department: departmentOverride }
    : getAdminScope(student);
  const [courses, setCourses] = useState<Course[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterSemester, setFilterSemester] = useState<number | "all">("all");
  /* The super admin sees every department's catalogue, 200-odd courses;
     this narrows it to one. A department admin has only their own. */
  const [filterDepartment, setFilterDepartment] = useState<string>("all");
  /* Which department's minors a super admin is editing. */
  const [minorsDepartment, setMinorsDepartment] = useState("");
  const [loading, setLoading] = useState(true);
  /* A department owns its catalogue: the RLS policy on courses has always let
     a department admin and its head write it, and nothing on this page ever
     did. Null means the dialog is creating rather than editing. */
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<EditableCourse | null>(null);

  const toEditable = (c: Course): EditableCourse => ({
    id: c.id,
    course_code: c.code,
    title: c.name,
    credits: c.credits,
    semester: c.semester,
    year: c.year,
    department: c.department,
    category: c.category,
    minor_category: c.minorCategory,
    contributes_to_gpa: c.contributesToGpa,
    ca_weight: c.caWeight,
    ese_weight: c.eseWeight,
  });

  useEffect(() => {
    if (student) fetchCourses();
  }, [student]);

  const fetchCourses = async () => {
    setLoading(true);

    let courseQuery = supabase
      .from("courses")
      .select("*")
      .order("semester")
      .order("course_code");
    if (scope.kind === "department") {
      courseQuery = courseQuery.eq("department", scope.department);
    }
    const { data: courseData } = await courseQuery;

    if (!courseData) {
      setLoading(false);
      return;
    }

    /* Counted in the database rather than by pulling every enrolled row here
       and tallying them. Besides the wasted transfer, PostgREST caps how many
       rows it returns — so past that cap the old approach did not fail, it
       just reported numbers that were too low. */
    const { data: counts } = await supabase.rpc("get_course_enrolment_counts");

    const enrollMap: Record<string, number> = {};
    (counts ?? []).forEach((row: { course_id: string; enrolled: number }) => {
      enrollMap[row.course_id] = row.enrolled;
    });

    const courseList: Course[] = courseData.map((c: any) => ({
      id: c.id,
      code: c.course_code,
      name: c.title,
      credits: c.credits,
      semester: c.semester,
      year: c.year,
      department: c.department,
      category: c.category,
      minorCategory: c.minor_category,
      contributesToGpa: c.contributes_to_gpa,
      enrolledCount: enrollMap[c.id] ?? 0,
      caWeight: c.ca_weight,
      eseWeight: c.ese_weight,
    }));

    setCourses(courseList);
    setLoading(false);
  };

  const semesters = [...new Set(courses.map((c) => c.semester))].sort();

  const filtered = courses.filter((c) => {
    const matchSearch =
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.code.toLowerCase().includes(searchQuery.toLowerCase());
    const matchSemester =
      filterSemester === "all" || c.semester === filterSemester;
    const matchDepartment =
      filterDepartment === "all" || c.department === filterDepartment;
    return matchSearch && matchSemester && matchDepartment;
  });

  /* Course-owning departments, taken from the catalogue itself rather than
     a list kept somewhere else. */
  const departments = useMemo(
    () =>
      [...new Set(courses.map((c) => c.department))]
        .filter((d): d is string => Boolean(d))
        .sort(),
    [courses],
  );

  useEffect(() => {
    if (!minorsDepartment && departments.length > 0) {
      setMinorsDepartment(departments[0]);
    }
  }, [departments, minorsDepartment]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Course Management"
        description={
          scope.kind === "all"
            ? "Every course in the faculty catalogue."
            : `Courses and minors belonging to ${
                departmentOverride ?? describeAdminScope(student)
              }.`
        }
        actions={
          /* The catalogue is the department's, but the faculty office owns
             all of them: row security has always let a super admin write
             any course, and this page was the one place that did not. */
          <Button
            onClick={() => {
              setEditing(null);
              setEditorOpen(true);
            }}
          >
            <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
            New course
          </Button>
        }
      />

      <SegmentedTabs
        aria-label="Courses view"
        layoutId="courses-tabs"
        value={tab}
        onChange={(v) => setTab(v as "courses" | "minors")}
        tabs={[
          { value: "courses", label: "Course Management", count: courses.length },
          { value: "minors", label: "Minor Specifications" },
        ]}
      />

      {tab === "minors" ? (
        scope.kind === "department" ? (
          <MinorSpecifications department={scope.department} canWrite />
        ) : (
          /* A super admin owns no department, so which one's minors to set
             is a question rather than an assumption. */
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              Minors for
              <DepartmentSelect
                value={minorsDepartment}
                onChange={setMinorsDepartment}
                departments={departments}
                ariaLabel="Minors for department"
                className="w-72 max-w-full"
              />
            </label>
            {minorsDepartment && (
              <MinorSpecifications
                key={minorsDepartment}
                department={minorsDepartment}
                canWrite
              />
            )}
          </div>
        )
      ) : (
        <>
      {/* The counts, as a line rather than four cards: they describe the
          list below, and the category badges on each row already carry
          them. The cards were four literal colours (blue, purple, green)
          that meant nothing elsewhere in the system. */}
      <p className="text-sm text-muted-foreground">
        {loading ? (
          "Loading the catalogue…"
        ) : (
          <>
            <strong className="font-semibold text-foreground">{courses.length}</strong> courses ·{" "}
            {courses.filter((c) => c.category === "Compulsory").length} compulsory ·{" "}
            {courses.filter((c) => c.category === "Elective").length} elective ·{" "}
            {courses.filter((c) => c.minorCategory !== null).length} counting toward a minor
          </>
        )}
      </p>

      {/* Search, department (super admin) and semester filters */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        {scope.kind === "all" && (
          <DepartmentSelect
            ariaLabel="Filter by department"
            value={filterDepartment}
            onChange={setFilterDepartment}
            departments={departments}
            allLabel="All departments"
            allValue="all"
            className="lg:w-72"
          />
        )}
        <div className="relative flex-1">
          <Search
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            placeholder="Search by course code or name..."
            aria-label="Search courses"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-9 border-border bg-card pl-9"
          />
        </div>
        <SegmentedTabs
          aria-label="Filter by semester"
          layoutId="catalogue-semester-filter"
          scrollable
          value={String(filterSemester)}
          onChange={(v) => setFilterSemester(v === "all" ? "all" : Number(v))}
          tabs={[
            { value: "all", label: "All" },
            ...semesters.map((sem) => ({ value: String(sem), label: `Sem ${sem}` })),
          ]}
        />
      </div>

      <SectionCard
        title="Courses"
        description={`${filtered.length} shown`}
        flush
      >
        {loading ? (
          <div className="p-4">
            <SkeletonRows count={5} height="h-16" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={BookOpen} title="No courses found" size="inline" />
        ) : (
          <ul className="divide-y divide-border/70">
            {filtered.map((course) => {
              const dept = departmentByCourseCode(course.code);
              return (
                <li
                  key={course.id}
                  className={cn(
                    "flex flex-col gap-2 border-l-4 px-4 py-3 transition-colors sm:flex-row sm:items-center sm:justify-between sm:gap-4",
                    dept?.stripeClass ?? "border-l-transparent",
                    dept?.hoverClass ?? "hover:bg-muted/40",
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span
                        className={cn(
                          "text-sm font-semibold tabular-nums",
                          dept?.textClass ?? "text-foreground",
                        )}
                      >
                        {course.code}
                      </span>
                      <span className="text-sm font-medium text-foreground">
                        {course.name}
                      </span>
                      {course.minorCategory && (
                        <StatusBadge tone="info">{course.minorCategory}</StatusBadge>
                      )}
                      {!course.contributesToGpa && (
                        <StatusBadge tone="neutral">Non-GPA</StatusBadge>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Sem {course.semester} · {course.credits} credits ·{" "}
                      <DepartmentName department={course.department} />
                      {/* How the course is marked, on the row that manages it
                          — the split is a property of the course now, so it
                          belongs where the course is read. */}
                      {" · "}CA {Math.round(course.caWeight * 100)}% · ESE{" "}
                      {Math.round(course.eseWeight * 100)}%
                      {course.enrolledCount > 0 && ` · ${course.enrolledCount} enrolled`}
                    </p>
                  </div>

                  <div className="flex flex-shrink-0 items-center gap-2">
                    <StatusBadge
                      tone={course.category === "Compulsory" ? "info" : "neutral"}
                    >
                      {course.category}
                    </StatusBadge>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditing(toEditable(course));
                        setEditorOpen(true);
                      }}
                      aria-label={`Edit ${course.code}`}
                    >
                      <Pencil className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                      Edit
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

        </>
      )}

      <CourseEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        course={editing}
        department={scope.kind === "department" ? scope.department : ""}
        departmentOptions={departments}
        onSaved={fetchCourses}
      />
    </div>
  );
}

/** The department office's route. A head of department reaches the same
 *  screen from the staff portal, where their own department is passed in. */
export default function AdminCourses() {
  return <CourseManagement />;
}
