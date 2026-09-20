import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  BookOpen,
  Calendar,
  CheckCircle2,
  ClipboardList,
  GraduationCap,
  TrendingUp,
  Users,
  UserSquare,
} from "lucide-react";
import {
  ActionCard,
  EmptyState,
  ErrorState,
  PageHeader,
  SectionCard,
  SkeletonRows,
  SkeletonStatGrid,
  StatCard,
  StatusBadge,
} from "../../components/common";
import { useAuth } from "../../context/AuthContext";
import { getStaffCapabilities } from "../../../lib/staffScope";
import { describeBatch } from "../../../lib/batch";
import { getMyTeaching, type TeachingOffering } from "../../../lib/staffService";

export default function StaffDashboard() {
  const navigate = useNavigate();
  const { student, staff } = useAuth();
  const caps = getStaffCapabilities(staff);

  const [offerings, setOfferings] = useState<TeachingOffering[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (staff) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staff?.lecturerId]);

  const load = async () => {
    setLoading(true);
    setError(null);
    const result = await getMyTeaching();
    if (!result.ok) {
      setError("We could not load your courses. Please try again.");
      setLoading(false);
      return;
    }
    setOfferings(result.data);
    setLoading(false);
  };

  /* What is being taught now, not merely the newest batch's courses: a
     batch keeps its old offerings for ever, so "newest cohort" put classes
     that finished two years ago under the heading "Current teaching". */
  const current = offerings.filter((o) => o.is_current);
  const earlier = offerings.length - current.length;
  const totalStudents = current.reduce((sum, o) => sum + o.enrolled_count, 0);
  const coordinating = current.filter((o) => o.my_role === "coordinator").length;
  const awaitingEntry = current.filter(
    (o) => o.draft_count === 0 && o.submitted_count === 0 && o.published_count === 0,
  ).length;
  /* Sheets in review stay across every offering: a result sheet sent to the
     department in a past semester is still waiting on someone. */
  const inReview = offerings.filter((o) => o.submitted_count > 0).length;

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Welcome, ${student?.name ?? "Lecturer"}`}
        description={
          caps.isHod
            ? `Lecturer and Head of ${caps.hodDepartment}.`
            : `${staff?.department ?? "Faculty of Engineering"} — your teaching overview.`
        }
      />

      {error && <ErrorState message={error} onRetry={load} />}

      {loading ? (
        <SkeletonStatGrid count={4} />
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            index={0}
            label="Teaching Now"
            value={current.length}
            icon={BookOpen}
            tone="brand"
            hint={
              coordinating > 0
                ? `${coordinating} as coordinator`
                : earlier > 0
                  ? `${earlier} earlier course${earlier === 1 ? "" : "s"}`
                  : undefined
            }
          />
          <StatCard
            index={1}
            label="Students Taught"
            value={totalStudents}
            icon={Users}
            tone="info"
            hint="In the courses you teach now"
          />
          <StatCard
            index={2}
            label="Sheets In Review"
            value={inReview}
            icon={ClipboardList}
            tone={inReview > 0 ? "warning" : "neutral"}
            hint="Submitted, awaiting the department"
          />
          <StatCard
            index={3}
            label="No Marks Yet"
            value={awaitingEntry}
            icon={AlertTriangle}
            tone={awaitingEntry > 0 ? "warning" : "success"}
            hint="This semester's courses with nothing entered"
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SectionCard
          title="Current teaching"
          description={
            current.length > 0
              ? `${current.length} course${current.length === 1 ? "" : "s"} running this semester`
              : undefined
          }
          className="lg:col-span-2"
          flush
        >
          {loading ? (
            <div className="p-4">
              <SkeletonRows count={4} height="h-14" />
            </div>
          ) : current.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={BookOpen}
                title={
                  earlier > 0
                    ? "Nothing running this semester"
                    : "No courses assigned yet"
                }
                description={
                  earlier > 0
                    ? `Your ${earlier} earlier course${earlier === 1 ? " is" : "s are"} under My Courses. ${
                        caps.isHod
                          ? "Assign this semester's offerings under Course Assignments."
                          : "Your Head of Department assigns this semester's offerings."
                      }`
                    : caps.isHod
                      ? "Assign yourself or your staff to course offerings under Course Assignments."
                      : "Your Head of Department assigns course offerings. They will appear here as soon as that happens."
                }
              />
            </div>
          ) : (
            <ul className="divide-y divide-border/70">
              {current.map((o) => (
                <li key={o.offering_id}>
                  <button
                    type="button"
                    onClick={() => navigate("/staff/courses")}
                    className="w-full px-4 py-3 text-left transition-colors hover:bg-muted/50"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-primary">
                            {o.course_code}
                          </span>
                          <span className="truncate text-sm text-foreground">
                            {o.course_title}
                          </span>
                          {o.my_role === "coordinator" && (
                            <StatusBadge tone="brand">Coordinator</StatusBadge>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {describeBatch(o.batch_year)} · Semester {o.semester} ·{" "}
                          {o.credits} credits · {o.enrolled_count} enrolled
                          {o.co_lecturers.length > 0 &&
                            ` · with ${o.co_lecturers.map((c) => c.name).join(", ")}`}
                        </p>
                      </div>
                      <ResultStatusBadge offering={o} />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <div className="space-y-3">
          <ActionCard
            index={0}
            label="Mark attendance"
            description="Record a lecture for a course you teach"
            icon={Calendar}
            tone="info"
            onClick={() => navigate("/staff/attendance")}
          />
          <ActionCard
            index={1}
            label="Enter results"
            description="Mid-sem and CA marks, award the grade, then submit for review"
            icon={TrendingUp}
            tone="success"
            onClick={() => navigate("/staff/results")}
          />
          {caps.isHod && (
            <>
              <ActionCard
                index={2}
                label="Assign lecturers"
                description={`Course assignments for ${caps.hodDepartment}`}
                icon={GraduationCap}
                onClick={() => navigate("/staff/assignments")}
              />
              <ActionCard
                index={3}
                label="Department students"
                description="Every student's record, semester by semester"
                icon={UserSquare}
                onClick={() => navigate("/staff/students")}
              />
              <ActionCard
                index={4}
                label="Department staff"
                description="Academic staff and their teaching load"
                icon={Users}
                onClick={() => navigate("/staff/lecturers")}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Where an offering's result sheet has got to, as one badge. */
function ResultStatusBadge({ offering }: { offering: TeachingOffering }) {
  if (offering.published_count > 0 && offering.draft_count === 0 && offering.submitted_count === 0) {
    return (
      <StatusBadge tone="success" icon={CheckCircle2} className="flex-shrink-0">
        Published
      </StatusBadge>
    );
  }
  if (offering.submitted_count > 0) {
    return (
      <StatusBadge tone="warning" className="flex-shrink-0" dot>
        In review
      </StatusBadge>
    );
  }
  if (offering.draft_count > 0) {
    return (
      <StatusBadge tone="info" className="flex-shrink-0" dot>
        {offering.draft_count} draft
      </StatusBadge>
    );
  }
  return (
    <StatusBadge tone="neutral" className="flex-shrink-0">
      No marks
    </StatusBadge>
  );
}
