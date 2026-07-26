import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  MessageSquareText,
  Search,
  Clock,
  CheckCircle2,
  FileEdit,
  Calendar,
  BookOpen,
  AlertCircle,
  Lock,
} from "lucide-react";
import { Card, CardContent } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { PillTabs } from "../components/dashboard/PillTabs";
import { useAuth } from "../context/AuthContext";
import { describeBatch } from "../../lib/batch";
import {
  getActiveFeedbackPeriods,
  getEligibleCourses,
  FeedbackPeriod,
  EligibleFeedbackCourse,
} from "../../lib/feedbackService";

const daysBetween = (a: Date, b: Date) =>
  Math.ceil((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));

const STATUS_META: Record<
  string,
  { label: string; color: string; icon: any; action: string }
> = {
  pending: {
    label: "Pending",
    color: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
    icon: Clock,
    action: "Submit",
  },
  draft: {
    label: "Draft",
    color: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
    icon: FileEdit,
    action: "Continue Draft",
  },
  submitted: {
    label: "Submitted",
    color: "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300",
    icon: CheckCircle2,
    action: "View",
  },
  closed: {
    label: "Closed",
    color: "bg-muted text-muted-foreground",
    icon: Lock,
    action: "View",
  },
};

export default function Feedback() {
  const navigate = useNavigate();
  const { student } = useAuth();
  const [periods, setPeriods] = useState<FeedbackPeriod[]>([]);
  const [periodId, setPeriodId] = useState<string>("");
  const [courses, setCourses] = useState<EligibleFeedbackCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("all");

  useEffect(() => {
    if (!student?.id) return;
    loadPeriods();
  }, [student?.id]);

  useEffect(() => {
    if (!periodId) return;
    loadCourses(periodId);
  }, [periodId]);

  const loadPeriods = async () => {
    setLoading(true);
    setError(null);

    const result = await getActiveFeedbackPeriods();
    if (!result.ok) {
      setError(result.error);
      setLoading(false);
      return;
    }

    setPeriods(result.data);
    if (result.data.length > 0) {
      setPeriodId(result.data[0].id);
    } else {
      setCourses([]);
      setLoading(false);
    }
  };

  const loadCourses = async (id: string) => {
    setLoading(true);
    setError(null);

    const result = await getEligibleCourses(id);
    if (!result.ok) {
      setError(result.error);
      setCourses([]);
    } else {
      setCourses(result.data);
    }
    setLoading(false);
  };

  const period = periods.find((p) => p.id === periodId) ?? null;

  const pendingCount = courses.filter(
    (c) => c.submission_status === "pending",
  ).length;
  const draftCount = courses.filter((c) => c.submission_status === "draft").length;
  const submittedCount = courses.filter(
    (c) => c.submission_status === "submitted",
  ).length;

  const filtered = courses.filter((c) => {
    const q = searchQuery.toLowerCase();
    const matchSearch =
      !q ||
      c.course_code.toLowerCase().includes(q) ||
      c.title.toLowerCase().includes(q);
    const matchTab = activeTab === "all" || c.submission_status === activeTab;
    return matchSearch && matchTab;
  });

  const remainingDays = period
    ? Math.max(0, daysBetween(new Date(), new Date(period.closes_at)))
    : 0;

  const header = (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <h1 className="text-2xl font-bold text-foreground mb-1">
        Course Feedback
      </h1>
      <p className="text-muted-foreground text-sm">
        Share your course experience and help improve teaching quality and
        course content.
      </p>
    </motion.div>
  );

  if (loading) {
    return (
      <div className="space-y-5">
        {header}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-20 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
        <div className="h-24 rounded-xl bg-muted animate-pulse" />
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-5">
        {header}
        <Card className="border-destructive/30">
          <CardContent className="p-6 text-center">
            <AlertCircle className="h-10 w-10 text-destructive mx-auto mb-3" />
            <h3 className="text-base font-semibold text-foreground mb-1">
              Feedback could not be loaded
            </h3>
            <p className="text-muted-foreground text-sm mb-4">{error}</p>
            <Button onClick={loadPeriods} variant="outline">
              Try again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!period) {
    return (
      <div className="space-y-5">
        {header}
        <Card className="border-border">
          <CardContent className="p-8 text-center">
            <MessageSquareText className="h-12 w-12 text-muted-foreground mx-auto mb-3 opacity-50" />
            <h3 className="text-lg font-semibold text-foreground mb-1">
              No feedback period is currently open
            </h3>
            <p className="text-muted-foreground text-sm">
              When your department opens a feedback period for your courses, it
              will appear here.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {header}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          {
            label: "Available for Feedback",
            value: courses.length,
            icon: BookOpen,
            color: "bg-primary/10 text-primary",
          },
          {
            label: "Pending",
            value: pendingCount,
            icon: Clock,
            color:
              "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
          },
          {
            label: "Submitted",
            value: submittedCount,
            icon: CheckCircle2,
            color:
              "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300",
          },
          {
            label: "Closing Date",
            value: new Date(period.closes_at).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
            }),
            icon: Calendar,
            color:
              "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
          },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3, delay: i * 0.05 }}
            className="bg-card rounded-xl p-3 border border-border shadow-sm"
          >
            <div className="flex items-center gap-2.5">
              <div className={`p-1.5 rounded-lg ${stat.color}`}>
                <stat.icon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-xl font-bold text-foreground">
                  {stat.value}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {stat.label}
                </p>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Period banner */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="p-4 rounded-xl bg-primary/5 border border-primary/20"
      >
        <div className="flex items-start justify-between flex-wrap gap-2">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-foreground">{period.title}</h3>
              <Badge className="bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300">
                Open
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {period.batch_year ? `${describeBatch(period.batch_year)} · ` : ""}
              Semester {period.semester} · Academic Year {period.academic_year}
            </p>
            <p className="text-sm text-muted-foreground">
              {new Date(period.opens_at).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
              {" — "}
              {new Date(period.closes_at).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </p>
            {!period.allow_editing && (
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                Responses cannot be edited once submitted in this period.
              </p>
            )}
          </div>
          <Badge className="bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300">
            {remainingDays} day{remainingDays !== 1 ? "s" : ""} remaining
          </Badge>
        </div>

        {periods.length > 1 && (
          <div className="mt-3">
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Feedback period
            </label>
            <select
              value={periodId}
              onChange={(e) => setPeriodId(e.target.value)}
              className="h-9 px-3 rounded-xl border border-border bg-card text-foreground text-sm w-full sm:w-auto"
            >
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </div>
        )}
      </motion.div>

      {/* Search + filters */}
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
        <PillTabs
          tabs={[
            { value: "all", label: "All" },
            { value: "pending", label: `Pending (${pendingCount})` },
            { value: "draft", label: `Draft (${draftCount})` },
            { value: "submitted", label: `Submitted (${submittedCount})` },
          ]}
          activeTab={activeTab}
          onChange={setActiveTab}
          layoutId="feedback-tab-indicator"
        />
      </div>

      {/* Course list */}
      {courses.length === 0 ? (
        <div className="text-center py-12">
          <MessageSquareText className="h-16 w-16 text-muted-foreground mx-auto mb-4 opacity-50" />
          <h3 className="text-lg font-semibold text-foreground mb-2">
            No courses available for feedback
          </h3>
          <p className="text-muted-foreground text-sm">
            This feedback period doesn't include any course you have taken.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12">
          <Search className="h-16 w-16 text-muted-foreground mx-auto mb-4 opacity-50" />
          <h3 className="text-lg font-semibold text-foreground mb-2">
            No courses match your filter
          </h3>
          <p className="text-muted-foreground text-sm">
            Try a different search term or tab.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((course, index) => {
            const meta = STATUS_META[course.submission_status];
            const StatusIcon = meta.icon;
            return (
              <motion.div
                key={course.course_id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: index * 0.03 }}
              >
                <Card className="border-border hover:border-primary/50 transition-colors">
                  <CardContent className="p-3">
                    <div className="flex items-center gap-3 flex-wrap md:flex-nowrap">
                      <div className="flex-1 min-w-0 basis-full md:basis-auto">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h3 className="text-sm font-semibold text-foreground truncate">
                            {course.title}
                          </h3>
                          <Badge className="bg-primary/10 text-primary text-xs flex-shrink-0">
                            {course.course_code}
                          </Badge>
                          <Badge
                            className={`text-xs flex-shrink-0 ${
                              course.category === "Compulsory"
                                ? "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300"
                                : "bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300"
                            }`}
                          >
                            {course.category}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {course.credits} Credits · Sem {course.semester} ·{" "}
                          {course.department}
                          {course.lecturer_name
                            ? ` · ${course.lecturer_name}`
                            : ""}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Badge className={`${meta.color} flex-shrink-0`}>
                          <StatusIcon className="h-3 w-3 mr-1" />
                          {meta.label}
                        </Badge>
                        <Button
                          size="sm"
                          onClick={() =>
                            navigate(
                              `/app/feedback/${course.course_id}?period=${periodId}`,
                            )
                          }
                          className="bg-primary hover:bg-primary/90"
                        >
                          {meta.action}
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
