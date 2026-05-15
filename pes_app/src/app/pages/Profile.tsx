import { useEffect, useState, useRef } from "react";
import { motion, number } from "framer-motion";
import {
  Mail,
  MapPin,
  Calendar,
  Award,
  BookOpen,
  TrendingUp,
  GraduationCap,
  Camera,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Avatar, AvatarFallback } from "../components/ui/avatar";
import { Badge } from "../components/ui/badge";
import { Progress } from "../components/ui/progress";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../context/AuthContext";

interface SemesterStat {
  semNum: number;
  label: string;
  sgpa: number;
  credits: number;
  completed: boolean;
}

interface ProfileStats {
  cgpa: number;
  totalCredits: number;
  completedCourses: number;
  currentSemester: number;
}

const achievements = [
  {
    title: "Dean's List",
    semester: "Semester 4",
    icon: Award,
    color: "text-amber-600 bg-amber-100",
  },
  {
    title: "Perfect Attendance",
    semester: "Semester 2",
    icon: Calendar,
    color: "text-green-600 bg-green-100",
  },
  {
    title: "Best Project Award",
    semester: "Semester 3",
    icon: BookOpen,
    color: "text-blue-600 bg-blue-100",
  },
];

const getYearLabel = (batchYear: number): string => {
  const today = new Date();
  const month = today.getMonth();
  const academicYearStart =
    month >= 9 ? today.getFullYear() : today.getFullYear() - 1;
  const yearOfStudy = academicYearStart - batchYear + 1;
  if (yearOfStudy <= 1) return "First Year";
  if (yearOfStudy === 2) return "Second Year";
  if (yearOfStudy === 3) return "Third Year";
  if (yearOfStudy === 4) return "Fourth Year";
  return "Final Year";
};

