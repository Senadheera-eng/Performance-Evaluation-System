import { describe, expect, it } from 'vitest'
import {
  bestPossibleCgpa,
  capGrades,
  cgpaPath,
  classTargets,
  computeStanding,
  expectableGrades,
  gradeCap,
  gradeImpact,
  gradeMix,
  openSemesters,
  orderedGrades,
  parsePlan,
  projectedCgpa,
  type PlanResult,
  type SittingCourse,
} from './graduationPlan'
import { DEFAULT_SETTINGS } from './settings'

const scale = DEFAULT_SETTINGS.gpvScale
const classes = DEFAULT_SETTINGS.honoursClassifications

const result = (courseId: string, semester: number, credits: number, grade: string, contributesToGpa = true): PlanResult => ({
  resultRowId: `row-${courseId}`,
  courseId,
  code: courseId,
  title: courseId,
  semester,
  credits,
  contributesToGpa,
  grade,
  gpv: scale[grade],
})

const sitting = (courseId: string, semester: number, credits: number, extra: Partial<SittingCourse> = {}): SittingCourse => ({
  courseId,
  code: courseId,
  title: courseId,
  semester,
  credits,
  resultCredits: credits,
  contributesToGpa: true,
  previous: null,
  gradedIn: null,
  earlierParts: [],
  ...extra,
})

/* A small record: 18 points over 5 credits in Semester 1 (SGPA 3.60) and
   6 points over 3 credits in Semester 2 (2.00); CGPA 24 / 8 = 3.00. The
   non-GPA course must not count. */
const record: PlanResult[] = [
  result('CO1', 1, 3, 'A'),
  result('CO2', 1, 2, 'B'),
  result('CO3', 2, 3, 'C'),
  result('IS1', 2, 2, 'A', false),
]

