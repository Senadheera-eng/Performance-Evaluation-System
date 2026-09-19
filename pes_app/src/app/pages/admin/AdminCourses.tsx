import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Search, BookOpen, Filter, Pencil, Plus } from "lucide-react";
import { Button } from "../../components/ui/button";
import {
  CourseEditorDialog,
  type EditableCourse,
} from "../../components/courses/CourseEditorDialog";
import { MinorRequirements } from "../../components/courses/MinorRequirements";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";
import { supabase } from "../../../lib/supabase";
import { useAuth } from "../../context/AuthContext";
import { getAdminScope, describeAdminScope } from "../../../lib/adminScope";

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

export default function AdminCourses() {
  const { student } = useAuth();
  const scope = getAdminScope(student);
  const [courses, setCourses] = useState<Course[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterSemester, setFilterSemester] = useState<number | "all">("all");
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
    return matchSearch && matchSemester;
  });

  return (
    <div className="space-y-5">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground mb-1">
              Course Management
            </h1>
            <p className="text-muted-foreground text-sm">
              {scope.kind === "all"
                ? "Every course in the faculty catalogue."
                : `Courses belonging to ${describeAdminScope(student)}.`}
            </p>
          </div>
          {scope.kind === "department" && (
            <Button
              onClick={() => {
                setEditing(null);
                setEditorOpen(true);
              }}
            >
              <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
              New course
            </Button>
          )}
        </div>
      </motion.div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          {
            label: "Total Courses",
            value: courses.length,
            color: "bg-primary/10 text-primary",
          },
          {
            label: "Compulsory",
            value: courses.filter((c) => c.category === "Compulsory").length,
            color: "bg-blue-100 text-blue-600",
          },
          {
            label: "Elective",
            value: courses.filter((c) => c.category === "Elective").length,
            color: "bg-purple-100 text-purple-600",
          },
          {
            label: "With Minor",
            value: courses.filter((c) => c.minorCategory !== null).length,
            color: "bg-green-100 text-green-600",
          },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3, delay: i * 0.1 }}
            className="bg-card rounded-xl p-3 border border-border shadow-sm"
          >
            <div
              className={`text-xl font-bold mb-1 ${stat.color.split(" ")[1]}`}
            >
              {loading ? "..." : stat.value}
            </div>
            <div className="text-sm text-muted-foreground">{stat.label}</div>
          </motion.div>
        ))}
      </div>

      {/* Which minors the department offers, and what each is worth. The
          handbook names the streams but sets no credit total, so it is the
          department's to state rather than the system's to assume. */}
      {scope.kind === "department" && (
        <MinorRequirements
          department={scope.department}
          minorsInUse={courses
            .map((c) => c.minorCategory)
            .filter((m): m is string => m !== null)}
        />
      )}

      {/* Search and Filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by course code or name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9 bg-card border-border"
          />
        </div>

        {/* Semester Filter */}
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <button
            onClick={() => setFilterSemester("all")}
            className="px-3 py-2 rounded-lg text-sm font-medium transition-all"
            style={
              filterSemester === "all"
                ? { backgroundColor: "#C41E3A", color: "white" }
                : {}
            }
          >
            <span
              className={
                filterSemester === "all"
                  ? "text-white"
                  : "text-muted-foreground"
              }
            >
              All
            </span>
          </button>
          {semesters.map((sem) => (
            <button
              key={sem}
              onClick={() => setFilterSemester(sem)}
              className="px-3 py-2 rounded-lg text-sm font-medium transition-all"
              style={
                filterSemester === sem
                  ? { backgroundColor: "#C41E3A", color: "white" }
                  : {}
              }
            >
              <span
                className={
                  filterSemester === sem
                    ? "text-white"
                    : "text-muted-foreground"
                }
              >
                Sem {sem}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Course List */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle>
            Courses{" "}
            <span className="text-muted-foreground font-normal text-sm">
              ({filtered.length})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className="h-16 rounded-xl bg-muted animate-pulse"
                />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12">
              <BookOpen className="h-12 w-12 text-muted-foreground mx-auto mb-3 opacity-50" />
              <p className="text-muted-foreground">No courses found.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((course, index) => (
                <motion.div
                  key={course.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, delay: index * 0.02 }}
                  className="flex items-center justify-between p-3 rounded-xl border border-border bg-card hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <BookOpen className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-foreground text-sm">
                          {course.name}
                        </span>
                        <Badge className="bg-primary/10 text-primary text-xs">
                          {course.code}
                        </Badge>
                        {course.minorCategory && (
                          <Badge className="bg-purple-100 text-purple-700 text-xs">
                            {course.minorCategory}
                          </Badge>
                        )}
                        {!course.contributesToGpa && (
                          <Badge className="bg-gray-100 text-gray-500 text-xs">
                            Non-GPA
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Sem {course.semester} · {course.credits} credits ·{" "}
                        {course.category} · {course.department}
                      </p>
                      {/* How the course is marked, on the row that manages it
                          — the split is a property of the course now, so it
                          belongs where the course is read. */}
                      <p className="text-xs text-muted-foreground">
                        CA {Math.round(course.caWeight * 100)}% · ESE{" "}
                        {Math.round(course.eseWeight * 100)}%
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 flex-shrink-0">
                    {course.enrolledCount > 0 && (
                      <div className="text-right hidden md:block">
                        <p className="text-sm font-semibold text-foreground">
                          {course.enrolledCount}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          enrolled
                        </p>
                      </div>
                    )}
                    <Badge
                      className={
                        course.category === "Compulsory"
                          ? "bg-blue-100 text-blue-700"
                          : course.category === "Elective"
                            ? "bg-purple-100 text-purple-700"
                            : "bg-gray-100 text-gray-700"
                      }
                    >
                      {course.category}
                    </Badge>
                    {scope.kind === "department" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditing(toEditable(course));
                          setEditorOpen(true);
                        }}
                      >
                        <Pencil className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                        Edit
                      </Button>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <CourseEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        course={editing}
        department={scope.kind === "department" ? scope.department : ""}
        onSaved={fetchCourses}
      />
    </div>
  );
}
