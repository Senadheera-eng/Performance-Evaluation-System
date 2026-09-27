import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Award,
  BookOpenCheck,
  Camera,
  GraduationCap,
  Loader2,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "../components/ui/button";
import {
  DepartmentBadge,
  PageHeader,
  SectionCard,
  SkeletonRows,
  SkeletonStatGrid,
  StatCard,
  StatusBadge,
} from "../components/common";
import { cn } from "../components/ui/utils";
import { supabase } from "../../lib/supabase";
import { departmentByName } from "../../lib/departments";
import { useAuth } from "../context/AuthContext";
import { describeBatch } from "../../lib/batch";
import { removeMyAvatar, uploadMyAvatar } from "../../lib/avatars";

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

/* The year of study, from the semester the database says the student is
   in. It used to be worked out again from the calendar month, which in
   September called a semester 7 student "Final Year" while every other
   page had them in their fourth. */
const YEAR_LABEL = ["", "First Year", "Second Year", "Third Year", "Fourth Year"];
const yearOfStudy = (semester: number): string =>
  YEAR_LABEL[Math.ceil(semester / 2)] ?? "Final Year";

/**
 * The student's profile: who they are on the faculty's books, and a short
 * record of how their degree is going.
 *
 * Each fact appears once. The page used to show the index number,
 * registration number, faculty, batch and department in a card on the left
 * and again under "Academic Information" on the right, and drew a progress
 * bar for every semester that was either full or stuck at a made-up 60%.
 */
