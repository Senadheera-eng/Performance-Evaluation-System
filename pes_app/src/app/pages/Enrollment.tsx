import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { PageHeader } from "../components/common";
import { OutstandingModules } from "../components/enrollment/OutstandingModules";
import { SemesterBaskets } from "../components/enrollment/SemesterBaskets";
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
 * Two things are shown, and they are different obligations. Modules still owed
 * from an earlier year come first, because they are the ones with a deadline
 * attached. Below them, this semester's baskets.
 */
export default function Enrollment() {
  const { student } = useAuth();
  const [semester, setSemester] = useState<number | null>(null);
  const [academicYear, setAcademicYear] = useState<string>("");
  const [refresh, setRefresh] = useState(0);

  const load = useCallback(async () => {
    if (!student?.id) return;
    const { data } = await supabase.rpc("get_my_enrolment_plan");
    const plan = data as { semester: number; academic_year: string } | null;
    if (plan) {
      setSemester(plan.semester);
      setAcademicYear(plan.academic_year);
    }
  }, [student?.id]);

  useEffect(() => {
    load();
  }, [load, refresh]);

  const reload = () => setRefresh((n) => n + 1);

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
            semester
              ? `Semester ${semester}${academicYear ? ` · ${academicYear}` : ""} — compulsory courses and elective baskets, as set out in the Faculty Handbook.`
              : "Your semester's compulsory courses and elective baskets."
          }
        />
      </motion.div>

      {/* Modules still owed from an earlier year, offered by whichever batch is
          sitting them next. Renders nothing when there are none. */}
      <OutstandingModules onEnrolled={reload} />

      <SemesterBaskets onEnrolled={reload} />
    </div>
  );
}
