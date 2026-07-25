import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  GraduationCap,
  Plus,
  Lock,
  PlayCircle,
  Users,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";
import { supabase } from "../../../lib/supabase";
import { useAuth } from "../../context/AuthContext";
import { describeBatch } from "../../../lib/batch";
import { useSettings } from "../../../lib/settings";


const STATUS_COLOR: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
  open: "bg-green-100 text-green-700",
  closed: "bg-amber-100 text-amber-700",
};

interface EnrollmentPeriod {
  id: string;
  title: string;
  academic_year: string;
  semester: number;
  batch_year: number;
  department: string | null;
  opens_at: string;
  closes_at: string;
  status: "draft" | "open" | "closed";
  enrolledCount?: number;
}

export default function AdminEnrollment() {
  const { student: admin } = useAuth();
  const isSuperAdmin = admin?.role === "super_admin";
  const [periods, setPeriods] = useState<EnrollmentPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (admin) fetchPeriods();
  }, [admin]);

  const fetchPeriods = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("enrollment_periods")
      .select("*")
      .order("created_at", { ascending: false });

    const list = (data ?? []) as EnrollmentPeriod[];

    // Enrolled-student count per period: distinct students of that batch
    // with an active enrollment tagged with the period's academic year.
    const withCounts = await Promise.all(
      list.map(async (p) => {
        const { data: rows } = await supabase
          .from("enrollments")
          .select("student_id, students!inner(batch_year)")
          .eq("status", "enrolled")
          .eq("academic_year", p.academic_year)
          .eq("students.batch_year", p.batch_year);
        const distinct = new Set((rows ?? []).map((r: any) => r.student_id));
        return { ...p, enrolledCount: distinct.size };
      }),
    );

    setPeriods(withCounts);
    setLoading(false);
  };

  const setStatus = async (id: string, status: "open" | "closed") => {
    const { error } = await supabase
      .from("enrollment_periods")
      .update({ status })
      .eq("id", id);
    if (error) {
      setMessage(`Could not update the period: ${error.message}`);
      return;
    }
    setMessage(
      status === "open" ? "Enrolment period opened." : "Enrolment period closed.",
    );
    fetchPeriods();
  };

  return (
    <div className="space-y-5">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h1 className="text-2xl font-bold text-foreground mb-1">
          Enrolment Periods
        </h1>
        <p className="text-muted-foreground text-sm">
          {isSuperAdmin
            ? "Open and close course enrolment windows for each batch."
            : "Enrolment windows are managed by the Super Admin. Shown read-only."}
        </p>
      </motion.div>

      {message && (
        <div className="p-3 rounded-xl bg-green-50 border border-green-200 text-sm text-green-800">
          {message}
        </div>
      )}

      {isSuperAdmin && (
        <div className="flex justify-end">
          <Button
            onClick={() => setCreating(!creating)}
            className="bg-primary hover:bg-primary/90"
          >
            <Plus className="h-4 w-4 mr-1.5" />
            New Enrolment Period
          </Button>
        </div>
      )}

      {creating && (
        <CreatePeriodForm
          adminId={admin?.id ?? ""}
          onCreated={() => {
            setCreating(false);
            setMessage("Enrolment period created as a draft.");
            fetchPeriods();
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      {loading ? (
        <div className="h-40 rounded-xl bg-muted animate-pulse" />
      ) : periods.length === 0 ? (
        <div className="text-center py-16">
          <GraduationCap className="h-16 w-16 text-muted-foreground mx-auto mb-4 opacity-50" />
          <h3 className="text-lg font-semibold text-foreground mb-2">
            No enrolment periods yet
          </h3>
          <p className="text-muted-foreground text-sm">
            Students cannot enrol until a period is opened.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {periods.map((p) => (
            <Card key={p.id} className="border-border">
              <CardContent className="p-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-foreground">
                        {p.title}
                      </span>
                      <Badge className={STATUS_COLOR[p.status]}>
                        {p.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {p.department ?? "All Departments"} ·{" "}
                      {describeBatch(p.batch_year)} · Sem {p.semester} ·{" "}
                      {p.academic_year}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(p.opens_at).toLocaleString()} →{" "}
                      {new Date(p.closes_at).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Users className="h-4 w-4" />
                      {p.enrolledCount ?? 0} enrolled
                    </div>
                    {isSuperAdmin && p.status !== "open" && (
                      <Button
                        size="sm"
                        className="bg-green-600 hover:bg-green-700"
                        onClick={() => setStatus(p.id, "open")}
                      >
                        <PlayCircle className="h-3.5 w-3.5 mr-1" />
                        Open
                      </Button>
                    )}
                    {isSuperAdmin && p.status === "open" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setStatus(p.id, "closed")}
                      >
                        <Lock className="h-3.5 w-3.5 mr-1" />
                        Close
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function CreatePeriodForm({
  adminId,
  onCreated,
  onCancel,
}: {
  adminId: string;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [academicYear, setAcademicYear] = useState(
    `${new Date().getFullYear()}/${new Date().getFullYear() + 1}`,
  );
  const [semester, setSemester] = useState(1);
  const [batchYear, setBatchYear] = useState<number | "">("");
  const [department, setDepartment] = useState("");
  const [opensAt, setOpensAt] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [batches, setBatches] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const settings = useSettings();
  const DEPARTMENTS = settings.studentDepartments;

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("students")
        .select("batch_year")
        .eq("role", "student");
      const distinct = [...new Set((data ?? []).map((s: any) => s.batch_year))]
        .filter((y): y is number => y !== null)
        .sort((a, b) => b - a);
      setBatches(distinct);
      if (distinct.length > 0) setBatchYear(distinct[0]);
    })();
  }, []);

  const handleCreate = async () => {
    setError(null);
    if (!title || !batchYear || !opensAt || !closesAt) {
      setError("Please fill in all fields.");
      return;
    }
    if (new Date(closesAt) <= new Date(opensAt)) {
      setError("Closing date must be after the opening date.");
      return;
    }

    setSaving(true);
    const { error: insertError } = await supabase
      .from("enrollment_periods")
      .insert({
        title,
        academic_year: academicYear,
        semester,
        batch_year: Number(batchYear),
        department: department || null,
        opens_at: new Date(opensAt).toISOString(),
        closes_at: new Date(closesAt).toISOString(),
        status: "draft",
        created_by: adminId,
      });
    setSaving(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }
    onCreated();
  };

  return (
    <Card className="border-border">
      <CardHeader>
        <CardTitle className="text-base">New Enrolment Period</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Title
            </label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Semester 7 Enrolment"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Academic Year
            </label>
            <Input
              value={academicYear}
              onChange={(e) => setAcademicYear(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Semester
            </label>
            <select
              value={semester}
              onChange={(e) => setSemester(Number(e.target.value))}
              className="w-full h-9 px-3 rounded-xl border border-border bg-card text-foreground text-sm"
            >
              {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => (
                <option key={s} value={s}>
                  Semester {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Batch
            </label>
            <select
              value={batchYear}
              onChange={(e) => setBatchYear(Number(e.target.value))}
              className="w-full h-9 px-3 rounded-xl border border-border bg-card text-foreground text-sm"
            >
              {batches.map((b) => (
                <option key={b} value={b}>
                  {describeBatch(b)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Department
            </label>
            <select
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              className="w-full h-9 px-3 rounded-xl border border-border bg-card text-foreground text-sm"
            >
              <option value="">All Departments</option>
              {DEPARTMENTS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Opens At
            </label>
            <Input
              type="datetime-local"
              value={opensAt}
              onChange={(e) => setOpensAt(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Closes At
            </label>
            <Input
              type="datetime-local"
              value={closesAt}
              onChange={(e) => setClosesAt(e.target.value)}
            />
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={onCancel}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            className="flex-1 bg-primary hover:bg-primary/90"
            onClick={handleCreate}
            disabled={saving}
          >
            {saving ? "Creating..." : "Create as Draft"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
