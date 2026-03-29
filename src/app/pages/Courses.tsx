import { useState } from "react";
import { motion } from "motion/react";
import { Search, Filter, BookOpen, Clock, CheckCircle2 } from "lucide-react";
import { CourseCard } from "../components/dashboard/CourseCard";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Badge } from "../components/ui/badge";

// Mock data
const allCourses = [
  // Ongoing
  { id: "1", code: "CS301", name: "Software Engineering", credits: 3, status: "ongoing" as const, attendance: 85, progress: 65 },
  { id: "2", code: "CS302", name: "Database Management Systems", credits: 4, status: "ongoing" as const, attendance: 92, progress: 70 },
  { id: "3", code: "CS303", name: "Computer Networks", credits: 3, status: "ongoing" as const, attendance: 78, progress: 55 },
  { id: "4", code: "CS304", name: "Web Technologies", credits: 3, status: "ongoing" as const, attendance: 88, progress: 60 },
  { id: "5", code: "CS305", name: "Machine Learning", credits: 4, status: "ongoing" as const, attendance: 95, progress: 75 },
  
  // Completed
  { id: "6", code: "CS201", name: "Data Structures", credits: 4, status: "completed" as const, grade: "A" },
  { id: "7", code: "CS202", name: "Algorithms", credits: 3, status: "completed" as const, grade: "A-" },
  { id: "8", code: "CS203", name: "Operating Systems", credits: 4, status: "completed" as const, grade: "B+" },
  { id: "9", code: "CS204", name: "Object Oriented Programming", credits: 3, status: "completed" as const, grade: "A" },
  { id: "10", code: "CS205", name: "Computer Architecture", credits: 3, status: "completed" as const, grade: "B+" },
  { id: "11", code: "CS101", name: "Introduction to Computing", credits: 3, status: "completed" as const, grade: "A" },
  { id: "12", code: "CS102", name: "Programming Fundamentals", credits: 4, status: "completed" as const, grade: "A-" },
  
  // Upcoming
  { id: "13", code: "CS401", name: "Artificial Intelligence", credits: 4, status: "upcoming" as const },
  { id: "14", code: "CS402", name: "Cloud Computing", credits: 3, status: "upcoming" as const },
  { id: "15", code: "CS403", name: "Cyber Security", credits: 3, status: "upcoming" as const },
];

export default function Courses() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("all");

  const filteredCourses = allCourses.filter((course) => {
    const matchesSearch =
      course.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      course.code.toLowerCase().includes(searchQuery.toLowerCase());
    
    if (activeTab === "all") return matchesSearch;
    return matchesSearch && course.status === activeTab;
  });

  const stats = {
    all: allCourses.length,
    ongoing: allCourses.filter((c) => c.status === "ongoing").length,
    completed: allCourses.filter((c) => c.status === "completed").length,
    upcoming: allCourses.filter((c) => c.status === "upcoming").length,
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Courses", value: stats.all, icon: BookOpen, color: "bg-primary/10 text-primary" },
          { label: "Ongoing", value: stats.ongoing, icon: Clock, color: "bg-blue-100 text-blue-600" },
          { label: "Completed", value: stats.completed, icon: CheckCircle2, color: "bg-green-100 text-green-600" },
          { label: "Upcoming", value: stats.upcoming, icon: Clock, color: "bg-yellow-100 text-yellow-600" },
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
                <p className="text-2xl font-bold text-foreground">{stat.value}</p>
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
            className="pl-10 h-12 bg-card border-border focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <Button variant="outline" className="h-12 px-6 border-border">
          <Filter className="h-5 w-5 mr-2" />
          Filters
        </Button>
      </motion.div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid grid-cols-4 w-full max-w-2xl">
          <TabsTrigger value="all" className="relative">
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
          <TabsTrigger value="upcoming">
            Upcoming
            <Badge variant="secondary" className="ml-2 bg-muted">
              {stats.upcoming}
            </Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-6">
          {filteredCourses.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-12"
            >
              <BookOpen className="h-16 w-16 text-muted-foreground mx-auto mb-4 opacity-50" />
              <h3 className="text-lg font-semibold text-foreground mb-2">No courses found</h3>
              <p className="text-muted-foreground">
                Try adjusting your search or filter criteria.
              </p>
            </motion.div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredCourses.map((course) => (
                <CourseCard key={course.id} course={course} onClick={() => {}} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
