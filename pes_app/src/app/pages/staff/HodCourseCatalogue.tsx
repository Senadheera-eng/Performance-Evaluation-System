import { GraduationCap } from "lucide-react";
import { EmptyState, PageHeader } from "../../components/common";
import { CourseManagement } from "../admin/AdminCourses";
import { useAuth } from "../../context/AuthContext";
import { getStaffCapabilities } from "../../../lib/staffScope";

/**
 * The department's catalogue and minors, for its head.
 *
 * The same screen the department office uses, given the head's own
 * department. Row security has always allowed this — courses carry a policy
 * for the sitting head, and so do minor requirements — so the only thing
 * missing was a way in. The page refuses a lecturer without the appointment,
 * and so does the database if they type the URL.
 */
export default function HodCourseCatalogue() {
  const { staff } = useAuth();
  const caps = getStaffCapabilities(staff);

  if (!caps.isHod || !caps.hodDepartment) {
    return (
      <div className="space-y-5">
        <PageHeader title="Course Catalogue" />
        <EmptyState
          icon={GraduationCap}
          title="Only the Head of Department can manage the catalogue"
          description="You are seeing this because the page was opened directly. Courses and minors for your department are managed by its head."
        />
      </div>
    );
  }

  return <CourseManagement departmentOverride={caps.hodDepartment} />;
}
