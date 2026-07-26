import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Search,
  Filter,
  BookOpen,
  Clock,
  CheckCircle2,
  FileQuestion,
} from "lucide-react";
import { CourseCard } from "../components/dashboard/CourseCard";
import { PillTabs } from "../components/dashboard/PillTabs";
import { Input } from "../components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../context/AuthContext";

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
  const [allCourses, setAllCourses] = useState<Course[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const [semesterFilter, setSemesterFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!student?.id) return;
    fetchCourses();
  }, [student?.id]);

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

    const attendanceMap: Record<string, number> = {};
    if (enrolledIds.length > 0) {
      const { data: attData } = await supabase
        .from("attendance")
        .select("course_id, status")
        .eq("student_id", student!.id)
        .in("course_id", enrolledIds);

      if (attData) {
        const courseAtt: Record<string, { present: number; total: number }> =
          {};
        attData.forEach((a: any) => {
          if (!courseAtt[a.course_id])
            courseAtt[a.course_id] = { present: 0, total: 0 };
          courseAtt[a.course_id].total++;
          if (a.status === "present" || a.status === "excused")
            courseAtt[a.course_id].present++;
        });
        Object.entries(courseAtt).forEach(([id, val]) => {
          attendanceMap[id] =
            val.total > 0 ? Math.round((val.present / val.total) * 100) : 0;
        });
      }
    }

    const progressMap: Record<string, number> = {};
    if (enrolledIds.length > 0) {
      const { data: currentResults } = await supabase
        .from("results")
        .select("course_id, mid_sem_mark, ca_mark")
        .eq("student_id", student!.id)
        .eq("is_published", false)
        .in("course_id", enrolledIds);

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
      .from("results")
      .select(
        `
        course_id,
        grade,
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
      .eq("is_published", true)
      .not("grade", "is", null);

    const completedCourses: Course[] = (resultsData ?? [])
      .filter((r: any) => r.courses && !enrolledIds.includes(r.course_id))
      .map((r: any) => {
        const c = r.courses;
        return {
          id: c.id,
          code: c.course_code,
          name: c.title,
          credits: c.credits,
          status: "completed" as const,
          grade: r.grade,
          category: c.category,
          minor_category: c.minor_category,
          semester: c.semester,
          year: c.year,
        };
      });

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

  const stats = {
    all: allCourses.length,
    ongoing: allCourses.filter((c) => c.status === "ongoing").length,
    completed: allCourses.filter((c) => c.status === "completed").length,
    upcoming: allCourses.filter((c) => c.status === "upcoming").length,
    notRecorded: allCourses.filter((c) => c.status === "not_recorded").length,
  };

  const tabs = [
    { value: "all", label: "All", count: stats.all },
    { value: "ongoing", label: "Ongoing", count: stats.ongoing },
    { value: "completed", label: "Completed", count: stats.completed },
    { value: "upcoming", label: "Upcoming", count: stats.upcoming },
    { value: "not_recorded", label: "Not Recorded", count: stats.notRecorded },
  ];

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h1 className="text-2xl font-bold text-foreground mb-1">
          My Courses
        </h1>
        <p className="text-muted-foreground text-sm">
          View and manage all your courses throughout your academic journey.
        </p>
      </motion.div>

      {/* Stats Banner */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          {
            label: "Total Courses",
            value: stats.all,
            icon: BookOpen,
            color: "bg-primary/10 text-primary",
          },
          {
            label: "Ongoing",
            value: stats.ongoing,
            icon: Clock,
            color: "bg-blue-100 text-blue-600",
          },
          {
            label: "Completed",
            value: stats.completed,
            icon: CheckCircle2,
            color: "bg-green-100 text-green-600",
          },
          {
            label: "Upcoming",
            value: stats.upcoming,
            icon: Clock,
            color: "bg-yellow-100 text-yellow-600",
          },
          {
            label: "Not Recorded",
            value: stats.notRecorded,
            icon: FileQuestion,
            color: "bg-gray-100 text-gray-500",
          },
        ].map((stat, index) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3, delay: index * 0.1 }}
            className="bg-card rounded-xl p-3 border border-border shadow-sm"
          >
            <div className="flex items-center gap-2.5">
              <div className={`p-1.5 rounded-lg ${stat.color}`}>
                <stat.icon className="h-4 w-4" />
              </div>
              <div>
                <p className="text-xl font-bold text-foreground">
                  {loading ? "..." : stat.value}
                </p>
                <p className="text-sm text-muted-foreground">{stat.label}</p>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Search and Filter */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex flex-col sm:flex-row gap-3"
      >
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search courses by name or code..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9 bg-card border-border"
          />
        </div>
        <Select value={semesterFilter} onValueChange={setSemesterFilter}>
          <SelectTrigger className="h-9 px-4 border-border sm:w-52 w-full">
            <Filter className="h-4 w-4 mr-2 shrink-0" />
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
      </motion.div>

      {/* Tabs */}
      <div className="w-full">
        <PillTabs
          tabs={tabs}
          activeTab={activeTab}
          onChange={setActiveTab}
          className="max-w-full mb-4"
          layoutId="courses-tab-indicator"
        />

        {/* Tab Content */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-48 rounded-xl bg-muted animate-pulse" />
            ))}
          </div>
        ) : filteredCourses.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-12"
          >
            <BookOpen className="h-16 w-16 text-muted-foreground mx-auto mb-4 opacity-50" />
            <h3 className="text-lg font-semibold text-foreground mb-2">
              No courses found
            </h3>
            <p className="text-muted-foreground">
              Try adjusting your search or filter criteria.
            </p>
          </motion.div>
        ) : (
          <div className="space-y-6">
            {coursesBySemester.map((group) => (
              <div key={group.semester}>
                <div className="flex items-center gap-2.5 mb-3">
                  <h3 className="text-base font-semibold text-foreground">
                    Semester {group.semester}
                  </h3>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                    {group.courses.length} course
                    {group.courses.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {group.courses.map((course) => (
                    <CourseCard
                      key={course.id}
                      course={course}
                      onClick={() => {}}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
