import { motion } from "framer-motion";
import { BookOpen, Clock, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Badge } from "../ui/badge";
import { Progress } from "../ui/progress";

interface Course {
  id: string;
  code: string;
  name: string;
  credits: number;
  status: "ongoing" | "completed" | "upcoming";
  attendance?: number;
  grade?: string;
  progress?: number;
}

interface CourseCardProps {
  course: Course;
  onClick?: () => void;
}

export function CourseCard({ course, onClick }: CourseCardProps) {
  const statusColors = {
    ongoing: "bg-blue-100 text-blue-700 border-blue-200",
    completed: "bg-green-100 text-green-700 border-green-200",
    upcoming: "bg-yellow-100 text-yellow-700 border-yellow-200",
  };

  const statusLabels = {
    ongoing: "Ongoing",
    completed: "Completed",
    upcoming: "Upcoming",
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3 }}
      whileHover={{ y: -6, transition: { duration: 0.2 } }}
    >
      <Card
        className="cursor-pointer border-border hover:shadow-xl hover:border-primary/50 transition-all duration-300"
        onClick={onClick}
      >
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-1.5 mb-1.5">
                <div className="p-1.5 rounded-lg bg-primary/10">
                  <BookOpen className="h-3.5 w-3.5 text-primary" />
                </div>
                <p className="text-sm font-semibold text-primary">
                  {course.code}
                </p>
              </div>
              <CardTitle className="text-sm leading-tight">
                {course.name}
              </CardTitle>
            </div>
            <Badge className={`${statusColors[course.status]} border`}>
              {statusLabels[course.status]}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                Credits
              </span>
              <span className="font-semibold text-foreground">
                {course.credits}
              </span>
            </div>

            {course.attendance !== undefined && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Attendance</span>
                  <span
                    className={`font-semibold ${course.attendance >= 80 ? "text-green-600" : "text-red-600"}`}
                  >
                    {course.attendance}%
                  </span>
                </div>
                <Progress value={course.attendance} className="h-1.5" />
              </div>
            )}

            {course.grade && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Grade
                </span>
                <span className="font-bold text-base text-primary">
                  {course.grade}
                </span>
              </div>
            )}

            {course.progress !== undefined && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Progress</span>
                  <span className="font-semibold text-foreground">
                    {course.progress}%
                  </span>
                </div>
                <Progress value={course.progress} className="h-1.5" />
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
