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
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../components/ui/tabs";
import { Checkbox } from "../components/ui/checkbox";
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

  useEffect(() => {
    if (!student?.id) return;
    fetchAvailableCourses();
  }, [student?.id]);

  const fetchAvailableCourses = async () => {
    setLoading(true);

    // Get next semester courses — semester 6 for a sem 5 student
    // Get all courses for year 3 semester 6
    const { data: courses } = await supabase
      .from("courses")
      .select("*")
      .eq("department", "Computer Engineering")
      .eq("year", 3)
      .eq("semester", 6)
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
    if (selectedCourses.length === 0) return;
    setEnrolling(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const enrollments = selectedCourses.map((courseId) => ({
        student_id: student!.id,
        course_id: courseId,
        academic_year: "2025/2026",
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
    <div className="space-y-6">
      {/* Page Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h1 className="text-3xl font-bold text-foreground mb-2">
          Course Enrollment
        </h1>
        <p className="text-muted-foreground">
          Enroll in courses for Semester 6 — {availableCourses.length} courses
          available.
        </p>
      </motion.div>

      {/* Success / Error Messages */}
      {successMessage && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 rounded-xl bg-green-50 border border-green-200 flex items-center gap-3"
        >
          <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0" />
          <p className="text-sm text-green-800 font-medium">{successMessage}</p>
        </motion.div>
      )}

      {errorMessage && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 rounded-xl bg-red-50 border border-red-200 flex items-center gap-3"
        >
          <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
          <p className="text-sm text-red-800 font-medium">{errorMessage}</p>
        </motion.div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
        >
          <Card className="border-border">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <GraduationCap className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">
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
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-100">
                  <BookOpen className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">
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
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-green-100">
                  <CheckCircle className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">
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
          <Card className="border-border">
            <CardContent className="p-4">
              <Button
                className="w-full bg-primary hover:bg-primary/90"
                disabled={selectedCourses.length === 0 || enrolling}
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
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search courses by name or code..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 h-12 bg-card border-border"
          />
        </div>
      </motion.div>

      {/* Course Tabs */}
      <Tabs defaultValue="all" className="w-full">
        <TabsList className="grid grid-cols-3 w-full max-w-md">
          <TabsTrigger value="all">All Courses</TabsTrigger>
          <TabsTrigger value="Compulsory">Compulsory</TabsTrigger>
          <TabsTrigger value="Elective">Elective</TabsTrigger>
        </TabsList>

        {["all", "Compulsory", "Elective"].map((tab) => (
          <TabsContent key={tab} value={tab} className="mt-6">
            {loading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-32 rounded-xl bg-muted animate-pulse"
                  />
                ))}
              </div>
            ) : (
              <CourseList
                courses={filteredCourses.filter((c) =>
                  tab === "all" ? true : c.category === tab,
                )}
                selectedCourses={selectedCourses}
                onCourseToggle={handleCourseToggle}
              />
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function CourseList({
  courses,
  selectedCourses,
  onCourseToggle,
}: {
  courses: AvailableCourse[];
  selectedCourses: string[];
  onCourseToggle: (id: string) => void;
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
    <div className="grid grid-cols-1 gap-4">
      {courses.map((course, index) => {
        const status = getCourseStatus(course);
        const StatusIcon = status.icon;
        const isSelected = selectedCourses.includes(course.id);
        const isDisabled =
          course.alreadyEnrolled || course.enrolled >= course.seats;

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
              <CardContent className="p-6">
                <div className="flex items-start gap-4">
                  <div className="pt-1">
                    <Checkbox
                      checked={isSelected || course.alreadyEnrolled}
                      onCheckedChange={() => onCourseToggle(course.id)}
                      disabled={isDisabled}
                    />
                  </div>

                  <div className="flex-1">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="text-lg font-semibold text-foreground">
                            {course.name}
                          </h3>
                          <Badge className="bg-primary/10 text-primary">
                            {course.code}
                          </Badge>
                          {course.minor_category && (
                            <Badge
                              variant="outline"
                              className="text-xs border-purple-300 text-purple-700"
                            >
                              {course.minor_category}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {course.credits} Credits • {course.category}
                        </p>
                      </div>
                      <Badge className={status.color}>
                        <StatusIcon className="h-3 w-3 mr-1" />
                        {status.label}
                      </Badge>
                    </div>

                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">
                        Seats: {course.enrolled}/{course.seats}
                      </span>
                      <div className="w-32 h-2 bg-muted rounded-full overflow-hidden">
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
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        );
      })}
    </div>
  );
}
