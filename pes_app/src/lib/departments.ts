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
  },
  co: {
    key: "co",
    name: "Computer Engineering",
    code: "CO",
    swatchClass: "bg-dept-co",
    stripeClass: "border-l-dept-co",
    chipClass: "bg-dept-co-soft text-dept-co-fg",
    textClass: "text-dept-co-fg",
  },
  ee: {
    key: "ee",
    name: "Electrical and Electronic Engineering",
    code: "EE",
    swatchClass: "bg-dept-ee",
    stripeClass: "border-l-dept-ee",
    chipClass: "bg-dept-ee-soft text-dept-ee-fg",
    textClass: "text-dept-ee-fg",
  },
  me: {
    key: "me",
    name: "Mechanical Engineering",
    code: "ME",
    swatchClass: "bg-dept-me",
    stripeClass: "border-l-dept-me",
    chipClass: "bg-dept-me-soft text-dept-me-fg",
    textClass: "text-dept-me-fg",
  },
  is: {
    key: "is",
    name: "Interdisciplinary Studies",
    code: "IS",
    swatchClass: "bg-dept-is",
    stripeClass: "border-l-dept-is",
    chipClass: "bg-dept-is-soft text-dept-is-fg",
    textClass: "text-dept-is-fg",
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
 * The department that owns a course, from its code: every course code in
 * the catalogue starts with its department's prefix (CO3554, CE1010, IS3175).
 */
export function departmentByCourseCode(code: string | null | undefined): Department | null {
  if (!code) return null;
  return BY_CODE.get(code.trim().slice(0, 2).toUpperCase()) ?? null;
}
