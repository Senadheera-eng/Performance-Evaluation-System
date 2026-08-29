import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ErrorState, PageHeader, SkeletonRows } from "../components/common";
import { EnrolmentWindow } from "../components/enrollment/EnrolmentWindow";
import { OutstandingModules } from "../components/enrollment/OutstandingModules";
import {
  SemesterBaskets,
  type Plan,
} from "../components/enrollment/SemesterBaskets";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../context/AuthContext";

/**
 * Course enrolment.
 *
 * The page used to be a flat list of every course in the student's semester,
 * with a checkbox each. That is not the shape of a semester: the handbook sets
 * out compulsory courses and then elective baskets, each asking for a number
 * of credits from the courses in it. A student reading the flat list had to
 * hold the rules in their head from a PDF while ticking boxes.
 *
 * Three things are shown, and they are different obligations. Whether the
 * window is open at all comes first, because it decides what the rest of the
 * page can do. Then modules still owed from an earlier year, which have their
 * own deadline attached. Below them, this semester's baskets.
 *
 * The plan is fetched here rather than inside the baskets, so the banner and
 * the checkboxes are reading the same answer to the same question — one
 * request, one truth about whether enrolment is open.
 */
export default function Enrollment() {
  const { student } = useAuth();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!student?.id) return;
    const { data, error: rpcError } = await supabase.rpc(
      "get_my_enrolment_plan",
    );
    if (rpcError) {
      setError("We could not load your semester plan.");
      setLoading(false);
      return;
    }
    setError(null);
    setPlan(data as Plan);
    setLoading(false);
  }, [student?.id]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-5">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <PageHeader
          title="Course Enrollment"
          description={
            plan
              ? `Semester ${plan.semester}${plan.academic_year ? ` · ${plan.academic_year}` : ""} — compulsory courses and elective baskets, as set out in the Faculty Handbook.`
              : "Your semester's compulsory courses and elective baskets."
          }
        />
      </motion.div>

      {error && <ErrorState message={error} size="inline" />}

      {loading ? (
        <SkeletonRows count={4} height="h-24" />
      ) : (
        plan && (
          <>
            <EnrolmentWindow window={plan.window} semester={plan.semester} />

            {/* Modules still owed from an earlier year, offered by whichever
                batch is sitting them next. Renders nothing when there are
                none. */}
            <OutstandingModules onChanged={load} />

            <SemesterBaskets plan={plan} onChanged={load} />
          </>
        )
      )}
    </div>
  );
}
