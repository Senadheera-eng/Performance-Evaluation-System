import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import {
  GraduationCap,
  Target,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  TrendingUp,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../context/AuthContext";

const TOTAL_CREDITS_REQUIRED = 144;
const TOTAL_SEMESTERS = 8;

const CLASSIFICATIONS = [
  { key: "first", label: "First Class Honours", threshold: 3.7 },
  {
    key: "upper",
    label: "Second Class (Upper Division)",
    threshold: 3.3,
  },
  {
    key: "lower",
    label: "Second Class (Lower Division)",
    threshold: 3.0,
  },
  { key: "pass", label: "Pass", threshold: 2.0 },
];

const classificationForGpa = (gpa: number): string => {
  if (gpa >= 3.7) return "First Class Honours";
  if (gpa >= 3.3) return "Second Class Honours (Upper Division)";
  if (gpa >= 3.0) return "Second Class Honours (Lower Division)";
  if (gpa >= 2.0) return "Pass";
  return "Below Pass";
};

interface SemesterCredit {
  semester: number;
  compulsoryCredits: number;
}

export default function GraduationPlanner() {
  const { student } = useAuth();
  const [loading, setLoading] = useState(true);
  const [currentCgpa, setCurrentCgpa] = useState(0);
  const [currentCredits, setCurrentCredits] = useState(0);
  const [currentSemester, setCurrentSemester] = useState(0);
  const [remainingSemesterCredits, setRemainingSemesterCredits] = useState<
    SemesterCredit[]
  >([]);

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
        gpv,
        courses ( semester, credits, contributes_to_gpa )
      `,
      )
      .eq("student_id", student!.id)
      .eq("is_published", true)
      .not("gpv", "is", null);

    const gpaCourses = (results ?? []).filter(
      (r: any) => r.courses?.contributes_to_gpa,
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
    const maxSem = Math.max(
      0,
      ...gpaCourses.map((r: any) => r.courses?.semester ?? 0),
    );

    setCurrentCgpa(cgpa);
    setCurrentCredits(totalCr);
    setCurrentSemester(maxSem);

    // Fetch confirmed compulsory credit load for remaining semesters (accurate,
    // since compulsory means "take all" — unlike electives which are "pick one of N")
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

  const remainingCredits = Math.max(0, TOTAL_CREDITS_REQUIRED - currentCredits);
  const currentQualityPoints = currentCgpa * currentCredits;
  const remainingSemesterCount = Math.max(1, TOTAL_SEMESTERS - currentSemester);

  const projections = useMemo(() => {
    return CLASSIFICATIONS.map((c) => {
      const requiredQualityPoints = c.threshold * TOTAL_CREDITS_REQUIRED;
      const requiredAvg =
        remainingCredits > 0
          ? (requiredQualityPoints - currentQualityPoints) / remainingCredits
          : 0;

      const alreadySecured = requiredAvg <= 0;
      const feasible = requiredAvg <= 4.0;

      return {
        ...c,
        requiredAvg: Math.max(0, Math.min(4.0, requiredAvg)),
        rawRequiredAvg: requiredAvg,
        alreadySecured,
        feasible,
      };
    });
  }, [currentCgpa, currentCredits, remainingCredits, currentQualityPoints]);

  const bestPossibleCgpa =
    remainingCredits > 0
      ? Math.round(
          ((currentQualityPoints + remainingCredits * 4.0) /
            TOTAL_CREDITS_REQUIRED) *
            100,
        ) / 100
      : currentCgpa;

  const currentTrackClassification = classificationForGpa(currentCgpa);

  // sum of known compulsory credits so far vs remaining_credits, so we can
  // show an "estimated" elective top-up per semester (transparent, labeled)
  const knownCompulsorySum = remainingSemesterCredits.reduce(
    (s, x) => s + x.compulsoryCredits,
    0,
  );
  const unallocatedElectiveCredits = Math.max(
    0,
    remainingCredits - knownCompulsorySum,
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
              See exactly what GPA you need in your remaining semesters to hit
              your target classification.
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
      ) : remainingCredits === 0 ? (
        <Card className="border-border">
          <CardContent className="p-8 text-center">
            <CheckCircle2 className="h-12 w-12 text-green-600 mx-auto mb-3" />
            <h3 className="text-lg font-semibold text-foreground">
              You've completed the required {TOTAL_CREDITS_REQUIRED} credits
            </h3>
            <p className="text-muted-foreground mt-1">
              Your final classification is based on your current CGPA of{" "}
              {currentCgpa.toFixed(2)}:{" "}
              <strong>{currentTrackClassification}</strong>
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Current standing */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="border-border">
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">Current CGPA</p>
                <p className="text-2xl font-bold text-primary">
                  {currentCgpa.toFixed(2)}
                </p>
              </CardContent>
            </Card>
            <Card className="border-border">
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">
                  Credits Completed
                </p>
                <p className="text-2xl font-bold text-foreground">
                  {currentCredits} / {TOTAL_CREDITS_REQUIRED}
                </p>
              </CardContent>
            </Card>
            <Card className="border-border">
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">
                  Credits Remaining
                </p>
                <p className="text-2xl font-bold text-foreground">
                  {remainingCredits}
                </p>
              </CardContent>
            </Card>
            <Card className="border-border">
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">
                  Best Possible CGPA
                </p>
                <p className="text-2xl font-bold text-green-600">
                  {bestPossibleCgpa.toFixed(2)}
                </p>
                <p className="text-xs text-muted-foreground">
                  if you score A+ every remaining course
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Classification targets */}
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
                      <h4 className="font-semibold text-foreground">
                        {p.label}
                      </h4>
                      <Badge variant="outline" className="text-xs">
                        CGPA ≥ {p.threshold.toFixed(2)}
                      </Badge>
                    </div>
                    {p.alreadySecured ? (
                      <p className="text-sm text-green-600 mt-1 flex items-center gap-1">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Already secured — even a 0.00 average in your remaining{" "}
                        {remainingCredits} credits keeps you above this
                      </p>
                    ) : !p.feasible ? (
                      <p className="text-sm text-red-600 mt-1 flex items-center gap-1">
                        <XCircle className="h-3.5 w-3.5" />
                        No longer mathematically possible (would require above
                        4.00 GPA)
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground mt-1">
                        Average <strong>{p.requiredAvg.toFixed(2)}</strong> GPA
                        across your remaining {remainingCredits} credits
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    {p.alreadySecured ? (
                      <Badge className="bg-green-100 text-green-700">
                        Secured
                      </Badge>
                    ) : !p.feasible ? (
                      <Badge className="bg-red-100 text-red-700">
                        Not achievable
                      </Badge>
                    ) : p.requiredAvg >= 3.8 ? (
                      <Badge className="bg-amber-100 text-amber-800">
                        Challenging
                      </Badge>
                    ) : (
                      <Badge className="bg-blue-100 text-blue-700">
                        On track
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Per-semester breakdown */}
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <TrendingUp className="h-5 w-5 text-primary" />
                Remaining Semesters
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Since your final CGPA weights every semester by its credit load,
                achieving the same target average consistently across each
                remaining semester reaches your goal — shown per semester below
                using each semester's actual credit weight.
              </p>
              <div className="space-y-3">
                {remainingSemesterCredits.map((sem) => {
                  const estimatedTotal =
                    sem.compulsoryCredits +
                    (unallocatedElectiveCredits > 0 &&
                    remainingSemesterCredits.length > 0
                      ? Math.round(
                          unallocatedElectiveCredits /
                            remainingSemesterCredits.length,
                        )
                      : 0);
                  return (
                    <div
                      key={sem.semester}
                      className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                    >
                      <div>
                        <span className="font-medium text-foreground">
                          Semester {sem.semester}
                        </span>
                        <p className="text-xs text-muted-foreground">
                          ~{estimatedTotal || "TBD"} credits estimated (
                          {sem.compulsoryCredits} confirmed compulsory
                          {sem.compulsoryCredits === 0
                            ? " — course data not yet added"
                            : " + electives, varies by your module choice"}
                          )
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
              {unallocatedElectiveCredits > 0 && (
                <div className="mt-4 p-3 rounded-lg bg-blue-50 border border-blue-200 flex gap-2">
                  <AlertTriangle className="h-4 w-4 text-blue-600 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-blue-900">
                    Elective credit loads vary by which modules you choose, so
                    per-semester figures above are estimates. The required
                    average GPA figures above (in "What You Need") are exact
                    regardless, since they're based on your total remaining
                    credit count ({remainingCredits}), not the semester split.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
