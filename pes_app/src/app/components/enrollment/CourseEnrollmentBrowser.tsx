import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Users } from "lucide-react";
import { Input } from "../ui/input";
import {
  EmptyState,
  ErrorState,
  SectionCard,
  Skeleton,
  SkeletonRows,
  StatusBadge,
} from "../common";
import { GraduationCap, Search } from "lucide-react";
import { supabase } from "../../../lib/supabase";
import { describeBatch } from "../../../lib/batch";
import { formatRegNumber } from "../../../lib/format";

interface CourseOverviewRow {
  course_id: string;
  course_code: string;
  course_title: string;
  department: string;
  semester: number;
  enrolled_count: number;
  capacity: number | null;
}

interface EnrolledStudent {
  student_id: string;
  name: string;
  index_number: string;
  reg_number: string;
  batch_year: number;
  department: string;
  status: string;
  enrolled_at: string | null;
}

/**
 * Course-centric enrollment view, independent of any single enrolment
 * period — "who is currently enrolled in each of my courses". Scoped by
 * the course's own department (matches get_course_roster's ownership
 * model): a regular admin sees their department's courses, the IS admin
 * sees IS-owned courses with students from every department, super_admin
 * sees everything.
 */
export function CourseEnrollmentBrowser() {
  const [courses, setCourses] = useState<CourseOverviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [roster, setRoster] = useState<Record<string, EnrolledStudent[]>>({});
  const [rosterLoading, setRosterLoading] = useState<string | null>(null);
  const [rosterError, setRosterError] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchOverview();
  }, []);

  const fetchOverview = async () => {
    setLoading(true);
    setError(null);
    const { data, error: fetchError } = await supabase.rpc(
      "get_admin_course_enrollment_overview",
    );
    if (fetchError) {
      console.error(
        "[CourseEnrollmentBrowser] failed to load overview",
        fetchError,
      );
      setError("Unable to load course enrollment data.");
      setLoading(false);
      return;
    }
    setCourses(data ?? []);
    setLoading(false);
  };

  const toggleExpand = async (course: CourseOverviewRow) => {
    if (expandedId === course.course_id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(course.course_id);
    if (roster[course.course_id]) return;

    setRosterLoading(course.course_id);
    const { data, error: fetchError } = await supabase.rpc(
      "get_course_enrolled_students",
      { p_course_id: course.course_id },
    );
    if (fetchError) {
      console.error(
        "[CourseEnrollmentBrowser] failed to load roster",
        fetchError,
      );
      setRosterError((prev) => ({
        ...prev,
        [course.course_id]: "Unable to load enrolled students.",
      }));
    } else {
      setRoster((prev) => ({ ...prev, [course.course_id]: data ?? [] }));
    }
    setRosterLoading(null);
  };

  const filtered = courses.filter(
    (c) =>
      c.course_code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.course_title.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const bySemester = Array.from(new Set(filtered.map((c) => c.semester)))
    .sort((a, b) => a - b)
    .map((sem) => ({
      semester: sem,
      courses: filtered.filter((c) => c.semester === sem),
    }));

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-9 w-full max-w-sm" />
        <SkeletonRows count={5} height="h-14" />
      </div>
    );
  }

  if (error) {
    return <ErrorState message={error} onRetry={fetchOverview} />;
  }

  if (courses.length === 0) {
    return (
      <EmptyState
        icon={GraduationCap}
        title="No courses in your scope"
        description="Course-wise enrollment will appear here once your department's courses are in the catalogue."
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by course code or name..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No courses match your search"
          size="inline"
        />
      ) : (
        bySemester.map((group) => (
          <div key={group.semester} className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground">
              Semester {group.semester}
            </h3>
            <div className="space-y-2">
              {group.courses.map((c) => {
                const isExpanded = expandedId === c.course_id;
                const over =
                  c.capacity !== null && c.enrolled_count > c.capacity;
                return (
                  <SectionCard key={c.course_id} flush className="!rounded-xl">
                    <button
                      type="button"
                      onClick={() => toggleExpand(c)}
                      className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-primary">
                            {c.course_code}
                          </span>
                          <span className="text-sm text-foreground truncate">
                            {c.course_title}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {c.department}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <StatusBadge
                          tone={over ? "danger" : "brand"}
                          icon={Users}
                        >
                          {c.capacity !== null
                            ? `${c.enrolled_count} / ${c.capacity} enrolled`
                            : `${c.enrolled_count} enrolled`}
                        </StatusBadge>
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-border/70 px-4 py-3">
                        {rosterLoading === c.course_id ? (
                          <SkeletonRows count={3} height="h-10" />
                        ) : rosterError[c.course_id] ? (
                          <ErrorState
                            message={rosterError[c.course_id]}
                            onRetry={() => {
                              setRoster((prev) => {
                                const next = { ...prev };
                                delete next[c.course_id];
                                return next;
                              });
                              toggleExpand(c);
                            }}
                            size="inline"
                          />
                        ) : (roster[c.course_id]?.length ?? 0) === 0 ? (
                          <p className="text-sm text-muted-foreground py-2">
                            No students currently enrolled.
                          </p>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-xs text-muted-foreground text-left border-b border-border/70">
                                  <th className="pb-2 pr-3 font-medium">
                                    Student
                                  </th>
                                  <th className="pb-2 pr-3 font-medium">
                                    Index No.
                                  </th>
                                  <th className="pb-2 pr-3 font-medium">
                                    Reg. No.
                                  </th>
                                  <th className="pb-2 pr-3 font-medium">
                                    Batch
                                  </th>
                                  <th className="pb-2 pr-3 font-medium">
                                    Department
                                  </th>
                                  <th className="pb-2 pr-3 font-medium">
                                    Status
                                  </th>
                                  <th className="pb-2 font-medium">
                                    Enrolled
                                  </th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-border/50">
                                {roster[c.course_id].map((s) => (
                                  <tr key={s.student_id}>
                                    <td className="py-2 pr-3 text-foreground">
                                      {s.name}
                                    </td>
                                    <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">
                                      {s.index_number}
                                    </td>
                                    <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">
                                      {formatRegNumber(s.reg_number)}
                                    </td>
                                    <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">
                                      {describeBatch(s.batch_year)}
                                    </td>
                                    <td className="py-2 pr-3 text-muted-foreground">
                                      {s.department}
                                    </td>
                                    <td className="py-2 pr-3">
                                      <StatusBadge tone="success">
                                        {s.status}
                                      </StatusBadge>
                                    </td>
                                    <td className="py-2 text-muted-foreground whitespace-nowrap">
                                      {s.enrolled_at
                                        ? new Date(
                                            s.enrolled_at,
                                          ).toLocaleDateString("en-US", {
                                            year: "numeric",
                                            month: "short",
                                            day: "numeric",
                                          })
                                        : "—"}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </SectionCard>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