export default function Profile() {
  const { student, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [stats, setStats] = useState<ProfileStats>({
    cgpa: 0,
    totalCredits: 0,
    completedCourses: 0,
    currentSemester: 0,
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
      .from("my_published_results")
      .select("gpv, academic_year, semester, credits, contributes_to_gpa")
      .not("gpv", "is", null);

    // Completed courses count — sourced from published results, not
    // `enrollments`, since historical semesters were bulk-imported straight
    // into `results` without matching enrollment rows.
    const { count: completedCount } = await supabase
      .from("my_published_results")
      .select("*", { count: "exact", head: true })
      .not("grade", "is", null)
      // A course sat twice is one course completed, not two.
      .eq("is_latest_attempt", true);

    // Current enrolled to find current semester
    const { data: enrolled } = await supabase
      .from("enrollments")
      .select("courses(semester)")
      .eq("student_id", student!.id)
      .eq("status", "enrolled");

    if (results) {
      const gpaCourses = results.filter(
        (r: any) => r.contributes_to_gpa && r.gpv !== null,
      );
      const totalWeighted = gpaCourses.reduce(
        (sum: number, r: any) => sum + r.gpv * r.credits,
        0,
      );
      const totalCr = gpaCourses.reduce(
        (sum: number, r: any) => sum + r.credits,
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
        const semNum = r.semester;
        if (!semMap[semNum])
          semMap[semNum] = { weighted: 0, credits: 0, year: r.academic_year };
        semMap[semNum].weighted += r.gpv * r.credits;
        semMap[semNum].credits += r.credits;
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

      /* Which semester this student is in, asked of the database rather
         than worked out again here: the rest of the system reads
         current_semester_for_batch, and a second rule that happened to
         agree today would drift the moment results were published before
         the next enrolment opened. The old derivation stays as the
         fallback for a student whose batch has published nothing yet. */
      const { data: canonicalSemester } = await supabase.rpc(
        "my_current_semester",
      );

      const semNums =
        enrolled
          ?.map((e: any) => e.courses?.semester ?? 0)
          .filter((s: number) => s > 0) ?? [];

      const currentSemNum =
        typeof canonicalSemester === "number" && canonicalSemester > 0
          ? canonicalSemester
          : semNums.length > 0
            ? Math.max(...semNums)
            : semList.length + 1;

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

  /* Through the shared helpers, so the new photo is versioned (browsers
     fetch it afresh) and the whole app, not just this page, picks it up. */
  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !student?.id) return;
    setUploading(true);
    const result = await uploadMyAvatar(student.id, file);
    setUploading(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setAvatarUrl(result.url);
    toast.success("Profile photo updated");
    refreshProfile();
  };

  const handleAvatarRemove = async () => {
    if (!student?.id) return;
    setUploading(true);
    const result = await removeMyAvatar(student.id);
    setUploading(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setAvatarUrl(null);
    toast.success("Profile photo removed");
    refreshProfile();
  };

  const initials =
    student?.name
      ?.split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) ?? "ST";

  const yearLabel =
    stats.currentSemester > 0 ? yearOfStudy(stats.currentSemester) : "Undergraduate";

  const deansListSemesters = semesterStats.filter(
    (s) => s.completed && s.sgpa >= 3.8,
  );

  const dept = departmentByName(student?.department);

  const details: [string, React.ReactNode][] = [
    ["Index number", student?.index_number ?? "—"],
    ["Registration number", student?.reg_number ? `EN${student.reg_number}` : "—"],
    ["University email", student?.email ?? "—"],
    ["Degree", "Bachelor of Science of Engineering Honours"],
    ["Faculty", "Faculty of Engineering"],
    ["Intake", describeBatch(student?.batch_year)],
    [
      "Current semester",
      stats.currentSemester > 0 ? `Semester ${stats.currentSemester} · ${yearLabel}` : "—",
    ],
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="My Profile"
        description="Your record on the faculty's books, and how your degree is going."
      />

      {/* Who you are */}
      <SectionCard>
        <div className="flex flex-col gap-5 md:flex-row md:items-start">
          <div className="flex items-center gap-4 md:w-72 md:flex-shrink-0 md:flex-col md:items-center md:text-center">
            {/* A real button, so the photo can be changed by keyboard and on
                a phone; the change used to appear only on mouse hover. */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              aria-label="Change profile photo"
              className="group relative flex-shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-card"
            >
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt=""
                  className="h-20 w-20 rounded-full object-cover md:h-24 md:w-24"
                />
              ) : (
                <span
                  className={cn(
                    "flex h-20 w-20 items-center justify-center rounded-full text-2xl font-bold md:h-24 md:w-24",
                    dept?.chipClass ?? "bg-primary/10 text-primary",
                  )}
                >
                  {initials}
                </span>
              )}
              <span className="absolute bottom-0 right-0 flex h-7 w-7 items-center justify-center rounded-full border-2 border-card bg-primary text-primary-foreground shadow-elevation-sm">
                {uploading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Camera className="h-3.5 w-3.5" aria-hidden="true" />
                )}
              </span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarUpload}
            />

            <div className="min-w-0">
              <h2 className="text-lg font-bold leading-tight text-foreground">
                {student?.name ?? "—"}
              </h2>
              {avatarUrl && (
                <button
                  type="button"
                  onClick={handleAvatarRemove}
                  disabled={uploading}
                  className="mt-1 text-xs text-muted-foreground underline-offset-2 hover:text-danger-fg hover:underline"
                >
                  Remove photo
                </button>
              )}
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 md:justify-center">
                {student?.department && <DepartmentBadge department={student.department} />}
                {!loading && <StatusBadge tone="brand">{yearLabel}</StatusBadge>}
              </div>
            </div>
          </div>

          <dl className="grid flex-1 grid-cols-1 gap-x-6 gap-y-3 border-t border-border/70 pt-4 sm:grid-cols-2 md:border-l md:border-t-0 md:pl-6 md:pt-0">
            {details.map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-0.5 break-words text-sm font-medium text-foreground">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </SectionCard>

      {/* The numbers, each opening the page that explains it */}
      {loading ? (
        <SkeletonStatGrid count={4} />
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            index={0}
            label="Current CGPA"
            value={stats.totalCredits > 0 ? stats.cgpa.toFixed(2) : "—"}
            icon={TrendingUp}
            tone="brand"
            hint="Cumulative GPA"
            onClick={() => navigate("/app/results")}
          />
          <StatCard
            index={1}
            label="Credits earned"
            value={stats.totalCredits}
            icon={GraduationCap}
            tone="success"
            hint="Counted toward the GPA"
            onClick={() => navigate("/app/planner")}
          />
          <StatCard
            index={2}
            label="Courses completed"
            value={stats.completedCourses}
            icon={BookOpenCheck}
            tone="neutral"
            hint="With a published grade"
            onClick={() => navigate("/app/courses")}
          />
          <StatCard
            index={3}
            label="Dean's List"
            value={deansListSemesters.length}
            icon={Award}
            tone="brand"
            hint={
              deansListSemesters.length > 0
                ? deansListSemesters.map((s) => `Sem ${s.semNum}`).join(", ")
                : "An SGPA of 3.80 or more in a semester"
            }
          />
        </div>
      )}

      {/* Semester by semester, without the progress bars: a finished
          semester was always a full bar and the current one a fixed 60%,
          which said nothing. The SGPA is the fact. */}
      <SectionCard
        title="Semester record"
        description="Your GPA for each semester so far."
        actions={
          <Button
            variant="ghost"
            size="sm"
            className="text-primary hover:text-primary/80"
            onClick={() => navigate("/app/results")}
          >
            Full results
          </Button>
        }
        flush
      >
        {loading ? (
          <div className="p-4">
            <SkeletonRows count={4} height="h-10" />
          </div>
        ) : semesterStats.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            Your semesters appear here once your first results are published.
          </p>
        ) : (
          <ul className="divide-y divide-border/70">
            {semesterStats.map((sem) => (
              <li key={sem.semNum} className="flex items-center gap-3 px-4 py-2.5">
                <span className="w-24 flex-shrink-0 text-sm font-medium text-foreground">
                  {sem.label}
                </span>
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                  {sem.completed ? (
                    <StatusBadge tone="success" dot>Completed</StatusBadge>
                  ) : (
                    <StatusBadge tone="info" dot>In progress</StatusBadge>
                  )}
                  {sem.completed && sem.sgpa >= 3.8 && (
                    <StatusBadge tone="brand" icon={Award}>
                      Dean's List
                    </StatusBadge>
                  )}
                </span>
                <span className="text-right">
                  {sem.completed ? (
                    <>
                      <span className="block text-sm font-semibold tabular-nums text-foreground">
                        {sem.sgpa.toFixed(2)}
                      </span>
                      <span className="block text-[11px] text-muted-foreground">SGPA</span>
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">Results pending</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
