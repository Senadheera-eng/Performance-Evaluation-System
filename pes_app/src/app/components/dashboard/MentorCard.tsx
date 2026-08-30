import { useEffect, useState } from "react";
import { Mail, UserRound } from "lucide-react";
import { Button } from "../ui/button";
import { SectionCard, SkeletonRows, StatusBadge } from "../common";
import { getMyMentor, type MyMentor } from "../../../lib/mentorService";

/**
 * The student's academic mentor.
 *
 * A mentor is the one member of staff a student can approach about the whole
 * degree rather than a single course, so their name and address belong on the
 * dashboard rather than filed under a menu. Until the department assigns one
 * the card says so plainly: a student with no mentor should know that is the
 * situation, not wonder whether the page is broken.
 */
export function MentorCard() {
  const [mentor, setMentor] = useState<MyMentor | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    getMyMentor().then((result) => {
      if (!live) return;
      if (result.ok) setMentor(result.data);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, []);

  if (loading) {
    return (
      <SectionCard title="Academic Mentor">
        <SkeletonRows count={1} height="h-12" />
      </SectionCard>
    );
  }

  if (!mentor) {
    return (
      <SectionCard
        title="Academic Mentor"
        description="Your department has not assigned you a mentor yet."
      >
        <p className="text-sm text-muted-foreground">
          A mentor is a lecturer who follows your progress across the whole
          degree. Your head of department assigns one.
        </p>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Academic Mentor"
      description="Your point of contact for anything about your degree."
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
        <span
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-primary/10"
          aria-hidden="true"
        >
          <UserRound className="h-5 w-5 text-primary" />
        </span>
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-foreground">
              {mentor.name}
            </span>
            {mentor.is_hod && <StatusBadge tone="brand">Head of Department</StatusBadge>}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {mentor.department}
          </p>
          <a
            href={`mailto:${mentor.email}`}
            className="mt-0.5 block truncate text-sm text-primary hover:underline"
          >
            {mentor.email}
          </a>
          <p className="mt-1 text-xs text-muted-foreground">
            Your mentor since{" "}
            {new Date(mentor.assigned_at).toLocaleDateString(undefined, {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </p>
        </div>
      </div>
    </SectionCard>
  );
}
