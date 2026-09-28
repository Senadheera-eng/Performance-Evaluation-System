import { useAvatarUrls } from "../../lib/avatars";
import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Mail, UserRound } from "lucide-react";
import { Button } from "../components/ui/button";
import {
  DepartmentBadge,
  EmptyState,
  PersonAvatar,
  PageHeader,
  SectionCard,
  SkeletonRows,
  StatusBadge,
} from "../components/common";
import { MentorChat } from "../components/mentor/MentorChat";
import { getMyMentor, type MyMentor } from "../../lib/mentorService";
import { departmentByName } from "../../lib/departments";

/**
 * The student's academic mentor.
 *
 * A section of its own rather than a card on the dashboard: a mentor is a
 * person you go to deliberately, and a conversation you are half-way through
 * should have somewhere to live that is not the bottom of a page about
 * something else.
 *
 * Until the department assigns one the page says so plainly. A student with
 * no mentor should be told that is the situation rather than left wondering
 * whether the page is broken.
 */
export default function Mentor() {
  const [mentor, setMentor] = useState<MyMentor | null>(null);
  const avatars = useAvatarUrls([mentor?.mentor_id]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const result = await getMyMentor();
    if (result.ok) setMentor(result.data);
    setLoading(false);
  }, []);

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
          title="Academic Mentor"
          description="The lecturer who follows your whole degree, and where to reach them."
        />
      </motion.div>

      {loading ? (
        <SkeletonRows count={3} height="h-20" />
      ) : !mentor ? (
        <EmptyState
          icon={UserRound}
          title="No mentor assigned yet"
          description="A mentor is a lecturer who follows your progress across the whole degree. Your head of department assigns one — this page will fill in once they do."
        />
      ) : (
        <>
          <SectionCard
            title="Your mentor"
            className={`border-l-4 ${departmentByName(mentor.department)?.stripeClass ?? ""}`}
            actions={
              <Button size="sm" variant="outline" asChild>
                <a href={`mailto:${mentor.email}`}>
                  <Mail className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  Email
                </a>
              </Button>
            }
          >
            <div className="flex items-start gap-3">
              {/* Their photo, or initials in their department's colour. */}
              <PersonAvatar
                name={mentor.plain_name || mentor.name}
                url={avatars[mentor.mentor_id]}
                department={mentor.department}
                className="h-12 w-12 text-base"
              />
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-semibold text-foreground">
                    {mentor.name}
                  </span>
                  {mentor.is_hod && (
                    <StatusBadge tone="brand">Head of Department</StatusBadge>
                  )}
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <DepartmentBadge department={mentor.department} />
                  {mentor.staff_no && <span>{mentor.staff_no}</span>}
                </p>
                {/* Plain text, to read or copy: the Email button above is
                    the way to write to them, and the address as a second
                    red link only repeated it. */}
                <p className="mt-1 truncate text-sm text-foreground select-all">
                  {mentor.email}
                </p>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Your mentor since{" "}
                  {new Date(mentor.assigned_at).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </p>
              </div>
            </div>
          </SectionCard>

          <SectionCard
            title="Messages"
            description="Only you and your mentor can read this conversation."
          >
            <MentorChat otherAvatarUrl={mentor ? avatars[mentor.mentor_id] : null} />
          </SectionCard>
        </>
      )}
    </div>
  );
}
