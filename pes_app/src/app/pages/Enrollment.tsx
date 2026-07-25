import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  GraduationCap,
  Search,
  CheckCircle,
  Clock,
  AlertCircle,
  BookOpen,
} from "lucide-react";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { Checkbox } from "../components/ui/checkbox";
import { PillTabs } from "../components/dashboard/PillTabs";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../context/AuthContext";

interface AvailableCourse {
  id: string;
  code: string;
  name: string;
  credits: number;
  category: string;
  minor_category: string | null;
  semester: number;
  year: number;
  seats: number;
  enrolled: number;
  alreadyEnrolled: boolean;
}

const getCourseStatus = (course: AvailableCourse) => {
  if (course.alreadyEnrolled) {
    return {
      label: "Enrolled",
      color: "bg-primary/10 text-primary",
      icon: CheckCircle,
    };
  }
  if (course.enrolled >= course.seats) {
    return {
      label: "Full",
      color: "bg-red-100 text-red-700",
      icon: AlertCircle,
    };
  }
  if (course.enrolled / course.seats > 0.8) {
    return {
      label: "Limited",
      color: "bg-yellow-100 text-yellow-700",
      icon: Clock,
    };
  }
  return {
    label: "Available",
    color: "bg-green-100 text-green-700",
    icon: CheckCircle,
  };
};

