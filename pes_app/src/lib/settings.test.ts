import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, gradeForMark, overallMark } from './settings'

describe('gradeForMark (Faculty Handbook boundaries)', () => {
  it.each([
    [100, 'A+', 4.0],
    [85, 'A+', 4.0],
    [84.9, 'A', 4.0],
    [75, 'A', 4.0],
    [70, 'A-', 3.7],
    [65, 'B+', 3.3],
    [60, 'B', 3.0],
    [55, 'B-', 2.7],
    [50, 'C+', 2.3],
    [45, 'C', 2.0],
    [44.9, 'F', 0.0],
    [0, 'F', 0.0],
  ])('a mark of %d is %s (%d)', (mark, grade, gpv) => {
    expect(gradeForMark(mark, DEFAULT_SETTINGS)).toEqual({ grade, gpv })
  })
})

describe('overallMark', () => {
  it('weights CA 30% and the end-semester exam 70% by default', () => {
    expect(overallMark(80, 60, undefined, DEFAULT_SETTINGS)).toBe(66)
  })

  it("uses the course's own weights when it has them", () => {
    expect(overallMark(80, 60, { ca: 0.4, ese: 0.6 }, DEFAULT_SETTINGS)).toBe(68)
  })

  it('rounds to one decimal place', () => {
    expect(overallMark(77, 63, undefined, DEFAULT_SETTINGS)).toBe(67.2)
  })
})

describe('faculty defaults', () => {
  it('match the handbook rules the system enforces', () => {
    expect(DEFAULT_SETTINGS.attendanceThreshold).toBe(80)
    expect(DEFAULT_SETTINGS.graduationTotalCredits).toBe(144)
    expect(DEFAULT_SETTINGS.honoursClassifications.map((c) => c.threshold)).toEqual([3.7, 3.3, 3.0, 2.0])
  })
})
