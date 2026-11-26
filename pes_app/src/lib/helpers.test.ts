/* Small pure helpers: formatting, chart sentences, batch numbers, minor
   baskets, and how the two machine-learning models' checks are read. */
import { describe, expect, it } from 'vitest'
import { describeBatch, getBatchNumber } from './batch'
import { reviewCheck, type CheckinReview } from './checkinReview'
import { formatDateTime, formatRegNumber } from './format'
import { modelCheck, type ForecastModel } from './gradeForecast'
import { basketMet, planSemesters, statusCounts, type MinorPlan, type MinorPlanBasket } from './minorPlan'
import { gpaTrendTakeaway, gradeSpreadTakeaway } from './takeaways'

describe('formatRegNumber', () => {
  it('adds the EN prefix once', () => {
    expect(formatRegNumber('108953')).toBe('EN108953')
    expect(formatRegNumber('EN108953')).toBe('EN108953')
    expect(formatRegNumber('en108953')).toBe('EN108953')
  })

  it('shows a dash for a missing number', () => {
    expect(formatRegNumber(null)).toBe('—')
    expect(formatRegNumber('')).toBe('—')
  })
})

describe('formatDateTime', () => {
  it('shows a dash for a missing time', () => {
    expect(formatDateTime(null)).toBe('—')
  })

  it('writes the day before the month', () => {
    expect(formatDateTime('2026-09-21T08:20:00Z')).toMatch(/^21 Sept? 2026/)
  })
})

describe('chart takeaways', () => {
  it('describes a rise, a fall and a steady SGPA', () => {
    const rise = [{ semester: 'Sem 1', gpa: 3.2 }, { semester: 'Sem 2', gpa: 3.5 }]
    expect(gpaTrendTakeaway(rise)).toBe('Your SGPA rose from 3.20 to 3.50 in Sem 2. Your best so far is 3.50 (Sem 2).')
    const fall = [{ semester: 'Sem 5', gpa: 3.81 }, { semester: 'Sem 6', gpa: 3.57 }]
    expect(gpaTrendTakeaway(fall)).toBe('Your SGPA fell from 3.81 to 3.57 in Sem 6. Your best so far is 3.81 (Sem 5).')
    const steady = [{ semester: 'Sem 1', gpa: 3.5 }, { semester: 'Sem 2', gpa: 3.52 }]
    expect(gpaTrendTakeaway(steady)).toMatch(/^Your SGPA held steady at 3.52 in Sem 2\./)
  })

  it('handles no results and a first result', () => {
    expect(gpaTrendTakeaway([])).toBeUndefined()
    expect(gpaTrendTakeaway([{ semester: 'Sem 1', gpa: 3.4 }])).toBe('Your first SGPA is 3.40.')
  })

  it('names the most common grade', () => {
    expect(gradeSpreadTakeaway([{ grade: 'A', count: 18 }, { grade: 'B', count: 31 }])).toBe(
      'Your most common grade is B: 31 of 49 graded courses.',
    )
    expect(gradeSpreadTakeaway([])).toBeUndefined()
  })
})

describe('batch numbers', () => {
  it('counts batches from the 2015 intake', () => {
    expect(getBatchNumber(2021)).toBe(7)
    expect(describeBatch(2021)).toBe('Batch 7 (2021/2022)')
    expect(describeBatch(null)).toBe('—')
  })
})

describe('minor baskets', () => {
  const basket = (semester: number, mandatory: boolean, minCredits: number, courses = 2): MinorPlanBasket => ({
    id: `b${semester}${mandatory ? 'm' : 'e'}`,
    semester,
    position: 0,
    min_credits: minCredits,
    mandatory,
    courses: Array.from({ length: courses }, (_, i) => ({ course_id: `c${i}`, course_code: `CO${i}`, title: `Course ${i}`, credits: 3 })),
  })

  it('lists the semesters a plan covers, once each and in order', () => {
    const plan: MinorPlan = { minor: 'Data Management', required_credits: 20, baskets: [basket(8, false, 3), basket(7, true, 0), basket(7, false, 3)] }
    expect(planSemesters(plan)).toEqual([7, 8])
  })

  it('counts a passed or enrolled course', () => {
    expect(statusCounts('passed')).toBe(true)
    expect(statusCounts('enrolled')).toBe(true)
    expect(statusCounts('failed')).toBe(false)
    expect(statusCounts(undefined)).toBe(false)
  })

  it('meets a mandatory basket only when all its courses count', () => {
    expect(basketMet(basket(7, true, 0), 0, true)).toBe(true)
    expect(basketMet(basket(7, true, 0), 0, false)).toBe(false)
    expect(basketMet(basket(7, true, 0, 0), 0, true)).toBe(false)
  })

  it('meets an elective basket at its minimum credits', () => {
    expect(basketMet(basket(7, false, 3), 3, false)).toBe(true)
    expect(basketMet(basket(7, false, 3), 2, false)).toBe(false)
  })
})

describe('machine-learning checks', () => {
  it("reads the grade model's latest held-out semester, random forest first", () => {
    const model = {
      evaluation: {
        '5': { train_rows: 1, test_rows: 1, results: [{ model: 'Random forest', sgpa_mae: 0.4 }] },
        '6': { train_rows: 1, test_rows: 1, results: [{ model: 'Most common band', sgpa_mae: 0.39 }, { model: 'Random forest', sgpa_mae: 0.26 }] },
      },
    } as unknown as ForecastModel
    expect(modelCheck(model)).toMatchObject({ semester: 6, model: 'Random forest', sgpa_mae: 0.26 })
  })

  it('has no check before a model is trained', () => {
    expect(modelCheck({ evaluation: {} } as unknown as ForecastModel)).toBeNull()
  })

  it("reads the proxy model's result beside the rules it replaced", () => {
    const review = {
      model: {
        evaluation: {
          test: {
            lectures: 720,
            proxies: 386,
            results: [
              { model: 'Rules today (location)', recall: 0.41 },
              { model: 'Isolation Forest + 1 km rule', recall: 0.47 },
            ],
          },
        },
      },
    } as unknown as CheckinReview
    const check = reviewCheck(review)
    expect(check.model?.model).toBe('Isolation Forest + 1 km rule')
    expect(check.rules?.model).toBe('Rules today (location)')
    expect(check.lectures).toBe(720)
    expect(check.proxies).toBe(386)
  })
})