export default function Enrollment() {
  const { student } = useAuth();
  const [availableCourses, setAvailableCourses] = useState<AvailableCourse[]>(
    [],
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCourses, setSelectedCourses] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState("all");
  const [nextSemester, setNextSemester] = useState<number | null>(null);
  const [academicYear, setAcademicYear] = useState<string>("");
  const [enrollmentPeriod, setEnrollmentPeriod] = useState<{
    title: string;
    opens_at: string;
    closes_at: string;
  } | null>(null);
  const [periodChecked, setPeriodChecked] = useState(false);

  useEffect(() => {
    if (!student?.id) return;
    fetchEnrollmentPeriod();
    fetchAvailableCourses();
  }, [student?.id]);

  // Enrolment is only possible while the super admin has an enrolment
  // period open for this student's batch/department — enforced by RLS on
  // the enrollments table, mirrored here so the UI explains itself.
  const fetchEnrollmentPeriod = async () => {
    const nowIso = new Date().toISOString();
    const { data } = await supabase
      .from("enrollment_periods")
      .select("title, opens_at, closes_at, batch_year, department")
      .eq("status", "open")
      .lte("opens_at", nowIso)
      .gte("closes_at", nowIso)
      .eq("batch_year", student!.batch_year ?? -1);

    const match = (data ?? []).find(
      (p: any) => !p.department || p.department === student!.department,
    );
    setEnrollmentPeriod(match ?? null);
    setPeriodChecked(true);
  };

  const enrollmentOpen = enrollmentPeriod !== null;

  // Academic year for a given semester is derived from the student's own
  // intake (batch_year) plus the course year that semester falls in — two
  // semesters (e.g. 3 & 4) always share one academic year.
  const semesterToAcademicYear = (sem: number): string => {
    if (!student?.batch_year) return "TBD";
    const courseYear = Math.ceil(sem / 2);
    const startYear = student.batch_year + courseYear - 1;
    return `${startYear}/${startYear + 1}`;
  };

  const fetchAvailableCourses = async () => {
    setLoading(true);

    if (!student?.department) {
      setLoading(false);
      return;
    }

    // Determine the student's highest completed semester from published results
    const { data: completedResults } = await supabase
      .from("results")
      .select("courses(semester)")
      .eq("student_id", student!.id)
      .eq("is_published", true);

    const completedSemesters =
      completedResults
        ?.map((r: any) => r.courses?.semester ?? 0)
        .filter((s: number) => s > 0) ?? [];

    const highestCompleted =
      completedSemesters.length > 0 ? Math.max(...completedSemesters) : 0;
    const targetSemester = highestCompleted + 1;
    const targetYear = Math.ceil(targetSemester / 2);

    setNextSemester(targetSemester);
    setAcademicYear(semesterToAcademicYear(targetSemester));

    // Interdisciplinary Studies courses are shared general-education
    // requirements taken by students of every department, so they must be
    // included alongside the student's own department's courses here.
    const { data: courses } = await supabase
      .from("courses")
      .select("*")
      .in("department", [student.department, "Interdisciplinary Studies"])
      .eq("year", targetYear)
      .eq("semester", targetSemester)
      .order("course_code");

    if (!courses) {
      setLoading(false);
      return;
    }

    // Check which ones the student is already enrolled in
    const { data: existingEnrollments } = await supabase
      .from("enrollments")
      .select("course_id")
      .eq("student_id", student!.id)
      .in(
        "course_id",
        courses.map((c) => c.id),
      );

    const enrolledIds = new Set(
      existingEnrollments?.map((e: any) => e.course_id) ?? [],
    );

    // Get enrollment counts per course
    const { data: enrollmentCounts } = await supabase
      .from("enrollments")
      .select("course_id")
      .in(
        "course_id",
        courses.map((c) => c.id),
      )
      .eq("status", "enrolled");

    const countMap: Record<string, number> = {};
    enrollmentCounts?.forEach((e: any) => {
      countMap[e.course_id] = (countMap[e.course_id] ?? 0) + 1;
    });

    const result: AvailableCourse[] = courses.map((c) => ({
      id: c.id,
      code: c.course_code,
      name: c.title,
      credits: c.credits,
      category: c.category,
      minor_category: c.minor_category,
      semester: c.semester,
      year: c.year,
      seats: 45,
      enrolled: countMap[c.id] ?? 0,
      alreadyEnrolled: enrolledIds.has(c.id),
    }));

    setAvailableCourses(result);
    setLoading(false);
  };

  const handleCourseToggle = (courseId: string) => {
    if (!enrollmentOpen) return;
    const course = availableCourses.find((c) => c.id === courseId);
    if (!course || course.alreadyEnrolled || course.enrolled >= course.seats)
      return;

    setSelectedCourses((prev) =>
      prev.includes(courseId)
        ? prev.filter((id) => id !== courseId)
        : [...prev, courseId],
    );
  };

  const handleEnroll = async () => {
    if (selectedCourses.length === 0 || !enrollmentOpen) return;
    setEnrolling(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const enrollments = selectedCourses.map((courseId) => ({
        student_id: student!.id,
        course_id: courseId,
        academic_year: academicYear,
        status: "enrolled",
      }));

      const { error } = await supabase.from("enrollments").insert(enrollments);

      if (error) {
        setErrorMessage("Enrollment failed. Please try again.");
      } else {
        setSuccessMessage(
          `Successfully enrolled in ${selectedCourses.length} course(s)!`,
        );
        setSelectedCourses([]);
        await fetchAvailableCourses();
      }
    } catch {
      setErrorMessage("Something went wrong. Please try again.");
    }

    setEnrolling(false);
  };

  const filteredCourses = availableCourses.filter(
    (course) =>
      course.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      course.code.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const selectedCredits = availableCourses
    .filter((c) => selectedCourses.includes(c.id))
    .reduce((sum, c) => sum + c.credits, 0);

  const alreadyEnrolledCount = availableCourses.filter(
    (c) => c.alreadyEnrolled,
  ).length;

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h1 className="text-2xl font-bold text-foreground mb-1">
          Course Enrollment
        </h1>
        <p className="text-muted-foreground text-sm">
          Enroll in courses for Semester {nextSemester ?? "—"}
          {academicYear ? ` (${academicYear})` : ""} — {availableCourses.length}{" "}
          courses available.
        </p>
      </motion.div>

      {/* Enrollment period status */}
      {periodChecked && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className={`p-3 rounded-xl border flex items-center gap-2.5 ${
            enrollmentOpen
              ? "bg-green-50 border-green-200"
              : "bg-amber-50 border-amber-200"
          }`}
        >
          {enrollmentOpen ? (
            <>
              <CheckCircle className="h-4 w-4 text-green-600 flex-shrink-0" />
              <p className="text-sm text-green-800 font-medium">
                {enrollmentPeriod!.title} is open — enrol before{" "}
                {new Date(enrollmentPeriod!.closes_at).toLocaleDateString(
                  "en-GB",
                  { day: "numeric", month: "long", year: "numeric" },
                )}
                .
              </p>
            </>
          ) : (
            <>
              <AlertCircle className="h-4 w-4 text-amber-600 flex-shrink-0" />
              <p className="text-sm text-amber-800 font-medium">
                Enrolment is currently closed. You can browse the available
                courses below, but selections will open once the faculty
                announces the next enrolment period.
              </p>
            </>
          )}
        </motion.div>
      )}

      {/* Success / Error Messages */}
      {successMessage && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-3 rounded-xl bg-green-50 border border-green-200 flex items-center gap-2.5"
        >
          <CheckCircle className="h-4 w-4 text-green-600 flex-shrink-0" />
          <p className="text-sm text-green-800 font-medium">{successMessage}</p>
        </motion.div>
      )}

      {errorMessage && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-3 rounded-xl bg-red-50 border border-red-200 flex items-center gap-2.5"
        >
          <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
          <p className="text-sm text-red-800 font-medium">{errorMessage}</p>
        </motion.div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
        >
          <Card className="border-border">
            <CardContent className="p-3">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-lg bg-primary/10">
                  <GraduationCap className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-xl font-bold text-foreground">
                    {selectedCourses.length}
                  </p>
                  <p className="text-sm text-muted-foreground">Selected</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3, delay: 0.1 }}
        >
          <Card className="border-border">
            <CardContent className="p-3">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-lg bg-blue-100">
                  <BookOpen className="h-4 w-4 text-blue-600" />
                </div>
                <div>
                  <p className="text-xl font-bold text-foreground">
                    {selectedCredits}
                  </p>
                  <p className="text-sm text-muted-foreground">New Credits</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3, delay: 0.2 }}
        >
          <Card className="border-border">
            <CardContent className="p-3">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-lg bg-green-100">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                </div>
                <div>
                  <p className="text-xl font-bold text-foreground">
                    {loading ? "..." : alreadyEnrolledCount}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Already Enrolled
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3, delay: 0.3 }}
        >
          <Card className="border-border h-full">
            <CardContent className="p-3 h-full flex items-center">
              <Button
                className="w-full bg-primary hover:bg-primary/90"
                disabled={
                  selectedCourses.length === 0 || enrolling || !enrollmentOpen
                }
                onClick={handleEnroll}
              >
                {enrolling ? (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Enrolling...
                  </div>
                ) : (
                  `Confirm Enrollment`
                )}
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Search */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search courses by name or code..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9 bg-card border-border"
          />
        </div>
      </motion.div>

      {/* Course Tabs */}
      <PillTabs
        tabs={[
          { value: "all", label: "All Courses" },
          { value: "Compulsory", label: "Compulsory" },
          { value: "Elective", label: "Elective" },
        ]}
        activeTab={activeTab}
        onChange={setActiveTab}
        className="max-w-md"
        layoutId="enrollment-tab-indicator"
      />

      <div className="mt-4">
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />
            ))}
          </div>
        ) : (
          <CourseListGrouped
            courses={filteredCourses.filter((c) =>
              activeTab === "all" ? true : c.category === activeTab,
            )}
            selectedCourses={selectedCourses}
            onCourseToggle={handleCourseToggle}
            selectionEnabled={enrollmentOpen}
          />
        )}
      </div>
    </div>
  );
}

