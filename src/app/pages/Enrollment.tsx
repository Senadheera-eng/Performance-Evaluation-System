import { useState } from "react";
import { motion } from "motion/react";
import { GraduationCap, Search, CheckCircle, Clock, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Checkbox } from "../components/ui/checkbox";

// Mock data
const availableCourses = [
  {
    id: "1",
    code: "CS401",
    name: "Artificial Intelligence",
    credits: 4,
    category: "core",
    prerequisites: ["CS201", "CS202"],
    seats: 45,
    enrolled: 32,
  },
  {
    id: "2",
    code: "CS402",
    name: "Cloud Computing",
    credits: 3,
    category: "core",
    prerequisites: ["CS303"],
    seats: 40,
    enrolled: 28,
  },
  {
    id: "3",
    code: "CS403",
    name: "Cyber Security",
    credits: 3,
    category: "core",
    prerequisites: ["CS303"],
    seats: 35,
    enrolled: 35,
  },
  {
    id: "4",
    code: "CS404",
    name: "Mobile Application Development",
    credits: 3,
    category: "elective",
    prerequisites: ["CS301"],
    seats: 30,
    enrolled: 22,
  },
  {
    id: "5",
    code: "CS405",
    name: "Data Science",
    credits: 4,
    category: "elective",
    prerequisites: ["CS201", "CS305"],
    seats: 35,
    enrolled: 29,
  },
  {
    id: "6",
    code: "CS406",
    name: "Blockchain Technology",
    credits: 3,
    category: "elective",
    prerequisites: ["CS302"],
    seats: 25,
    enrolled: 18,
  },
];

export default function Enrollment() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCourses, setSelectedCourses] = useState<string[]>([]);

  const filteredCourses = availableCourses.filter(
    (course) =>
      course.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      course.code.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCourseToggle = (courseId: string) => {
    setSelectedCourses((prev) =>
      prev.includes(courseId)
        ? prev.filter((id) => id !== courseId)
        : [...prev, courseId]
    );
  };

  const selectedCredits = availableCourses
    .filter((course) => selectedCourses.includes(course.id))
    .reduce((sum, course) => sum + course.credits, 0);

  const getCourseStatus = (course: typeof availableCourses[0]) => {
    if (course.enrolled >= course.seats) {
      return { label: "Full", color: "bg-red-100 text-red-700", icon: AlertCircle };
    }
    if (course.enrolled / course.seats > 0.8) {
      return { label: "Limited", color: "bg-yellow-100 text-yellow-700", icon: Clock };
    }
    return { label: "Available", color: "bg-green-100 text-green-700", icon: CheckCircle };
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h1 className="text-3xl font-bold text-foreground mb-2">Course Enrollment</h1>
        <p className="text-muted-foreground">
          Select and enroll in courses for the upcoming semester.
        </p>
      </motion.div>

      {/* Enrollment Summary */}
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
                  <p className="text-2xl font-bold text-foreground">{selectedCourses.length}</p>
                  <p className="text-sm text-muted-foreground">Selected Courses</p>
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
                  <CheckCircle className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{selectedCredits}</p>
                  <p className="text-sm text-muted-foreground">Total Credits</p>
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
                  <p className="text-2xl font-bold text-foreground">12-18</p>
                  <p className="text-sm text-muted-foreground">Recommended</p>
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
              <div>
                <Button
                  className="w-full bg-primary hover:bg-primary/90"
                  disabled={selectedCourses.length === 0}
                >
                  Confirm Enrollment
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Search Bar */}
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
            className="pl-10 h-12 bg-card border-border focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </div>
      </motion.div>

      {/* Course Tabs */}
      <Tabs defaultValue="all" className="w-full">
        <TabsList className="grid grid-cols-3 w-full max-w-md">
          <TabsTrigger value="all">All Courses</TabsTrigger>
          <TabsTrigger value="core">Core</TabsTrigger>
          <TabsTrigger value="elective">Elective</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-6">
          <CourseList
            courses={filteredCourses}
            selectedCourses={selectedCourses}
            onCourseToggle={handleCourseToggle}
            getCourseStatus={getCourseStatus}
          />
        </TabsContent>

        <TabsContent value="core" className="mt-6">
          <CourseList
            courses={filteredCourses.filter((c) => c.category === "core")}
            selectedCourses={selectedCourses}
            onCourseToggle={handleCourseToggle}
            getCourseStatus={getCourseStatus}
          />
        </TabsContent>

        <TabsContent value="elective" className="mt-6">
          <CourseList
            courses={filteredCourses.filter((c) => c.category === "elective")}
            selectedCourses={selectedCourses}
            onCourseToggle={handleCourseToggle}
            getCourseStatus={getCourseStatus}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CourseList({
  courses,
  selectedCourses,
  onCourseToggle,
  getCourseStatus,
}: {
  courses: typeof availableCourses;
  selectedCourses: string[];
  onCourseToggle: (id: string) => void;
  getCourseStatus: (course: typeof availableCourses[0]) => {
    label: string;
    color: string;
    icon: any;
  };
}) {
  return (
    <div className="grid grid-cols-1 gap-4">
      {courses.map((course, index) => {
        const status = getCourseStatus(course);
        const StatusIcon = status.icon;
        const isSelected = selectedCourses.includes(course.id);
        const isFull = course.enrolled >= course.seats;

        return (
          <motion.div
            key={course.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: index * 0.05 }}
          >
            <Card
              className={`border-2 transition-all ${
                isSelected
                  ? "border-primary shadow-lg shadow-primary/20"
                  : "border-border hover:border-primary/50"
              } ${isFull ? "opacity-60" : ""}`}
            >
              <CardContent className="p-6">
                <div className="flex items-start gap-4">
                  <div className="pt-1">
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => !isFull && onCourseToggle(course.id)}
                      disabled={isFull}
                    />
                  </div>

                  <div className="flex-1">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="text-lg font-semibold text-foreground">
                            {course.name}
                          </h3>
                          <Badge className="bg-primary/10 text-primary">{course.code}</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {course.credits} Credits •{" "}
                          {course.category.charAt(0).toUpperCase() + course.category.slice(1)}
                        </p>
                      </div>
                      <Badge className={status.color}>
                        <StatusIcon className="h-3 w-3 mr-1" />
                        {status.label}
                      </Badge>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-muted-foreground">Prerequisites:</span>
                        <div className="flex gap-1">
                          {course.prerequisites.map((prereq) => (
                            <Badge key={prereq} variant="outline" className="text-xs">
                              {prereq}
                            </Badge>
                          ))}
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">
                          Seats: {course.enrolled}/{course.seats}
                        </span>
                        <div className="w-32 h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full ${
                              course.enrolled >= course.seats
                                ? "bg-red-500"
                                : course.enrolled / course.seats > 0.8
                                ? "bg-yellow-500"
                                : "bg-green-500"
                            }`}
                            style={{ width: `${(course.enrolled / course.seats) * 100}%` }}
                          />
                        </div>
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