export default function Profile() {
  const { student } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [stats, setStats] = useState<ProfileStats>({
    cgpa: 0,
    totalCredits: 0,
    completedCourses: 0,
    currentSemester: 5,
  });
  const [semesterStats, setSemesterStats] = useState<SemesterStat[]>([]);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!student?.id) return;
    fetchProfileData();
  }, [student?.id]);

  const fetchProfileData = async () => {
    setLoading(true);

    // Fetch avatar url
    const { data: studentData } = await supabase
      .from("students")
      .select("avatar_url")
      .eq("id", student!.id)
      .single();

    if (studentData?.avatar_url) {
      setAvatarUrl(studentData.avatar_url);
    }

    // Fetch published results
    const { data: results } = await supabase
      .from("results")
      .select(
        `
        gpv,
        academic_year,
        courses (
          semester,
          credits,
          contributes_to_gpa
        )
      `,
      )
      .eq("student_id", student!.id)
      .eq("is_published", true)
      .not("gpv", "is", null);

    // Completed courses count
    const { count: completedCount } = await supabase
      .from("enrollments")
      .select("*", { count: "exact", head: true })
      .eq("student_id", student!.id)
      .eq("status", "completed");

    // Current enrolled to find current semester
    const { data: enrolled } = await supabase
      .from("enrollments")
      .select("courses(semester)")
      .eq("student_id", student!.id)
      .eq("status", "enrolled");

    if (results) {
      const gpaCourses = results.filter(
        (r: any) => r.courses?.contributes_to_gpa && r.gpv !== null,
      );
      const totalWeighted = gpaCourses.reduce(
        (sum: number, r: any) => sum + r.gpv * r.courses.credits,
        0,
      );
      const totalCr = gpaCourses.reduce(
        (sum: number, r: any) => sum + r.courses.credits,
        0,
      );
      const cgpa =
        totalCr > 0 ? Math.round((totalWeighted / totalCr) * 100) / 100 : 0;

      // Per-semester stats
      const semMap: Record<
        number,
        { weighted: number; credits: number; year: string }
      > = {};

      gpaCourses.forEach((r: any) => {
        const semNum = r.courses.semester;
        if (!semMap[semNum])
          semMap[semNum] = { weighted: 0, credits: 0, year: r.academic_year };
        semMap[semNum].weighted += r.gpv * r.courses.credits;
        semMap[semNum].credits += r.courses.credits;
      });

      const semList: SemesterStat[] = Object.entries(semMap)
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([sem, val]) => ({
          semNum: Number(sem),
          label: `Semester ${sem}`,
          sgpa:
            val.credits > 0
              ? Math.round((val.weighted / val.credits) * 100) / 100
              : 0,
          credits: val.credits,
          completed: true,
        }));

      const semNums =
        enrolled
          ?.map((e: any) => e.courses?.semester ?? 0)
          .filter((s: number) => s > 0) ?? [];

      const currentSemNum =
        semNums.length > 0 ? Math.max(...semNums) : semList.length + 1;

      const alreadyHasCurrent = semList.some((s) => s.semNum === currentSemNum);
      if (!alreadyHasCurrent && currentSemNum > 0) {
        semList.push({
          semNum: currentSemNum,
          label: `Semester ${currentSemNum}`,
          sgpa: 0,
          credits: 0,
          completed: false,
        });
      }

      setSemesterStats(semList);
      setStats({
        cgpa,
        totalCredits: totalCr,
        completedCourses: completedCount ?? 0,
        currentSemester: currentSemNum,
      });
    }

    setLoading(false);
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !student?.id) return;

    if (!file.type.startsWith("image/")) {
      alert("Please select an image file.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      alert("Image must be smaller than 2MB.");
      return;
    }

    setUploading(true);

    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(student.id, file, { upsert: true });

    if (!uploadError) {
      const { data } = supabase.storage
        .from("avatars")
        .getPublicUrl(student.id);

      const publicUrl = data.publicUrl;

      await supabase
        .from("students")
        .update({ avatar_url: publicUrl })
        .eq("id", student.id);

      setAvatarUrl(publicUrl + "?t=" + Date.now());
    } else {
      console.error("Upload error:", uploadError);
      alert(
        "Upload failed. Make sure the avatars bucket exists in Supabase Storage.",
      );
    }

    setUploading(false);
  };

  const initials =
    student?.name
      ?.split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) ?? "ST";

  const yearLabel = student?.batch_year
    ? getYearLabel(student.batch_year)
    : "Undergraduate";

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
          View your academic profile and progress.
        </p>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column */}
        <div className="lg:col-span-1 space-y-6">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5 }}
          >
            <Card className="border-border">
              <CardContent className="p-6">
                <div className="flex flex-col items-center text-center">
                  {/* Avatar with upload overlay */}
                  <div
                    className="relative group cursor-pointer mb-4"
                    onClick={() => fileInputRef.current?.click()}
                    title="Click to change profile picture"
                  >
                    <Avatar className="w-24 h-24">
                      {avatarUrl ? (
                        <img
                          src={avatarUrl}
                          alt="Profile"
                          className="w-24 h-24 rounded-full object-cover"
                        />
                      ) : (
                        <AvatarFallback
                          className="text-white text-3xl font-bold w-24 h-24"
                          style={{
                            background:
                              "linear-gradient(135deg, #C41E3A, #6D28D9)",
                          }}
                        >
                          {initials}
                        </AvatarFallback>
                      )}
                    </Avatar>

                    {/* Hover overlay */}
                    <div className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1">
                      {uploading ? (
                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <>
                          <Camera className="h-5 w-5 text-white" />
                          <span className="text-white text-xs font-medium">
                            Change
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Hidden file input */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleAvatarUpload}
                  />

                  <h2 className="text-2xl font-bold text-foreground mb-1">
                    {student?.name ?? "—"}
                  </h2>
                  <p className="text-sm text-muted-foreground mb-2">
                    {student?.reg_number ?? "—"}
                  </p>
                  <Badge className="bg-primary/10 text-primary border-primary/20 mb-6">
                    {yearLabel}
                  </Badge>

                  <div className="w-full space-y-3 pt-4 border-t border-border">
                    <div className="flex items-center gap-3 text-sm">
                      <Mail className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      <span className="text-foreground truncate">
                        {student?.email ?? "—"}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      <MapPin className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      <span className="text-foreground">
                        Faculty of Engineering
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      <Calendar className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      <span className="text-foreground">
                        Batch {student?.batch_year ?? "—"}/
                        {student?.batch_year ? student.batch_year + 1 : "—"}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      <GraduationCap className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      <span className="text-foreground">
                        {student?.department ?? "—"}
                      </span>
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
                  <span className="text-sm text-muted-foreground">
                    Current CGPA
                  </span>
                  <span className="text-xl font-bold text-primary">
                    {loading ? "..." : stats.cgpa.toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Credits Earned
                  </span>
                  <span className="text-xl font-bold text-foreground">
                    {loading ? "..." : stats.totalCredits}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Courses Completed
                  </span>
                  <span className="text-xl font-bold text-foreground">
                    {loading ? "..." : stats.completedCourses}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Current Semester
                  </span>
                  <span className="text-xl font-bold text-foreground">
                    {loading ? "..." : stats.currentSemester}
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
                      <p className="text-sm text-muted-foreground mb-1">
                        Degree Program
                      </p>
                      <p className="font-medium text-foreground">
                        Bachelor of Science of Engineering Honours
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">
                        Specialization
                      </p>
                      <p className="font-medium text-foreground">
                        {student?.department ?? "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">
                        Academic Year
                      </p>
                      <p className="font-medium text-foreground">{yearLabel}</p>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">
                        Registration Number
                      </p>
                      <p className="font-medium text-foreground">
                        {student?.reg_number ?? "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">
                        Faculty
                      </p>
                      <p className="font-medium text-foreground">
                        Faculty of Engineering
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">
                        Intake Batch
                      </p>
                      <p className="font-medium text-foreground">
                        {student?.batch_year ?? "—"}/
                        {student?.batch_year ? student.batch_year + 1 : "—"}
                      </p>
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
                      <div
                        className={`p-3 rounded-lg ${achievement.color} w-fit mb-3`}
                      >
                        <achievement.icon className="h-6 w-6" />
                      </div>
                      <h4 className="font-semibold text-foreground mb-1">
                        {achievement.title}
                      </h4>
                      <p className="text-sm text-muted-foreground">
                        {achievement.semester}
                      </p>
                    </motion.div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Academic Progress */}
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
                {loading ? (
                  <div className="space-y-4">
                    {[1, 2, 3, 4].map((i) => (
                      <div
                        key={i}
                        className="h-10 rounded-lg bg-muted animate-pulse"
                      />
                    ))}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {semesterStats.map((sem, index) => (
                      <div key={index} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <span className="font-medium text-foreground">
                              {sem.label}
                            </span>
                            {sem.completed ? (
                              <Badge className="bg-green-100 text-green-700">
                                Completed
                              </Badge>
                            ) : (
                              <Badge className="bg-blue-100 text-blue-700">
                                In Progress
                              </Badge>
                            )}
                          </div>
                          {sem.completed && (
                            <div className="flex items-center gap-2">
                              <TrendingUp className="h-4 w-4 text-muted-foreground" />
                              <span className="font-semibold text-primary">
                                {sem.sgpa.toFixed(2)}
                              </span>
                            </div>
                          )}
                        </div>
                        <Progress
                          value={sem.completed ? 100 : 60}
                          className="h-2"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