function CourseListGrouped({
  courses,
  selectedCourses,
  onCourseToggle,
  selectionEnabled,
}: {
  courses: AvailableCourse[];
  selectedCourses: string[];
  onCourseToggle: (id: string) => void;
  selectionEnabled: boolean;
}) {
  if (courses.length === 0) {
    return (
      <div className="text-center py-12">
        <BookOpen className="h-16 w-16 text-muted-foreground mx-auto mb-4 opacity-50" />
        <h3 className="text-lg font-semibold text-foreground mb-2">
          No courses found
        </h3>
        <p className="text-muted-foreground">
          Try adjusting your search criteria.
        </p>
      </div>
    );
  }

  const compulsory = courses.filter((c) => c.category !== "Elective");
  const electives = courses.filter((c) => c.category === "Elective");

  const minorGroups = Array.from(
    new Set(electives.map((c) => c.minor_category ?? "General Electives")),
  );

  return (
    <div className="space-y-5">
      {compulsory.length > 0 && (
        <div>
          {electives.length > 0 && (
            <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Compulsory Courses
            </h4>
          )}
          <CourseList
            courses={compulsory}
            selectedCourses={selectedCourses}
            onCourseToggle={onCourseToggle}
            selectionEnabled={selectionEnabled}
          />
        </div>
      )}

      {minorGroups.map((minor) => (
        <div key={minor}>
          <div className="flex items-center gap-2 mb-2">
            <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              {minor} Electives
            </h4>
            {minor !== "General Electives" && (
              <Badge
                variant="outline"
                className="text-xs border-purple-300 text-purple-700"
              >
                Minor
              </Badge>
            )}
          </div>
          <CourseList
            courses={electives.filter(
              (c) => (c.minor_category ?? "General Electives") === minor,
            )}
            selectedCourses={selectedCourses}
            onCourseToggle={onCourseToggle}
            selectionEnabled={selectionEnabled}
          />
        </div>
      ))}
    </div>
  );
}

