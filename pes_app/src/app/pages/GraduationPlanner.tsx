import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import {
  GraduationCap,
  Target,
  CheckCircle2,
  XCircle,
  TrendingUp,
  FlaskConical,
  RotateCcw,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "../components/ui/tabs";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../context/AuthContext";

const TOTAL_CREDITS_REQUIRED = 144;
const TOTAL_SEMESTERS = 8;

// Elective credit totals per department+semester, taken directly from the
// handbook's "Elective (N)" labels — e.g. CO Sem7 has "Elective (2)" +
// "Elective (3)" groups = 5 elective credits required, on top of compulsory.
const EXPECTED_ELECTIVE_CREDITS: Record<string, Record<number, number>> = {
  "Computer Engineering": { 7: 5, 8: 5 },
  "Civil Engineering": { 7: 6, 8: 10 },
  "Electrical and Electronic Engineering": { 7: 5, 8: 9 },
  "Mechanical Engineering": { 7: 5, 8: 5 },
};

const GPV: Record<string, number> = {
  "A+": 4.0,
  A: 4.0,
  "A-": 3.7,
  "B+": 3.3,
  B: 3.0,
  "B-": 2.7,
  "C+": 2.3,
  C: 2.0,
  R: 0.0,
  F: 0.0,
  L: 0.0,
};
const GRADE_OPTIONS = Object.keys(GPV);

const CLASSIFICATIONS = [
  { key: "first", label: "First Class Honours", threshold: 3.7 },
  { key: "upper", label: "Second Class (Upper Division)", threshold: 3.3 },
  { key: "lower", label: "Second Class (Lower Division)", threshold: 3.0 },
  { key: "pass", label: "Pass", threshold: 2.0 },
];

const classificationForGpa = (gpa: number): string => {
  if (gpa >= 3.7) return "First Class Honours";
  if (gpa >= 3.3) return "Second Class Honours (Upper Division)";
  if (gpa >= 3.0) return "Second Class Honours (Lower Division)";
  if (gpa >= 2.0) return "Pass";
  return "Below Pass";
};

interface CourseResult {
  resultRowId: string;
  courseId: string;
  code: string;
  title: string;
  semester: number;
  credits: number;
  contributesToGpa: boolean;
  actualGrade: string | null;
}

interface SemesterCredit {
  semester: number;
  compulsoryCredits: number;
}

export default function GraduationPlanner() {
  const { student } = useAuth();
  const [loading, setLoading] = useState(true);
  const [allCourses, setAllCourses] = useState<CourseResult[]>([]);
  const [simulatedGrades, setSimulatedGrades] = useState<
    Record<string, string>
  >({});
  const [currentSemester, setCurrentSemester] = useState(0);
  const [remainingSemesterCredits, setRemainingSemesterCredits] = useState<
    SemesterCredit[]
  >([]);
  const [activeTab, setActiveTab] = useState("standing");

  useEffect(() => {
    if (!student?.id) return;
    fetchData();
  }, [student?.id]);

  const fetchData = async () => {
    setLoading(true);

    const { data: results } = await supabase
      .from("results")
      .select(
        `
        id, grade,
        courses ( id, course_code, title, semester, credits, contributes_to_gpa )
      `,
      )
      .eq("student_id", student!.id)
      .eq("is_published", true)
      .not("gpv", "is", null);

    const courseRows: CourseResult[] = (results ?? [])
      .filter((r: any) => r.courses)
      .map((r: any) => ({
        resultRowId: r.id,
        courseId: r.courses.id,
        code: r.courses.course_code,
        title: r.courses.title,
        semester: r.courses.semester,
        credits: r.courses.credits,
        contributesToGpa: r.courses.contributes_to_gpa,
        actualGrade: r.grade,
      }));

    setAllCourses(courseRows);

    const maxSem = Math.max(
      0,
      ...courseRows.filter((c) => c.contributesToGpa).map((c) => c.semester),
    );
    setCurrentSemester(maxSem);

    if (student?.department) {
      const { data: futureCourses } = await supabase
        .from("courses")
        .select("semester, credits, category, contributes_to_gpa")
        .eq("department", student.department)
        .gt("semester", maxSem)
        .eq("category", "Compulsory")
        .eq("contributes_to_gpa", true);

      const bySem: Record<number, number> = {};
      (futureCourses ?? []).forEach((c: any) => {
        bySem[c.semester] = (bySem[c.semester] ?? 0) + c.credits;
      });

      const list: SemesterCredit[] = [];
      for (let s = maxSem + 1; s <= TOTAL_SEMESTERS; s++) {
        list.push({ semester: s, compulsoryCredits: bySem[s] ?? 0 });
      }
      setRemainingSemesterCredits(list);
    }

    setLoading(false);
  };

  const computeStanding = (gradeOverrides: Record<string, string>) => {
    const gpaCourses = allCourses.filter((c) => c.contributesToGpa);
    let totalWeighted = 0;
    let totalCredits = 0;
    const bySemester: Record<number, { weighted: number; credits: number }> =
      {};

    gpaCourses.forEach((c) => {
      const grade = gradeOverrides[c.resultRowId] ?? c.actualGrade;
      const gpv = grade ? (GPV[grade] ?? 0) : 0;
      totalWeighted += gpv * c.credits;
      totalCredits += c.credits;
      if (!bySemester[c.semester])
        bySemester[c.semester] = { weighted: 0, credits: 0 };
      bySemester[c.semester].weighted += gpv * c.credits;
      bySemester[c.semester].credits += c.credits;
    });

    const cgpa =
      totalCredits > 0
        ? Math.round((totalWeighted / totalCredits) * 100) / 100
        : 0;

    const semesterGpas = Object.entries(bySemester)
      .map(([sem, v]) => ({
        semester: Number(sem),
        sgpa:
          v.credits > 0 ? Math.round((v.weighted / v.credits) * 100) / 100 : 0,
        credits: v.credits,
      }))
      .sort((a, b) => a.semester - b.semester);

    return { cgpa, totalCredits, semesterGpas };
  };

  const actualStanding = useMemo(() => computeStanding({}), [allCourses]);
  const simulatedStanding = useMemo(
    () => computeStanding(simulatedGrades),
    [allCourses, simulatedGrades],
  );

  const hasSimulation = Object.keys(simulatedGrades).length > 0;

  const buildProjections = (cgpa: number, credits: number) => {
    const remaining = Math.max(0, TOTAL_CREDITS_REQUIRED - credits);
    const currentQualityPoints = cgpa * credits;

    return CLASSIFICATIONS.map((c) => {
      const requiredQualityPoints = c.threshold * TOTAL_CREDITS_REQUIRED;
      const requiredAvg =
        remaining > 0
          ? (requiredQualityPoints - currentQualityPoints) / remaining
          : 0;
      return {
        ...c,
        requiredAvg: Math.max(0, Math.min(4.0, requiredAvg)),
        alreadySecured: requiredAvg <= 0,
        feasible: requiredAvg <= 4.0,
        remainingCredits: remaining,
      };
    });
  };

  const activeCgpa =
    activeTab === "simulator" ? simulatedStanding.cgpa : actualStanding.cgpa;
  const activeCredits =
    activeTab === "simulator"
      ? simulatedStanding.totalCredits
      : actualStanding.totalCredits;
  const remainingCredits = Math.max(0, TOTAL_CREDITS_REQUIRED - activeCredits);
  const projections = useMemo(
    () => buildProjections(activeCgpa, activeCredits),
    [activeCgpa, activeCredits],
  );

  const bestPossibleCgpa =
    remainingCredits > 0
      ? Math.round(
          ((activeCgpa * activeCredits + remainingCredits * 4.0) /
            TOTAL_CREDITS_REQUIRED) *
            100,
        ) / 100
      : activeCgpa;

  // Accurate per-semester total credits: confirmed compulsory (from DB) +
  // expected elective credits (from the handbook's Elective(N) labels)
  const semesterTotals = remainingSemesterCredits.map((sem) => {
    const expectedElective =
      EXPECTED_ELECTIVE_CREDITS[student?.department ?? ""]?.[sem.semester] ??
      null;
    const total =
      expectedElective !== null
        ? sem.compulsoryCredits + expectedElective
        : null;
    return { ...sem, expectedElective, total };
  });

  const allSemesterTotalsKnown = semesterTotals.every((s) => s.total !== null);
  const sumOfKnownTotals = semesterTotals.reduce(
    (s, x) => s + (x.total ?? 0),
    0,
  );

  const coursesBySemester = useMemo(() => {
    const gpaCourses = allCourses.filter((c) => c.contributesToGpa);
    const groups: Record<number, CourseResult[]> = {};
    gpaCourses.forEach((c) => {
      if (!groups[c.semester]) groups[c.semester] = [];
      groups[c.semester].push(c);
    });
    return Object.entries(groups)
      .map(([sem, courses]) => ({ semester: Number(sem), courses }))
      .sort((a, b) => a.semester - b.semester);
  }, [allCourses]);

  const renderStandingCards = (cgpa: number, credits: number) => (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <Card className="border-border">
        <CardContent className="p-4">
          <p className="text-sm text-muted-foreground">
            {activeTab === "simulator" ? "Simulated CGPA" : "Current CGPA"}
          </p>
          <p className="text-2xl font-bold text-primary">{cgpa.toFixed(2)}</p>
        </CardContent>
      </Card>
      <Card className="border-border">
        <CardContent className="p-4">
          <p className="text-sm text-muted-foreground">Credits Completed</p>
          <p className="text-2xl font-bold text-foreground">
            {credits} / {TOTAL_CREDITS_REQUIRED}
          </p>
        </CardContent>
      </Card>
      <Card className="border-border">
        <CardContent className="p-4">
          <p className="text-sm text-muted-foreground">Credits Remaining</p>
          <p className="text-2xl font-bold text-foreground">
            {Math.max(0, TOTAL_CREDITS_REQUIRED - credits)}
          </p>
        </CardContent>
      </Card>
      <Card className="border-border">
        <CardContent className="p-4">
          <p className="text-sm text-muted-foreground">Best Possible CGPA</p>
          <p className="text-2xl font-bold text-green-600">
            {bestPossibleCgpa.toFixed(2)}
          </p>
          <p className="text-xs text-muted-foreground">
            if you score A+ every remaining course
          </p>
        </CardContent>
      </Card>
    </div>
  );

  const renderProjectionsCard = () => (
    <Card className="border-border">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Target className="h-5 w-5 text-primary" />
          What You Need for Each Classification
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {projections.map((p) => (
          <div
            key={p.key}
            className="p-4 rounded-xl border border-border flex items-center justify-between gap-4 flex-wrap"
          >
            <div>
              <div className="flex items-center gap-2">
                <h4 className="font-semibold text-foreground">{p.label}</h4>
                <Badge variant="outline" className="text-xs">
                  CGPA ≥ {p.threshold.toFixed(2)}
                </Badge>
              </div>
              {p.alreadySecured ? (
                <p className="text-sm text-green-600 mt-1 flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Already secured — even a 0.00 average in your remaining{" "}
                  {p.remainingCredits} credits keeps you above this
                </p>
              ) : !p.feasible ? (
                <p className="text-sm text-red-600 mt-1 flex items-center gap-1">
                  <XCircle className="h-3.5 w-3.5" />
                  No longer mathematically possible (would require above 4.00
                  GPA)
                </p>
              ) : (
                <p className="text-sm text-muted-foreground mt-1">
                  Average <strong>{p.requiredAvg.toFixed(2)}</strong> GPA across
                  your remaining {p.remainingCredits} credits
                </p>
              )}
            </div>
            <div className="text-right">
              {p.alreadySecured ? (
                <Badge className="bg-green-100 text-green-700">Secured</Badge>
              ) : !p.feasible ? (
                <Badge className="bg-red-100 text-red-700">
                  Not achievable
                </Badge>
              ) : p.requiredAvg >= 3.8 ? (
                <Badge className="bg-amber-100 text-amber-800">
                  Challenging
                </Badge>
              ) : (
                <Badge className="bg-blue-100 text-blue-700">On track</Badge>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="flex items-center gap-3 mb-2">
          <div className="p-3 rounded-xl bg-gradient-to-br from-primary to-primary/70">
            <GraduationCap className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-foreground">
              Graduation Planner
            </h1>
            <p className="text-muted-foreground">
              See what GPA you need in your remaining semesters — or experiment
              with hypothetical grades to see the impact.
            </p>
          </div>
        </div>
      </motion.div>

      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : remainingCredits === 0 && activeTab === "standing" ? (
        <Card className="border-border">
          <CardContent className="p-8 text-center">
            <CheckCircle2 className="h-12 w-12 text-green-600 mx-auto mb-3" />
            <h3 className="text-lg font-semibold text-foreground">
              You've completed the required {TOTAL_CREDITS_REQUIRED} credits
            </h3>
            <p className="text-muted-foreground mt-1">
              Your final classification is based on your current CGPA of{" "}
              {actualStanding.cgpa.toFixed(2)}:{" "}
              <strong>{classificationForGpa(actualStanding.cgpa)}</strong>
            </p>
          </CardContent>
        </Card>
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid grid-cols-2 w-full max-w-md">
            <TabsTrigger value="standing">Current Standing</TabsTrigger>
            <TabsTrigger value="simulator">
              <FlaskConical className="h-4 w-4 mr-1.5" />
              What-If Simulator
            </TabsTrigger>
          </TabsList>

          <TabsContent value="standing" className="space-y-6 mt-6">
            {renderStandingCards(
              actualStanding.cgpa,
              actualStanding.totalCredits,
            )}
            {renderProjectionsCard()}

            <Card className="border-border">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <TrendingUp className="h-5 w-5 text-primary" />
                  Semester-by-Semester Targets
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <p className="text-sm text-muted-foreground">
                  Real course credit data for{" "}
                  {student?.department ?? "your department"}
                  {allSemesterTotalsKnown && (
                    <>
                      :{" "}
                      {semesterTotals
                        .map((s) => `Sem ${s.semester} = ${s.total} credits`)
                        .join(", ")}{" "}
                      (total {sumOfKnownTotals} credits
                      {sumOfKnownTotals !== remainingCredits &&
                      remainingCredits > 0
                        ? `, vs. ${remainingCredits} needed to reach 144 — the gap reflects credits you may not need if you're on the standard load`
                        : ""}
                      ).
                    </>
                  )}
                </p>

                {CLASSIFICATIONS.map((c) => {
                  const proj = projections.find((p) => p.key === c.key)!;
                  if (proj.alreadySecured || !proj.feasible) {
                    return (
                      <div
                        key={c.key}
                        className="p-3 rounded-lg bg-muted/40 flex items-center justify-between"
                      >
                        <span className="font-medium text-foreground text-sm">
                          {c.label}
                        </span>
                        <Badge
                          className={
                            proj.alreadySecured
                              ? "bg-green-100 text-green-700"
                              : "bg-red-100 text-red-700"
                          }
                        >
                          {proj.alreadySecured
                            ? "Already secured"
                            : "Not achievable"}
                        </Badge>
                      </div>
                    );
                  }
                  return (
                    <div key={c.key} className="p-3 rounded-lg bg-muted/40">
                      <p className="font-medium text-foreground text-sm mb-2">
                        {c.label}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        If you achieve an SGPA of approximately{" "}
                        <strong className="text-foreground">
                          {proj.requiredAvg.toFixed(2)}
                        </strong>{" "}
                        in each of{" "}
                        {semesterTotals
                          .map(
                            (s) =>
                              `Semester ${s.semester} (${s.total ?? "?"} credits)`,
                          )
                          .join(" and ")}
                        , you'll reach the CGPA required for {c.label}.
                      </p>
                    </div>
                  );
                })}

                <div className="p-3 rounded-lg bg-blue-50 border border-blue-200">
                  <p className="text-xs text-blue-900">
                    The same SGPA target applies to every remaining semester by
                    design — since your final CGPA is a credit-weighted average
                    across all of them, sustaining one consistent rate reaches
                    the goal regardless of how credits split between semesters.
                    Want a plan where one semester differs from another (e.g.
                    front-loading a harder semester)? Use the What-If Simulator
                    to explore specific combinations.
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="simulator" className="space-y-6 mt-6">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-4 rounded-xl bg-purple-50 border border-purple-200 flex items-start justify-between gap-3 flex-wrap"
            >
              <div className="flex gap-3">
                <FlaskConical className="h-5 w-5 text-purple-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-purple-900">
                  Change any past module's grade below to see how it would have
                  affected your SGPA, CGPA, and what you'd need going forward.
                  This is a sandbox only —{" "}
                  <strong>
                    nothing here changes your real academic record.
                  </strong>
                </p>
              </div>
              {hasSimulation && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSimulatedGrades({})}
                >
                  <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                  Reset to actual results
                </Button>
              )}
            </motion.div>

            {renderStandingCards(
              simulatedStanding.cgpa,
              simulatedStanding.totalCredits,
            )}
            {renderProjectionsCard()}

            <Card className="border-border">
              <CardHeader>
                <CardTitle className="text-lg">
                  Edit Past Module Grades
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {coursesBySemester.map((group) => {
                  const semStanding = simulatedStanding.semesterGpas.find(
                    (s) => s.semester === group.semester,
                  );
                  const actualSemStanding = actualStanding.semesterGpas.find(
                    (s) => s.semester === group.semester,
                  );
                  const changed =
                    semStanding &&
                    actualSemStanding &&
                    semStanding.sgpa !== actualSemStanding.sgpa;
                  return (
                    <div key={group.semester}>
                      <div className="flex items-center gap-2 mb-3">
                        <h4 className="font-semibold text-foreground">
                          Semester {group.semester}
                        </h4>
                        <Badge
                          className={
                            changed
                              ? "bg-purple-100 text-purple-700"
                              : "bg-muted text-muted-foreground"
                          }
                        >
                          SGPA: {semStanding?.sgpa.toFixed(2) ?? "0.00"}
                          {changed &&
                            ` (was ${actualSemStanding!.sgpa.toFixed(2)})`}
                        </Badge>
                      </div>
                      <div className="space-y-2">
                        {group.courses.map((c) => {
                          const effectiveGrade =
                            simulatedGrades[c.resultRowId] ?? c.actualGrade;
                          const isChanged =
                            simulatedGrades[c.resultRowId] &&
                            simulatedGrades[c.resultRowId] !== c.actualGrade;
                          return (
                            <div
                              key={c.resultRowId}
                              className={`flex items-center justify-between p-2.5 rounded-lg ${
                                isChanged ? "bg-purple-50" : "bg-muted/30"
                              }`}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <Badge
                                  variant="outline"
                                  className="text-xs flex-shrink-0"
                                >
                                  {c.code}
                                </Badge>
                                <span className="text-sm text-foreground truncate">
                                  {c.title}
                                </span>
                                <span className="text-xs text-muted-foreground flex-shrink-0">
                                  ({c.credits}cr)
                                </span>
                              </div>
                              <Select
                                value={effectiveGrade ?? undefined}
                                onValueChange={(val) =>
                                  setSimulatedGrades((prev) => ({
                                    ...prev,
                                    [c.resultRowId]: val,
                                  }))
                                }
                              >
                                <SelectTrigger className="w-24 h-8">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {GRADE_OPTIONS.map((g) => (
                                    <SelectItem key={g} value={g}>
                                      {g}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
