import { useAvatarUrls } from "../../../lib/avatars";
import { useEffect, useMemo, useState } from "react";
import { Award, Mail, Users } from "lucide-react";
import {
  PersonAvatar,
  EmptyState,
  ErrorState,
  PageHeader,
  SectionCard,
  SkeletonRows,
  StatCard,
  StatusBadge,
} from "../../components/common";
import { Input } from "../../components/ui/input";
import { useAuth } from "../../context/AuthContext";
import { getStaffCapabilities } from "../../../lib/staffScope";
import {
  getAssignableLecturers,
  getDepartmentTeaching,
  type AssignableLecturer,
  type DepartmentOffering,
} from "../../../lib/staffService";
import { departmentRowClass } from "../../../lib/departments";

/**
 * Department academic staff and their current teaching load.
 *
 * Load is counted from live assignments rather than stored on the lecturer,
 * so it cannot go stale when an assignment is added or ended.
 */
export default function StaffLecturers() {
  const { staff } = useAuth();
  const caps = getStaffCapabilities(staff);

  const [lecturers, setLecturers] = useState<AssignableLecturer[]>([]);
  const avatars = useAvatarUrls(lecturers.map((l) => l.lecturer_id));
  const [offerings, setOfferings] = useState<DepartmentOffering[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (staff) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staff?.lecturerId]);

  const load = async () => {
    setLoading(true);
    setError(null);
    const [people, teaching] = await Promise.all([
      getAssignableLecturers(),
      getDepartmentTeaching(null, null),
    ]);
    if (!people.ok) {
      setError(people.error);
      setLoading(false);
      return;
    }
    setLecturers(people.data);
    if (teaching.ok) setOfferings(teaching.data);
    setLoading(false);
  };

  /** offering + credit load per lecturer, derived from live assignments. */
  const load_ = useMemo(() => {
    const map = new Map<string, { offerings: number; credits: number; coordinating: number }>();
    for (const o of offerings) {
      for (const l of o.lecturers) {
        const cur = map.get(l.lecturer_id) ?? { offerings: 0, credits: 0, coordinating: 0 };
        cur.offerings += 1;
        cur.credits += o.credits;
        if (l.assignment_role === "coordinator") cur.coordinating += 1;
        map.set(l.lecturer_id, cur);
      }
    }
    return map;
  }, [offerings]);

  const visible = lecturers.filter(
    (l) =>
      l.name.toLowerCase().includes(query.toLowerCase()) ||
      l.email.toLowerCase().includes(query.toLowerCase()),
  );

  const unassigned = lecturers.filter((l) => !load_.has(l.lecturer_id)).length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Department Staff"
        description={
          caps.hodDepartment
            ? `Academic staff in ${caps.hodDepartment} and their current teaching load.`
            : "Academic staff and their current teaching load."
        }
      />

      {error && <ErrorState message={error} onRetry={load} />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard index={0} label="Academic Staff" value={lecturers.length} icon={Users} tone="brand" />
        <StatCard
          index={1}
          label="Offerings Covered"
          value={offerings.filter((o) => o.lecturers.length > 0).length}
          icon={Award}
          tone="success"
        />
        <StatCard
          index={2}
          label="Offerings Uncovered"
          value={offerings.filter((o) => o.lecturers.length === 0).length}
          icon={Award}
          tone={offerings.some((o) => o.lecturers.length === 0) ? "warning" : "neutral"}
        />
        <StatCard
          index={3}
          label="Staff With No Course"
          value={unassigned}
          icon={Users}
          tone={unassigned > 0 ? "warning" : "neutral"}
        />
      </div>

      <Input
        placeholder="Search by name or email..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="h-9 bg-card"
      />

      <SectionCard title="Staff" description={`${visible.length} shown`} flush>
        {loading ? (
          <div className="p-4">
            <SkeletonRows count={6} height="h-14" />
          </div>
        ) : visible.length === 0 ? (
          <div className="p-4">
            <EmptyState icon={Users} title="No staff match that search" />
          </div>
        ) : (
          <ul className="divide-y divide-border/70">
            {visible.map((l) => {
              const stat = load_.get(l.lecturer_id);
              return (
                <li
                  key={l.lecturer_id}
                  className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 ${departmentRowClass(l.department)}`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                  <PersonAvatar name={l.name} url={avatars[l.lecturer_id]} department={l.department} size="md" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{l.name}</span>
                      {l.is_hod && <StatusBadge tone="brand">Head of Department</StatusBadge>}
                      {stat?.coordinating ? (
                        <StatusBadge tone="info">
                          Coordinator ×{stat.coordinating}
                        </StatusBadge>
                      ) : null}
                    </div>
                    <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Mail className="h-3 w-3" aria-hidden="true" />
                      {l.email}
                      {l.department !== caps.hodDepartment && ` · ${l.department}`}
                    </p>
                  </div>
                  </div>
                  <div className="text-right">
                    {stat ? (
                      <>
                        <p className="text-sm font-semibold text-foreground tabular-nums">
                          {stat.offerings} course{stat.offerings === 1 ? "" : "s"}
                        </p>
                        <p className="text-xs text-muted-foreground tabular-nums">
                          {stat.credits} credits
                        </p>
                      </>
                    ) : (
                      <StatusBadge tone="neutral">No assignments</StatusBadge>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
