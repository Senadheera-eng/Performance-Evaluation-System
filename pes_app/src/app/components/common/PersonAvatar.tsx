import { useState } from "react";
import { cn } from "../ui/utils";
import { departmentByName } from "../../../lib/departments";

const SIZES = {
  xs: "h-6 w-6 text-[10px]",
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-20 w-20 text-2xl",
  xl: "h-24 w-24 text-3xl",
} as const;

/** "UW" from "Dr. Udaya Wijenayake": first and last name, title dropped. */
export function initialsOf(name: string | null | undefined): string {
  const parts = (name ?? "")
    .replace(/^(Prof|Dr|Eng|Mr|Mrs|Ms)\.?\s+/i, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

/**
 * A person: their photo when they have one, otherwise their initials in
 * their department's colour. The one avatar every page uses, so a photo a
 * lecturer or student sets shows up everywhere they appear — and the
 * department colour survives the photo, as a ring.
 */
export function PersonAvatar({
  name,
  url,
  department,
  size = "sm",
  className,
}: {
  name: string | null | undefined;
  url?: string | null;
  department?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const [broken, setBroken] = useState<string | null>(null);
  const showPhoto = Boolean(url) && broken !== url;
  const dept = departmentByName(department);
  return (
    <span
      className={cn(
        "inline-flex flex-shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold",
        SIZES[size],
        // Initials sit on the department's tint; a photo has no colour of
        // its own, so it wears a ring in the department's hue instead.
        showPhoto ? dept?.ringClass : (dept?.chipClass ?? "bg-primary/10 text-primary"),
        // A large photo gets a bolder ring, set off from the card.
        showPhoto && dept && (size === "lg" || size === "xl") && "ring-[3px] ring-offset-2 ring-offset-card",
        className,
      )}
      aria-hidden="true"
    >
      {showPhoto ? (
        <img
          src={url!}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setBroken(url ?? null)}
        />
      ) : (
        initialsOf(name)
      )}
    </span>
  );
}
