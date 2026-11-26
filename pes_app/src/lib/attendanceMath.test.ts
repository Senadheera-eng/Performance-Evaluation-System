import { describe, expect, it } from 'vitest'
import {
  classifyTier,
  compliantCount,
  getAbsencesAllowed,
  getLecturesNeededToRecover,
  percentageOf,
  totalCount,
} from './attendanceMath'

describe('attendance counts', () => {
  const counts = { present: 7, absent: 2, excused: 1 }

  it('counts an excused lecture as attended', () => {
    expect(compliantCount(counts)).toBe(8)
    expect(totalCount(counts)).toBe(10)
    expect(percentageOf(counts)).toBe(80)
  })

  it('rounds the percentage to a whole number', () => {
    expect(percentageOf({ present: 2, absent: 1, excused: 0 })).toBe(67)
  })

  it('is 0% before any lecture is recorded', () => {
    expect(percentageOf({ present: 0, absent: 0, excused: 0 })).toBe(0)
  })
})

describe('classifyTier with an 80% rule and an 85% warning', () => {
  it.each([
    [79, 'critical'],
    [80, 'at_risk'],
    [84, 'at_risk'],
    [85, 'safe'],
    [89, 'safe'],
    [90, 'excellent'],
    [100, 'excellent'],
  ] as const)('%i%% is %s', (pct, tier) => {
    expect(classifyTier(pct, 10, 80, 85)).toBe(tier)
  })

  it('is pending before any lecture is recorded', () => {
    expect(classifyTier(0, 0, 80, 85)).toBe('pending')
  })

  it('keeps the tiers in order when the warning is set below the rule', () => {
    expect(classifyTier(80, 10, 80, 70)).toBe('safe')
  })

  it('caps the warning at the excellent margin', () => {
    expect(classifyTier(89, 10, 80, 95)).toBe('at_risk')
    expect(classifyTier(90, 10, 80, 95)).toBe('excellent')
  })
})

describe('getAbsencesAllowed', () => {
  it('allows the absences that keep the student at or above 80%', () => {
    // 10 of 10: two more absences leave 10 of 12 (83%); a third, 10 of 13 (77%).
    expect(getAbsencesAllowed(10, 10, 80)).toBe(2)
  })

  it('counts an absence that lands exactly on the threshold', () => {
    // 4 of 4, then one absence: 4 of 5 is exactly 80%.
    expect(getAbsencesAllowed(4, 4, 80)).toBe(1)
    expect(getAbsencesAllowed(8, 8, 80)).toBe(2)
  })

  it('is zero at or below the threshold', () => {
    expect(getAbsencesAllowed(8, 10, 80)).toBe(0)
    expect(getAbsencesAllowed(7, 10, 80)).toBe(0)
  })
})

describe('getLecturesNeededToRecover', () => {
  it('gives the fewest lectures that bring the student back to 80%', () => {
    // 7 of 10, then 5 more attended: 12 of 15 is exactly 80%.
    expect(getLecturesNeededToRecover(7, 10, 80)).toBe(5)
    // 0 of 1, then 4 more: 4 of 5.
    expect(getLecturesNeededToRecover(0, 1, 80)).toBe(4)
  })

  it('is zero once the student is at the threshold', () => {
    expect(getLecturesNeededToRecover(8, 10, 80)).toBe(0)
  })

  it('agrees with exact whole-number arithmetic for every small register', () => {
    for (const pct of [75, 80, 85]) {
      for (let total = 1; total <= 40; total++) {
        for (let attended = 0; attended <= total; attended++) {
          const needed = getLecturesNeededToRecover(attended, total, pct)
          // Attending `needed` more reaches the threshold, and one fewer does not.
          expect(100 * (attended + needed)).toBeGreaterThanOrEqual(pct * (total + needed))
          if (needed > 0) {
            expect(100 * (attended + needed - 1)).toBeLessThan(pct * (total + needed - 1))
          }
          const allowed = getAbsencesAllowed(attended, total, pct)
          // Missing `allowed` more keeps the student at the threshold, one more does not.
          if (100 * attended >= pct * total) {
            expect(100 * attended).toBeGreaterThanOrEqual(pct * (total + allowed))
            expect(100 * attended).toBeLessThan(pct * (total + allowed + 1))
          }
        }
      }
    }
  })
})
