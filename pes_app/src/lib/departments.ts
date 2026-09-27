/**
 * The faculty's departments, and the colour each one carries.
 *
 * The colours are the Faculty Handbook 2026's own: every department's pages
 * are printed in one (see --dept-* in theme.css). Using them here lets a
 * student or lecturer tell whose a course is at a glance — CO3554 carries
 * Computer Engineering's amber wherever it appears.
 *
 * Department colour is identity, never status: an amber stripe means
 * "Computer Engineering", not "warning". Status keeps its own tokens.
 *
 * Class names are written out in full rather than assembled, because
 * Tailwind only generates the classes it can find in the source.
 */

export type DepartmentKey = "ce" | "co" | "ee" | "me" | "is";

export interface Department {
  key: DepartmentKey;
  /** The name exactly as the database stores it. */
  name: string;
  /** The course code prefix, which is also the short label shown. */
  code: string;
  /** Background of a stripe or dot, in the Handbook colour. */
  swatchClass: string;
  /** Left border in the Handbook colour, for a course row or card. */
  stripeClass: string;
  /** A chip: soft background with readable text in the same hue. */
  chipClass: string;
  /** Readable text in the department's hue. */
  textClass: string;
  /**
   * A person's or record's row: a stripe on the left and a faint wash of the
   * hue across the row, so the department reads at a glance whether or not
   * the avatar is a photo.
   */
  rowClass: string;
  /** A ring round a photo avatar, which has no colour of its own. */
  ringClass: string;
  /** A dropdown option: tinted while highlighted or chosen. */
  optionClass: string;
}

export const DEPARTMENTS: Record<DepartmentKey, Department> = {
  ce: {
    key: "ce",
    name: "Civil Engineering",
    code: "CE",
    swatchClass: "bg-dept-ce",
    stripeClass: "border-l-dept-ce",
    chipClass: "bg-dept-ce-soft text-dept-ce-fg",
    textClass: "text-dept-ce-fg",
    rowClass: "border-l-4 border-l-dept-ce bg-dept-ce-soft/50",
    ringClass: "ring-2 ring-dept-ce",
    optionClass: "focus:bg-dept-ce-soft focus:text-dept-ce-fg data-[state=checked]:bg-dept-ce-soft/60",
  },
  co: {
    key: "co",
    name: "Computer Engineering",
    code: "CO",
    swatchClass: "bg-dept-co",
    stripeClass: "border-l-dept-co",
    chipClass: "bg-dept-co-soft text-dept-co-fg",
    textClass: "text-dept-co-fg",
    rowClass: "border-l-4 border-l-dept-co bg-dept-co-soft/50",
    ringClass: "ring-2 ring-dept-co",
    optionClass: "focus:bg-dept-co-soft focus:text-dept-co-fg data-[state=checked]:bg-dept-co-soft/60",
  },
  ee: {
    key: "ee",
    name: "Electrical and Electronic Engineering",
    code: "EE",
    swatchClass: "bg-dept-ee",
    stripeClass: "border-l-dept-ee",
    chipClass: "bg-dept-ee-soft text-dept-ee-fg",
    textClass: "text-dept-ee-fg",
    rowClass: "border-l-4 border-l-dept-ee bg-dept-ee-soft/50",
    ringClass: "ring-2 ring-dept-ee",
    optionClass: "focus:bg-dept-ee-soft focus:text-dept-ee-fg data-[state=checked]:bg-dept-ee-soft/60",
  },
  me: {
    key: "me",
    name: "Mechanical Engineering",
    code: "ME",
    swatchClass: "bg-dept-me",
    stripeClass: "border-l-dept-me",
    chipClass: "bg-dept-me-soft text-dept-me-fg",
    textClass: "text-dept-me-fg",
    rowClass: "border-l-4 border-l-dept-me bg-dept-me-soft/50",
    ringClass: "ring-2 ring-dept-me",
    optionClass: "focus:bg-dept-me-soft focus:text-dept-me-fg data-[state=checked]:bg-dept-me-soft/60",
  },
  is: {
    key: "is",
    name: "Interdisciplinary Studies",
    code: "IS",
    swatchClass: "bg-dept-is",
    stripeClass: "border-l-dept-is",
    chipClass: "bg-dept-is-soft text-dept-is-fg",
    textClass: "text-dept-is-fg",
    rowClass: "border-l-4 border-l-dept-is bg-dept-is-soft/50",
    ringClass: "ring-2 ring-dept-is",
    optionClass: "focus:bg-dept-is-soft focus:text-dept-is-fg data-[state=checked]:bg-dept-is-soft/60",
  },
};

const BY_NAME = new Map(
  Object.values(DEPARTMENTS).map((d) => [d.name.toLowerCase(), d]),
);
const BY_CODE = new Map(Object.values(DEPARTMENTS).map((d) => [d.code, d]));

/** The department for a name as stored ("Computer Engineering"), or null. */
export function departmentByName(name: string | null | undefined): Department | null {
  if (!name) return null;
  return BY_NAME.get(name.trim().toLowerCase()) ?? null;
}

/**
 * The row treatment for a department, or a transparent stripe of the same
 * width for a row with none — so rows stay aligned in a mixed list.
 */
export function departmentRowClass(name: string | null | undefined): string {
  return departmentByName(name)?.rowClass ?? "border-l-4 border-l-transparent";
}

/**
 * A stripe for a record that belongs to one department — a notice, an
 * enrolment window, a feedback round — or a neutral one when it spans the
 * faculty.
 */
export function departmentStripeClass(name: string | null | undefined): string {
  return `border-l-4 ${departmentByName(name)?.stripeClass ?? "border-l-border"}`;
}

/**
 * The department that owns a course, from its code: every course code in
 * the catalogue starts with its department's prefix (CO3554, CE1010, IS3175).
 */
export function departmentByCourseCode(code: string | null | undefined): Department | null {
  if (!code) return null;
  return BY_CODE.get(code.trim().slice(0, 2).toUpperCase()) ?? null;
}
