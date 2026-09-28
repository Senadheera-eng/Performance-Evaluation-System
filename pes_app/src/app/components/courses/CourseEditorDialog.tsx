import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { DepartmentSelect, ErrorState } from "../common";
import { getDepartmentMinors } from "../../../lib/minors";
import { supabase } from "../../../lib/supabase";
import { useSettings } from "../../../lib/settings";

export interface EditableCourse {
  id: string;
  course_code: string;
  title: string;
  credits: number;
  semester: number;
  year: number;
  department: string;
  category: string;
  minor_category: string | null;
  contributes_to_gpa: boolean;
  ca_weight: number;
  ese_weight: number;
}

const CATEGORIES = ["Compulsory", "Elective", "Optional"];

/** Weights are stored as fractions and edited as whole percentages. */
const pct = (fraction: number) => Math.round(fraction * 100);

/**
 * Creating and editing a course a department owns.
 *
 * The assessment split lives on the course rather than in one faculty-wide
 * setting, because courses are not marked alike — a laboratory may sit no
 * mid-semester paper and a project may be continuous assessment throughout.
 * The three shares are entered as percentages and must come to a hundred;
 * the database enforces the same rule, so a bad split cannot be saved by any
 * other route either.
 */
export function CourseEditorDialog({
  open,
  onOpenChange,
  course,
  department,
  departmentOptions,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Null creates a new course. */
  course: EditableCourse | null;
  /** The department a new course belongs to, when the caller owns one. */
  department: string;
  /** Departments to choose from instead — for a super admin, who owns none
   *  of them and must say which the new course belongs to. */
  departmentOptions?: string[];
  onSaved: () => void;
}) {
  const settings = useSettings();

  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [credits, setCredits] = useState(3);
  const [semester, setSemester] = useState(1);
  const [category, setCategory] = useState("Compulsory");
  const [minor, setMinor] = useState("");
  const [countsToGpa, setCountsToGpa] = useState(true);
  const [ca, setCa] = useState(30);
  const [ese, setEse] = useState(70);

  const [newDepartment, setNewDepartment] = useState("");
  const [minorOptions, setMinorOptions] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* A department admin's own department is the only possible answer; a
     super admin has to pick one, and a course with no department belongs
     to nobody's catalogue. */
  const options = departmentOptions ?? [];
  const mustChoose = !department && options.length > 0;
  /* Editing follows the course's own department; creating follows the
     department chosen for it. */
  const targetDepartment = course?.department || department || newDepartment;

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (course) {
      setCode(course.course_code);
      setTitle(course.title);
      setCredits(course.credits);
      setSemester(course.semester);
      setCategory(course.category);
      setMinor(course.minor_category ?? "");
      setCountsToGpa(course.contributes_to_gpa);
      setCa(pct(course.ca_weight));
      setEse(pct(course.ese_weight));
    } else {
      setCode("");
      setTitle("");
      setCredits(3);
      setSemester(1);
      setCategory("Compulsory");
      setMinor("");
      setCountsToGpa(true);
      // A new course starts on the faculty's default split.
      setCa(pct(settings.oaWeights.ca));
      setEse(pct(settings.oaWeights.ese));
      setNewDepartment(department || options[0] || "");
    }
    setConfirmDelete(false);
  }, [open, course, settings]);

  /* The streams on offer where this course lives. */
  useEffect(() => {
    if (!open || !targetDepartment) return;
    let cancelled = false;
    getDepartmentMinors(targetDepartment).then((result) => {
      if (cancelled || !result.ok) return;
      const names = result.data.map((m) => m.minor);
      setMinorOptions(
        minor && !names.includes(minor) ? [...names, minor] : names,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [open, targetDepartment, minor]);

  const total = ca + ese;

  const remove = async () => {
    if (!course) return;
    setSaving(true);
    setError(null);
    const { data, error: deleteError } = await supabase.rpc("delete_course", {
      p_course_id: course.id,
    });
    setSaving(false);
    if (deleteError) {
      setConfirmDelete(false);
      setError(deleteError.message);
      return;
    }
    toast.success((data as { message?: string })?.message ?? "Course removed.");
    onOpenChange(false);
    onSaved();
  };

  const save = async () => {
    if (!code.trim() || !title.trim()) {
      return setError("A course needs a code and a title.");
    }
    if (total !== 100) {
      return setError(
        `The assessment split comes to ${total}%. It has to come to 100%.`,
      );
    }
    if (!course && !targetDepartment) {
      return setError("Choose the department this course belongs to.");
    }

    setSaving(true);
    setError(null);

    const payload = {
      course_code: code.trim().toUpperCase(),
      title: title.trim(),
      credits,
      semester,
      // Two semesters make a year of the degree, so this follows the semester
      // rather than being another thing to keep in step by hand.
      year: Math.ceil(semester / 2),
      category,
      minor_category: minor.trim() || null,
      contributes_to_gpa: countsToGpa,
      ca_weight: ca / 100,
      ese_weight: ese / 100,
    };

    const { error: writeError } = course
      ? await supabase.from("courses").update(payload).eq("id", course.id)
      : await supabase
          .from("courses")
          .insert({ ...payload, department: targetDepartment });

    setSaving(false);
    if (writeError) {
      setError(writeError.message);
      return;
    }
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{course ? "Edit course" : "New course"}</DialogTitle>
          <DialogDescription>
            {course
              ? `${course.course_code} — ${course.department}`
              : department
                ? `A new course in ${department}.`
                : "A new course. Say which department owns it."}
          </DialogDescription>
        </DialogHeader>

        {error && <ErrorState message={error} size="inline" />}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {!course && mustChoose && (
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Department
              </label>
              <DepartmentSelect
                value={newDepartment}
                onChange={setNewDepartment}
                departments={options}
                size="lg"
              />
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Course code
            </label>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g. CO3204"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Credits
            </label>
            <Input
              type="number"
              min={0}
              max={12}
              value={credits}
              onChange={(e) => setCredits(Number(e.target.value))}
            />
          </div>

          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Course name
            </label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Robotic Design"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Semester
            </label>
            <select
              value={semester}
              onChange={(e) => setSemester(Number(e.target.value))}
              className="h-9 w-full rounded-xl border border-border bg-card px-3 text-sm text-foreground"
            >
              {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => (
                <option key={s} value={s}>
                  Semester {s} (Year {Math.ceil(s / 2)})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Category
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="h-9 w-full rounded-xl border border-border bg-card px-3 text-sm text-foreground"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Minor stream (optional)
            </label>
            {/* The streams this department actually offers, rather than free
                text: a typo used to create a stream that matched no minor
                and counted towards nothing. A value already on the course
                that is no longer offered stays selectable, so editing an
                unrelated field cannot silently drop it. */}
            <select
              value={minor}
              onChange={(e) => setMinor(e.target.value)}
              className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm text-foreground"
            >
              <option value="">No minor</option>
              {minorOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              Streams are managed under Minor Specifications.
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-border p-3">
          <p className="text-sm font-medium text-foreground">
            How the overall mark is made up
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            The handbook: "Assessment in respect of each Course consists of CA
            and ESE." The mid-semester paper is one of the components CA is
            built from, so it has no share of its own here.
          </p>

          <div className="mt-3 grid grid-cols-2 gap-3">
            {(
              [
                ["Continuous assessment (CA)", ca, setCa],
                ["End-of-semester (ESE)", ese, setEse],
              ] as const
            ).map(([label, value, set]) => (
              <div key={label}>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  {label}
                </label>
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={value}
                    onChange={(e) => set(Number(e.target.value))}
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
              </div>
            ))}
          </div>

          <p
            className={`mt-2 text-xs ${
              total === 100 ? "text-muted-foreground" : "text-danger-fg"
            }`}
          >
            Total {total}%{total === 100 ? "" : " — must be 100%"}
          </p>
        </div>

        <label className="flex cursor-pointer items-center gap-2">
          <Checkbox
            checked={countsToGpa}
            onCheckedChange={(v) => setCountsToGpa(v === true)}
          />
          <span className="text-sm text-foreground">
            Counts toward GPA
          </span>
        </label>

        {/* Removing a course is only ever right for one that has not been
            taught: every table that points at a course does so on delete
            cascade, so deleting one with a cohort behind it would take their
            marks and registers with it. The database refuses that and names
            what is holding the course; this only offers the button. */}
        {course && confirmDelete && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-destructive/40 bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-500/10 dark:text-red-300">
            <span className="flex-1">
              Delete {course.course_code} from the catalogue? This is only
              possible while nothing has used it.
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={saving}
              onClick={() => setConfirmDelete(false)}
            >
              Keep it
            </Button>
            <Button size="sm" disabled={saving} onClick={remove}>
              Delete
            </Button>
          </div>
        )}

        <DialogFooter>
          {course && !confirmDelete && (
            <Button
              variant="ghost"
              className="mr-auto text-destructive"
              onClick={() => setConfirmDelete(true)}
              disabled={saving}
            >
              <Trash2 className="mr-1.5 h-4 w-4" />
              Delete course
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || total !== 100}>
            {saving ? "Saving…" : course ? "Save changes" : "Create course"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
