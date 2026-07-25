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
} from "lucide-react";
import { Card, CardContent } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { PillTabs } from "../components/dashboard/PillTabs";
import { useAuth } from "../context/AuthContext";
import { describeBatch } from "../../lib/batch";
import {
  getActiveFeedbackPeriod,
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
    color: "bg-amber-100 text-amber-800",
    icon: Clock,
    action: "Submit",
  },
  draft: {
    label: "Draft",
    color: "bg-blue-100 text-blue-700",
    icon: FileEdit,
    action: "Continue Draft",
  },
  submitted: {
    label: "Submitted",
    color: "bg-green-100 text-green-700",
    icon: CheckCircle2,
    action: "View",
  },
  closed: {
    label: "Closed",
    color: "bg-gray-100 text-gray-600",
    icon: Clock,
    action: "View",
  },
};

export default function Feedback() {
  const navigate = useNavigate();
  const { student } = useAuth();
  const [period, setPeriod] = useState<FeedbackPeriod | null>(null);
  const [courses, setCourses] = useState<EligibleFeedbackCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("all");

  useEffect(() => {
    if (!student?.id) return;
    fetchData();
  }, [student?.id]);

  const fetchData = async () => {
    setLoading(true);
    const activePeriod = await getActiveFeedbackPeriod();
    setPeriod(activePeriod);
    if (activePeriod) {
      setCourses(await getEligibleCourses(activePeriod.id));
    } else {
      setCourses([]);
    }
    setLoading(false);
  };

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

  const periodStatusLabel = !period
    ? "No active period"
    : remainingDays === 0
      ? "Closing today"
      : `Open until ${new Date(period.closes_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`;

  return (
    <div className="space-y-5">
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

      {loading ? (
        <div className="h-32 rounded-xl bg-muted animate-pulse" />
      ) : !period ? (
        <Card className="border-border">
          <CardContent className="p-8 text-center">
            <MessageSquareText className="h-12 w-12 text-muted-foreground mx-auto mb-3 opacity-50" />
            <h3 className="text-lg font-semibold text-foreground mb-1">
              No feedback period is currently open
            </h3>
            <p className="text-muted-foreground text-sm">
              Check back once your department opens a course feedback period.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
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
                color: "bg-amber-100 text-amber-700",
              },
              {
                label: "Submitted",
                value: submittedCount,
                icon: CheckCircle2,
                color: "bg-green-100 text-green-700",
              },
              {
                label: "Closing Date",
                value: new Date(period.closes_at).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                }),
                icon: Calendar,
                color: "bg-blue-100 text-blue-700",
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
                  <div>
                    <p className="text-xl font-bold text-foreground">
                      {stat.value}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {stat.label}
                    </p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>

          {/* Feedback period banner */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="p-4 rounded-xl bg-primary/5 border border-primary/20"
          >
            <div className="flex items-start justify-between flex-wrap gap-2">
              <div>
                <h3 className="font-semibold text-foreground">
                  {period.title}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {period.batch_year
                    ? `${describeBatch(period.batch_year)} · `
                    : ""}
                  Academic Year {period.academic_year}
                </p>
                <p className="text-sm text-muted-foreground">
                  {periodStatusLabel}
                </p>
              </div>
              <Badge className="bg-green-100 text-green-700">
                {remainingDays} day{remainingDays !== 1 ? "s" : ""} remaining
              </Badge>
            </div>
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
          {filtered.length === 0 ? (
            <div className="text-center py-12">
              <MessageSquareText className="h-16 w-16 text-muted-foreground mx-auto mb-4 opacity-50" />
              <h3 className="text-lg font-semibold text-foreground mb-2">
                No courses found
              </h3>
              <p className="text-muted-foreground text-sm">
                Try adjusting your search or filter.
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
                                    ? "bg-blue-100 text-blue-700"
                                    : "bg-purple-100 text-purple-700"
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
                            <button
                              onClick={() =>
                                navigate(`/app/feedback/${course.course_id}`)
                              }
                              disabled={course.submission_status === "closed"}
                              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {meta.action}
                            </button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
