import { useAvatarUrls } from "../../lib/avatars";
import { useCallback, useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { AtSign, CalendarDays, IdCard, Mail, UserRound } from "lucide-react";
import { Button } from "../components/ui/button";
import {
  cardReveal,
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
  const reduce = useReducedMotion();

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
      <PageHeader
        title="Academic Mentor"
        description="The lecturer who follows your whole degree, and where to reach them."
      />

      {loading ? (
        <SkeletonRows count={3} height="h-20" />
      ) : !mentor ? (
        <EmptyState
          icon={UserRound}
          title="No mentor assigned yet"
          description="A mentor is a lecturer who follows your progress across the whole degree. Your head of department assigns one — this page will fill in once they do."
        />
      ) : (
        /* Who they are beside the conversation on a wide screen, as a
           messaging app keeps the contact in view; one above the other on a
           phone. */
        <div className="grid items-start gap-4 lg:grid-cols-[19rem_minmax(0,1fr)]">
          <motion.section
            variants={cardReveal}
            initial={reduce ? false : "hidden"}
            animate="show"
            aria-label="Your mentor"
            className="overflow-hidden rounded-card border border-border bg-card shadow-elevation-sm lg:sticky lg:top-20"
          >
            <div className="surface-band h-16" aria-hidden="true" />
            <div className="px-4 pb-4 sm:px-5">
              <div className="-mt-10 flex items-end justify-between gap-3">
                {/* Their photo, or initials in their department's colour. */}
                <PersonAvatar
                  name={mentor.plain_name || mentor.name}
                  url={avatars[mentor.mentor_id]}
                  department={mentor.department}
                  size="lg"
                  className="ring-4 ring-card"
                />
                <Button size="sm" variant="outline" asChild>
                  <a href={`mailto:${mentor.email}`}>
                    <Mail className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    Email
                  </a>
                </Button>
              </div>

              <h2 className="mt-3 text-lg font-semibold leading-tight text-foreground">
                {mentor.name}
              </h2>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <DepartmentBadge department={mentor.department} />
                {mentor.is_hod && (
                  <StatusBadge tone="brand">Head of Department</StatusBadge>
                )}
              </div>

              <dl className="mt-4 space-y-3 border-t border-border/70 pt-4 text-sm">
                <div className="flex items-start gap-2.5">
                  <AtSign className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div className="min-w-0">
                    <dt className="text-xs text-muted-foreground">Email</dt>
                    {/* Plain text, to read or copy: the Email button above
                        is the way to write to them. */}
                    <dd className="break-all font-medium text-foreground select-all">
                      {mentor.email}
                    </dd>
                  </div>
                </div>
                {mentor.staff_no && (
                  <div className="flex items-start gap-2.5">
                    <IdCard className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
                    <div className="min-w-0">
                      <dt className="text-xs text-muted-foreground">Staff number</dt>
                      <dd className="font-medium text-foreground">{mentor.staff_no}</dd>
                    </div>
                  </div>
                )}
                <div className="flex items-start gap-2.5">
                  <CalendarDays className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div className="min-w-0">
                    <dt className="text-xs text-muted-foreground">Your mentor since</dt>
                    <dd className="font-medium text-foreground">
                      {new Date(mentor.assigned_at).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}
                    </dd>
                  </div>
                </div>
              </dl>
            </div>
          </motion.section>

          <SectionCard
            title="Messages"
            description="Only you and your mentor can read this conversation."
          >
            <MentorChat otherAvatarUrl={avatars[mentor.mentor_id]} />
          </SectionCard>
        </div>
      )}
    </div>
  );
}
