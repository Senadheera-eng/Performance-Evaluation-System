import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Search, Filter, BookOpen, Clock, CheckCircle2 } from "lucide-react";
import { CourseCard } from "../components/dashboard/CourseCard";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../components/ui/tabs";
import { Badge } from "../components/ui/badge";
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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!student?.id) return;
    fetchCourses();
  }, [student?.id]);

  const fetchCourses = async () => {
    setLoading(true);

    // Get all enrollments with course info
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

    // Get attendance for enrolled courses
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

    // Get published results for completed courses
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

    // Get mid-sem progress for enrolled courses
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
          // Progress based on mid sem + CA out of max 50
          progressMap[r.course_id] = Math.min(
            100,
            Math.round(((r.mid_sem_mark + r.ca_mark) / 90) * 100),
          );
        }
      });
    }

    // Build course list
    const courses: Course[] = enrollments.map((e: any) => {
      const c = e.courses;
      const status = e.status as "enrolled" | "completed" | "dropped";

      if (status === "enrolled") {
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

    // Sort: ongoing first by semester, then completed by semester desc
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
    if (activeTab === "all") return matchesSearch;
    if (activeTab === "ongoing")
      return matchesSearch && course.status === "ongoing";
    if (activeTab === "completed")
      return matchesSearch && course.status === "completed";
    return matchesSearch;
  });

  const stats = {
    all: allCourses.length,
    ongoing: allCourses.filter((c) => c.status === "ongoing").length,
    completed: allCourses.filter((c) => c.status === "completed").length,
  };

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
        <Button variant="outline" className="h-12 px-6 border-border">
          <Filter className="h-5 w-5 mr-2" />
          Filters
        </Button>
      </motion.div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid grid-cols-3 w-full max-w-md">
          <TabsTrigger value="all">
            All
            <Badge variant="secondary" className="ml-2 bg-muted">
              {stats.all}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="ongoing">
            Ongoing
            <Badge variant="secondary" className="ml-2 bg-muted">
              {stats.ongoing}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="completed">
            Completed
            <Badge variant="secondary" className="ml-2 bg-muted">
              {stats.completed}
            </Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-6">
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div
                  key={i}
                  className="h-48 rounded-xl bg-muted animate-pulse"
                />
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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredCourses.map((course) => (
                <CourseCard
                  key={course.id}
                  course={course}
                  onClick={() => {}}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
