import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Search, Filter, BookOpen, Clock, CheckCircle2 } from "lucide-react";
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
  status: "ongoing" | "completed" | "upcoming";
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

    const { data: enrollments } = await supabase
      .from("enrollments")
      .select(
        `
        status,
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
      .eq("student_id", student!.id);

    if (!enrollments) {
      setLoading(false);
      return;
    }

    const enrolledIds = enrollments
      .filter((e: any) => e.status === "enrolled")
      .map((e: any) => e.course_id);

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

    const completedIds = enrollments
      .filter((e: any) => e.status === "completed")
      .map((e: any) => e.course_id);

    const gradeMap: Record<string, string> = {};
    if (completedIds.length > 0) {
      const { data: resultsData } = await supabase
        .from("results")
        .select("course_id, grade")
        .eq("student_id", student!.id)
        .eq("is_published", true)
        .in("course_id", completedIds)
        .not("grade", "is", null);

      resultsData?.forEach((r: any) => {
        gradeMap[r.course_id] = r.grade;
      });
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

    const courses: Course[] = enrollments.map((e: any) => {
      const c = e.courses;
      if (e.status === "enrolled") {
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
      } else {
        return {
          id: c.id,
          code: c.course_code,
          name: c.title,
          credits: c.credits,
          status: "completed" as const,
          grade: gradeMap[c.id],
          category: c.category,
          minor_category: c.minor_category,
          semester: c.semester,
          year: c.year,
        };
      }
    });

    courses.sort((a, b) => {
      if (a.status === "ongoing" && b.status !== "ongoing") return -1;
      if (a.status !== "ongoing" && b.status === "ongoing") return 1;
      if (a.status === "completed" && b.status === "completed")
        return b.semester - a.semester;
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
  };

  const tabs = [
    { value: "all", label: "All", count: stats.all },
    { value: "ongoing", label: "Ongoing", count: stats.ongoing },
    { value: "completed", label: "Completed", count: stats.completed },
  ];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h1 className="text-3xl font-bold text-foreground mb-2">My Courses</h1>
        <p className="text-muted-foreground">
          View and manage all your courses throughout your academic journey.
        </p>
      </motion.div>

      {/* Stats Banner */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
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
        ].map((stat, index) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3, delay: index * 0.1 }}
            className="bg-card rounded-xl p-4 border border-border shadow-sm"
          >
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${stat.color}`}>
                <stat.icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">
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
        className="flex flex-col sm:flex-row gap-4"
      >
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search courses by name or code..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 h-12 bg-card border-border"
          />
        </div>
        <Select value={semesterFilter} onValueChange={setSemesterFilter}>
          <SelectTrigger className="h-12 px-6 border-border sm:w-56 w-full">
            <Filter className="h-5 w-5 mr-2 shrink-0" />
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
          className="max-w-md mb-6"
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
          <div className="space-y-8">
            {coursesBySemester.map((group) => (
              <div key={group.semester}>
                <div className="flex items-center gap-3 mb-4">
                  <h3 className="text-lg font-semibold text-foreground">
                    Semester {group.semester}
                  </h3>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                    {group.courses.length} course
                    {group.courses.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
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