describe('grade lists', () => {
  it('orders grades best first, A+ before A', () => {
    expect(orderedGrades(scale)).toEqual(['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'F', 'L', 'R'])
  })

  it('offers every passing grade and F, but not R or L', () => {
    expect(expectableGrades(scale)).toEqual(['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'F'])
  })
})

describe('repeat cap', () => {
  it('caps a course repeated after an F or re-sat after an R at C', () => {
    const afterF = sitting('CO9', 4, 3, { previous: { grade: 'F', gpv: 0, originalGrade: null } })
    const afterR = sitting('CO9', 4, 3, { previous: { grade: 'C', gpv: 2, originalGrade: 'R' } })
    expect(gradeCap(afterF, 'C')).toBe('C')
    expect(gradeCap(afterR, 'C')).toBe('C')
  })

  it('does not cap a first attempt', () => {
    expect(gradeCap(sitting('CO9', 4, 3), 'C')).toBeNull()
  })

  it('leaves only C and F to choose from under the cap', () => {
    expect(capGrades(expectableGrades(scale), 'C', scale)).toEqual(['C', 'F'])
    expect(capGrades(['A', 'B'], null, scale)).toEqual(['A', 'B'])
  })
})

describe('computeStanding', () => {
  it('weights each grade point by its credits', () => {
    const s = computeStanding(record, scale)
    expect(s.points).toBe(24)
    expect(s.credits).toBe(8)
    expect(s.cgpa).toBe(3)
    expect(s.semesterGpas).toEqual([
      { semester: 1, sgpa: 3.6, credits: 5 },
      { semester: 2, sgpa: 2, credits: 3 },
    ])
  })

  it('uses a tried-out grade in place of the recorded one', () => {
    const s = computeStanding(record, scale, { 'row-CO3': 'A' })
    expect(s.cgpa).toBe(3.75) // (24 - 6 + 12) / 8
  })

  it('adds a guessed grade for a new course as more credits', () => {
    const s = computeStanding(record, scale, {}, [sitting('CO4', 3, 3)], { CO4: 'B+' })
    expect(s.credits).toBe(11)
    expect(s.cgpa).toBe(3.08) // (24 + 9.9) / 11
    expect(s.guessedNewCredits).toBe(3)
    expect(s.guessedNewCreditsBySemester).toEqual({ 3: 3 })
  })

  it('lets a repeat replace the failed attempt instead of adding to it', () => {
    const failed = [...record, result('CO5', 2, 2, 'F')]
    const repeat = sitting('CO5', 4, 2, { previous: { grade: 'F', gpv: 0, originalGrade: null } })
    const s = computeStanding(failed, scale, {}, [repeat], { CO5: 'C' })
    expect(s.credits).toBe(10)
    expect(s.points).toBe(28) // the F's 0 points become 2 x 2.0
    expect(s.guessedNewCredits).toBe(0)
  })

  it('ignores a guess for a part graded in a later semester', () => {
    const earlierPart = sitting('CO6', 7, 2, { gradedIn: { code: 'CO6B', semester: 8, credits: 4 } })
    const s = computeStanding(record, scale, {}, [earlierPart], { CO6: 'A' })
    expect(s.credits).toBe(8)
  })
})

describe('planning the semesters ahead', () => {
  const plan = parsePlan({
    semesters: [
      { semester: 7, credits: 16, source: 'enrolled' },
      { semester: 8, credits: 21, source: 'curriculum' },
    ],
  })
  const standing = computeStanding(record, scale)

  it('moves the projected CGPA with a planned SGPA', () => {
    // Regression: choosing an SGPA for Semester 7 must change the projection.
    const open = openSemesters(plan, standing, { 7: 4.0 })
    expect(open[0].planned).toBe(4)
    expect(open[1].planned).toBeNull()
    expect(projectedCgpa(standing, open)).toBe(3.67) // (24 + 64) / 24
  })

  it('works out the SGPA each class needs over the open credits', () => {
    const targets = classTargets(standing, openSemesters(plan, standing), classes)
    const first = targets.find((t) => t.key === 'first')!
    const pass = targets.find((t) => t.key === 'pass')!
    expect(first.finalCredits).toBe(45)
    expect(first.freeCredits).toBe(37)
    expect(first.required).toBeCloseTo((3.7 * 45 - 24) / 37, 10)
    expect(first.feasible).toBe(true)
    expect(first.alreadySecured).toBe(false)
    expect(pass.required).toBeCloseTo((2.0 * 45 - 24) / 37, 10)
  })

  it('lands on the planned CGPA once every open credit is planned', () => {
    const targets = classTargets(standing, openSemesters(plan, standing, { 7: 3.0, 8: 3.0 }), classes)
    expect(targets[0].plannedFinalCgpa).toBe(3) // 3.0 everywhere keeps 3.00
  })

  it('marks a class secured, or out of reach, with nothing left to sit', () => {
    const none = parsePlan({ semesters: [] })
    const targets = classTargets(standing, openSemesters(none, standing), classes)
    const pass = targets.find((t) => t.key === 'pass')!
    const first = targets.find((t) => t.key === 'first')!
    expect(pass.alreadySecured).toBe(true)
    expect(pass.required).toBe(0)
    expect(first.required).toBe(Infinity)
    expect(first.feasible).toBe(false)
  })

  it('gives the best CGPA still possible with an A+ in every open credit', () => {
    expect(bestPossibleCgpa(standing, openSemesters(plan, standing))).toBe(3.82) // (24 + 4 x 37) / 45
  })
})

describe('gradeImpact', () => {
  it("is a course's credits over the credits the record will carry", () => {
    const standing = computeStanding(record, scale)
    const project = sitting('CO7', 7, 3)
    const other = sitting('CO8', 7, 2)
    expect(gradeImpact(project, standing, [project, other])).toBeCloseTo(3 / 13, 10)
  })
})

describe('gradeMix', () => {
  it('describes a target SGPA as grades', () => {
    // The handbook example: 13 x 4.0 + 3 x 3.7 = 63.1, which reaches 3.93 x 16 = 62.9.
    expect(gradeMix(3.93, 16, scale)).toBe('≈ A in 13 of 16 credits, A- in the rest')
  })

  it('names a single grade when the target is a grade point', () => {
    expect(gradeMix(3.0, 16, scale)).toBe('≈ B in every course')
  })

  it('settles on the lowest pass for a target below it', () => {
    expect(gradeMix(1.5, 16, scale)).toBe('≈ C in every course')
  })

  it('gives nothing for an impossible target or no credits', () => {
    expect(gradeMix(4.2, 16, scale)).toBeNull()
    expect(gradeMix(3.5, 0, scale)).toBeNull()
  })
})

describe('cgpaPath', () => {
  it('joins the projected line to the last semester on the record', () => {
    const standing = computeStanding(record, scale)
    const plan = parsePlan({ semesters: [{ semester: 3, credits: 10, source: 'estimate' }] })
    const path = cgpaPath(standing, openSemesters(plan, standing), () => 3.0, 3)
    expect(path).toEqual([
      { semester: 1, actual: 3.6, projected: null },
      { semester: 2, actual: 3, projected: 3 },
      { semester: 3, actual: null, projected: 3 }, // (24 + 30) / 18
    ])
  })
})

describe('parsePlan', () => {
  it('falls back to the faculty defaults', () => {
    const plan = parsePlan(null)
    expect(plan.totalSemesters).toBe(8)
    expect(plan.resitMaxGrade).toBe('C')
    expect(plan.requirements.creditsRequired).toBe(144)
    expect(plan.requirements.minor).toBeNull()
    expect(plan.courses).toEqual([])
  })

  it('reads a course as the database returns it', () => {
    const plan = parsePlan({
      courses: [{ course_id: 'c1', course_code: 'CO4002', title: 'Engineering Project', semester: 7, credits: 4, contributes_to_gpa: true, previous: { grade: 'F', gpv: '0.0' } }],
    })
    expect(plan.courses[0]).toMatchObject({
      courseId: 'c1',
      code: 'CO4002',
      resultCredits: 4,
      contributesToGpa: true,
      previous: { grade: 'F', gpv: 0, originalGrade: null },
    })
  })
})