function CourseList({
  courses,
  selectedCourses,
  onCourseToggle,
  selectionEnabled,
}: {
  courses: AvailableCourse[];
  selectedCourses: string[];
  onCourseToggle: (id: string) => void;
  selectionEnabled: boolean;
}) {
  if (courses.length === 0) {
    return (
      <div className="text-center py-12">
        <BookOpen className="h-16 w-16 text-muted-foreground mx-auto mb-4 opacity-50" />
        <h3 className="text-lg font-semibold text-foreground mb-2">
          No courses found
        </h3>
        <p className="text-muted-foreground">
          Try adjusting your search criteria.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {courses.map((course, index) => {
        const status = getCourseStatus(course);
        const StatusIcon = status.icon;
        const isSelected = selectedCourses.includes(course.id);
        const isDisabled =
          !selectionEnabled ||
          course.alreadyEnrolled ||
          course.enrolled >= course.seats;

        return (
          <motion.div
            key={course.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: index * 0.05 }}
          >
            <Card
              className={`border-2 transition-all ${
                course.alreadyEnrolled
                  ? "border-primary/30 bg-primary/5"
                  : isSelected
                    ? "border-primary shadow-lg shadow-primary/20"
                    : "border-border hover:border-primary/50"
              } ${isDisabled && !course.alreadyEnrolled ? "opacity-60" : ""}`}
            >
              <CardContent className="p-3">
                <div className="flex items-center gap-3 flex-wrap md:flex-nowrap">
                  <Checkbox
                    checked={isSelected || course.alreadyEnrolled}
                    onCheckedChange={() => onCourseToggle(course.id)}
                    disabled={isDisabled}
                    className="flex-shrink-0"
                  />

                  {/* Course identity */}
                  <div className="flex-1 min-w-0 basis-full md:basis-auto">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <h3 className="text-sm font-semibold text-foreground truncate">
                        {course.name}
                      </h3>
                      <Badge className="bg-primary/10 text-primary text-xs flex-shrink-0">
                        {course.code}
                      </Badge>
                      {course.minor_category && (
                        <Badge
                          variant="outline"
                          className="text-xs border-purple-300 text-purple-700 flex-shrink-0"
                        >
                          {course.minor_category}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {course.credits} Credits • {course.category}
                    </p>
                  </div>

                  {/* Seats + availability progress */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      Seats: {course.enrolled}/{course.seats}
                    </span>
                    <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          course.enrolled >= course.seats
                            ? "bg-red-500"
                            : course.enrolled / course.seats > 0.8
                              ? "bg-yellow-500"
                              : "bg-green-500"
                        }`}
                        style={{
                          width: `${Math.min(
                            100,
                            (course.enrolled / course.seats) * 100,
                          )}%`,
                        }}
                      />
                    </div>
                  </div>

                  {/* Category + Status */}
                  <Badge
                    className={`text-xs flex-shrink-0 ${
                      course.category === "Compulsory"
                        ? "bg-blue-100 text-blue-700"
                        : "bg-purple-100 text-purple-700"
                    }`}
                  >
                    {course.category}
                  </Badge>
                  <Badge className={`${status.color} flex-shrink-0`}>
                    <StatusIcon className="h-3 w-3 mr-1" />
                    {status.label}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        );
      })}
    </div>
  );
}
