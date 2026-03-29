import { motion } from "motion/react";
import { Mail, Phone, MapPin, Calendar, Award, Edit, BookOpen, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Avatar, AvatarFallback } from "../components/ui/avatar";
import { Badge } from "../components/ui/badge";
import { Progress } from "../components/ui/progress";

// Mock data
const studentInfo = {
  name: "John Doe",
  studentId: "EF/2021/001",
  email: "john.doe@sjp.ac.lk",
  phone: "+94 77 123 4567",
  batch: "2021/2022",
  degree: "Bachelor of Science in Computer Science",
  year: "Third Year",
  cgpa: 3.85,
  totalCredits: 102,
  completedCourses: 35,
};

const achievements = [
  { title: "Dean's List", semester: "Semester 5", icon: Award, color: "text-amber-600 bg-amber-100" },
  { title: "Perfect Attendance", semester: "Semester 4", icon: Calendar, color: "text-green-600 bg-green-100" },
  { title: "Best Project Award", semester: "Semester 3", icon: BookOpen, color: "text-blue-600 bg-blue-100" },
];

const semesterProgress = [
  { semester: "Sem 1", progress: 100, gpa: 3.75 },
  { semester: "Sem 2", progress: 100, gpa: 3.68 },
  { semester: "Sem 3", progress: 100, gpa: 3.82 },
  { semester: "Sem 4", progress: 100, gpa: 3.77 },
  { semester: "Sem 5", progress: 100, gpa: 3.85 },
  { semester: "Sem 6", progress: 75, gpa: 3.92 },
];

export default function Profile() {
  return (
    <div className="space-y-6">
      {/* Page Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h1 className="text-3xl font-bold text-foreground mb-2">My Profile</h1>
        <p className="text-muted-foreground">
          View and manage your academic profile and achievements.
        </p>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Profile Card */}
        <div className="lg:col-span-1 space-y-6">
          {/* Profile Info */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5 }}
          >
            <Card className="border-border">
              <CardContent className="p-6">
                <div className="flex flex-col items-center text-center">
                  <Avatar className="w-24 h-24 mb-4">
                    <AvatarFallback className="bg-gradient-primary text-white text-3xl">
                      JD
                    </AvatarFallback>
                  </Avatar>
                  <h2 className="text-2xl font-bold text-foreground mb-1">
                    {studentInfo.name}
                  </h2>
                  <p className="text-sm text-muted-foreground mb-4">
                    {studentInfo.studentId}
                  </p>
                  <Badge className="bg-primary/10 text-primary border-primary/20 mb-6">
                    {studentInfo.year}
                  </Badge>

                  <Button className="w-full bg-primary hover:bg-primary/90 mb-4">
                    <Edit className="h-4 w-4 mr-2" />
                    Edit Profile
                  </Button>

                  <div className="w-full space-y-3 pt-4 border-t border-border">
                    <div className="flex items-center gap-3 text-sm">
                      <Mail className="h-4 w-4 text-muted-foreground" />
                      <span className="text-foreground">{studentInfo.email}</span>
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      <Phone className="h-4 w-4 text-muted-foreground" />
                      <span className="text-foreground">{studentInfo.phone}</span>
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      <MapPin className="h-4 w-4 text-muted-foreground" />
                      <span className="text-foreground">Faculty of Engineering</span>
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <span className="text-foreground">Batch {studentInfo.batch}</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Quick Stats */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            <Card className="border-border">
              <CardHeader>
                <CardTitle className="text-lg">Quick Stats</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Current CGPA</span>
                  <span className="text-xl font-bold text-primary">{studentInfo.cgpa}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Credits Earned</span>
                  <span className="text-xl font-bold text-foreground">
                    {studentInfo.totalCredits}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Courses Completed</span>
                  <span className="text-xl font-bold text-foreground">
                    {studentInfo.completedCourses}
                  </span>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>

        {/* Right Column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Academic Information */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5 }}
          >
            <Card className="border-border">
              <CardHeader>
                <CardTitle>Academic Information</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Degree Program</p>
                      <p className="font-medium text-foreground">{studentInfo.degree}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Academic Year</p>
                      <p className="font-medium text-foreground">{studentInfo.year}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Enrollment Batch</p>
                      <p className="font-medium text-foreground">{studentInfo.batch}</p>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Student ID</p>
                      <p className="font-medium text-foreground">{studentInfo.studentId}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Faculty</p>
                      <p className="font-medium text-foreground">Faculty of Engineering</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Department</p>
                      <p className="font-medium text-foreground">Computer Science</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Achievements */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            <Card className="border-border">
              <CardHeader>
                <CardTitle>Achievements & Awards</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {achievements.map((achievement, index) => (
                    <motion.div
                      key={index}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.3, delay: 0.2 + index * 0.1 }}
                      className="p-4 rounded-xl bg-muted/50 hover:bg-muted transition-colors"
                    >
                      <div className={`p-3 rounded-lg ${achievement.color} w-fit mb-3`}>
                        <achievement.icon className="h-6 w-6" />
                      </div>
                      <h4 className="font-semibold text-foreground mb-1">
                        {achievement.title}
                      </h4>
                      <p className="text-sm text-muted-foreground">{achievement.semester}</p>
                    </motion.div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Semester Progress */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <Card className="border-border">
              <CardHeader>
                <CardTitle>Academic Progress</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {semesterProgress.map((sem, index) => (
                    <div key={index} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="font-medium text-foreground">{sem.semester}</span>
                          {sem.progress === 100 ? (
                            <Badge className="bg-green-100 text-green-700">Completed</Badge>
                          ) : (
                            <Badge className="bg-blue-100 text-blue-700">In Progress</Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <TrendingUp className="h-4 w-4 text-muted-foreground" />
                          <span className="font-semibold text-primary">{sem.gpa}</span>
                        </div>
                      </div>
                      <Progress value={sem.progress} className="h-2" />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
