import { describe, expect, it } from "vitest";
import { describeChange, mustRetake, parseMark, resitCapApplies, semesterGpa } from "./resultChanges";

describe("mustRetake", () => {
  it("is true for R, F and L", () => {
    expect(["R", "F", "L", "r"].map(mustRetake)).toEqual([true, true, true, true]);
  });
  it("is false for a pass or no grade", () => {
    expect([null, undefined, "", "C", "A+"].map(mustRetake)).toEqual([false, false, false, false, false]);
  });
});

describe("resitCapApplies", () => {
  it("applies to an R or F, now or before", () => {
    expect(resitCapApplies("R", null)).toBe(true);
    expect(resitCapApplies("F", null)).toBe(true);
    expect(resitCapApplies("C", "R")).toBe(true);
  });
  it("does not apply to an L, which has no cap", () => {
    expect(resitCapApplies("L", null)).toBe(false);
    expect(resitCapApplies("B", "L")).toBe(false);
  });
  it("does not apply to an ordinary pass", () => {
    expect(resitCapApplies("B+", null)).toBe(false);
  });
});

describe("parseMark", () => {
  it("reads an empty box as not recorded", () => {
    expect(parseMark("  ", "ca")).toEqual({ value: null });
  });
  it("accepts a mark within its limit", () => {
    expect(parseMark("37.5", "midSem")).toEqual({ value: 37.5 });
    expect(parseMark("0", "ca")).toEqual({ value: 0 });
    expect(parseMark("50", "ca")).toEqual({ value: 50 });
  });
  it("refuses a mark over the limit, negative or not a number", () => {
    expect(parseMark("51", "ca").error).toBe("0–50");
    expect(parseMark("-1", "midSem").error).toBe("0–50");
    expect(parseMark("abc", "midSem").error).toBe("Not a number");
  });
});

describe("describeChange", () => {
  it("names only what changed", () => {
    expect(describeChange({ old_mid_sem: 30, new_mid_sem: 30, old_ca: 20, new_ca: 25, old_grade: "B", new_grade: "B+" })).toBe(
      "CA 20 → 25, grade B → B+",
    );
  });
  it("shows a mark added where there was none", () => {
    expect(describeChange({ old_mid_sem: null, new_mid_sem: 40, old_ca: 1, new_ca: 1, old_grade: "C", new_grade: "C" })).toBe(
      "Mid — → 40",
    );
  });
  it("says so when only the in-error flag was recorded", () => {
    expect(describeChange({ old_mid_sem: 1, new_mid_sem: 1, old_ca: 1, new_ca: 1, old_grade: "C", new_grade: "C" })).toBe(
      "Marked as recorded in error",
    );
  });
});

describe("semesterGpa", () => {
  const row = (gpv: number | null, credits: number, extra: Partial<{ contributesToGpa: boolean; published: boolean }> = {}) => ({
    gpv,
    credits,
    contributesToGpa: true,
    published: true,
    ...extra,
  });

  it("weights grade points by credits", () => {
    // (4 * 3 + 3 * 2) / 5 = 3.6
    expect(semesterGpa([row(4, 3), row(3, 2)])).toBeCloseTo(3.6);
  });
  it("leaves out unpublished, non-GPA and superseded results", () => {
    expect(semesterGpa([row(4, 3), row(0, 3, { published: false }), row(2, 2, { contributesToGpa: false }), row(null, 3)])).toBe(4);
  });
  it("has no GPA without a counted result", () => {
    expect(semesterGpa([])).toBeNull();
    expect(semesterGpa([row(null, 3)])).toBeNull();
  });
});
