import { describe, expect, it } from "vitest";
import { roleChangeBlocker, type StaffRolePreview } from "./accounts";
import { compareAccess, expectedAccess } from "./accountGuard";

const lecturer: StaffRolePreview = {
  name: "Dr. Test Lecturer",
  role: "lecturer",
  department: "Computer Engineering",
  is_self: false,
  deactivated: false,
  hod_department: null,
  active_mentees: 0,
  current_courses: 2,
  other_super_admins: 1,
};

describe("roleChangeBlocker", () => {
  it("lets a free lecturer become an admin", () => {
    expect(roleChangeBlocker(lecturer, "dept_admin")).toBeNull();
    expect(roleChangeBlocker(lecturer, "super_admin")).toBeNull();
  });

  it("asks for another head before a head of department leaves the lecturer role", () => {
    const hod = { ...lecturer, hod_department: "Computer Engineering" };
    expect(roleChangeBlocker(hod, "dept_admin")).toMatch(/Head of Computer Engineering/);
  });

  it("asks for the mentees to be moved first", () => {
    expect(roleChangeBlocker({ ...lecturer, active_mentees: 1 }, "dept_admin")).toMatch(/mentors 1 student\./);
    expect(roleChangeBlocker({ ...lecturer, active_mentees: 4 }, "super_admin")).toMatch(/mentors 4 students\./);
  });

  it("does not hold an admin back for duties only a lecturer has", () => {
    const admin = { ...lecturer, role: "dept_admin" as const, hod_department: null, active_mentees: 0 };
    expect(roleChangeBlocker(admin, "lecturer")).toBeNull();
  });

  it("never changes the caller's own role", () => {
    expect(roleChangeBlocker({ ...lecturer, is_self: true }, "dept_admin")).toMatch(/your own role/);
  });

  it("asks for a deactivated account to be reactivated first", () => {
    expect(roleChangeBlocker({ ...lecturer, deactivated: true }, "dept_admin")).toMatch(/Reactivate/);
  });

  it("keeps at least one Super Admin", () => {
    const lastSuper = { ...lecturer, role: "super_admin" as const, department: null, other_super_admins: 0 };
    expect(roleChangeBlocker(lastSuper, "dept_admin")).toMatch(/at least one Super Admin/);
    expect(roleChangeBlocker({ ...lastSuper, other_super_admins: 1 }, "dept_admin")).toBeNull();
  });
});

describe("expectedAccess", () => {
  it("reads an admin's role and department", () => {
    expect(expectedAccess({ role: "dept_admin", department: "Civil Engineering" })).toEqual({
      role: "dept_admin",
      department: "Civil Engineering",
    });
    expect(expectedAccess({ role: "super_admin", department: null })).toEqual({ role: "super_admin", department: null });
  });

  it("reads a lecturer the way get_my_role() does: no admin role, no department", () => {
    expect(expectedAccess({ role: "lecturer", department: "Mechanical Engineering" })).toEqual({ role: "", department: null });
  });

  it("reads a student's department", () => {
    expect(expectedAccess({ role: "student", department: null })).toEqual({ role: "student", department: null });
  });

  it("has nothing to compare before the profile loads", () => {
    expect(expectedAccess(null)).toBeNull();
  });
});

describe("compareAccess", () => {
  const deptAdmin = { role: "dept_admin", department: "Civil Engineering" };

  it("sees no change when the database agrees", () => {
    expect(compareAccess(deptAdmin, { ...deptAdmin })).toBe("none");
  });

  it("sees a new role", () => {
    expect(compareAccess(deptAdmin, { role: "", department: null })).toBe("role");
    expect(compareAccess({ role: "", department: null }, { role: "super_admin", department: null })).toBe("role");
  });

  it("sees a new department under the same role", () => {
    expect(compareAccess(deptAdmin, { role: "dept_admin", department: "Mechanical Engineering" })).toBe("department");
    expect(
      compareAccess({ role: "student", department: null }, { role: "student", department: "Computer Engineering" }),
    ).toBe("department");
  });

  it("assumes nothing changed when either side is unknown", () => {
    expect(compareAccess(null, deptAdmin)).toBe("none");
    expect(compareAccess(deptAdmin, null)).toBe("none");
  });
});
