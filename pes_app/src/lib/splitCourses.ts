import { useEffect, useState } from "react";
import { supabase } from "./supabase";

/**
 * A course taught over two semesters and graded once at the end, such as
 * the Data Management Project: 3 credits in Semester 6, 2 in Semester 7, one
 * grade in Semester 7 for all 5. Its earlier part has no result of its own
 * (the database refuses one), so a result sheet for it says where the grade
 * goes instead of letting someone type marks that can never be saved.
 */
export interface GradedElsewhere {
  code: string;
  semester: number;
  /** The credits the final grade carries: every part's. */
  credits: number;
}

export function useGradedElsewhere(courseId: string | null | undefined): GradedElsewhere | null {
  const [value, setValue] = useState<GradedElsewhere | null>(null);

  useEffect(() => {
    setValue(null);
    if (!courseId) return;
    let live = true;
    (async () => {
      const { data: part } = await supabase
        .from("courses")
        .select("graded_with")
        .eq("id", courseId)
        .maybeSingle();
      if (!part?.graded_with) return;
      const { data: final } = await supabase
        .from("courses")
        .select("course_code, semester, result_credits")
        .eq("id", part.graded_with)
        .maybeSingle();
      if (live && final) {
        setValue({ code: final.course_code, semester: final.semester, credits: final.result_credits });
      }
    })();
    return () => {
      live = false;
    };
  }, [courseId]);

  return value;
}

export const gradedElsewhereMessage = (code: string, semester: number, g: GradedElsewhere) =>
  `${code} has no result of its own in Semester ${semester}. It is graded once, with its Semester ${g.semester} part, for ${g.credits} credits: enter the grade on the Semester ${g.semester} sheet for ${g.code}.`;
