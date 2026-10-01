import { useCallback, useEffect, useState } from "react";
import { Layers, Shield, Split, Trash2, UserPlus, Users } from "lucide-react";
import { Button } from "../../components/ui/button";
import {
  DepartmentDot,
  EmptyState,
  ErrorState,
  PageHeader,
  SectionCard,
  SkeletonRows,
  StatusBadge,
} from "../../components/common";
import { IntakeDialog } from "../../components/batches/IntakeDialog";
import { RemoveBatchDialog } from "../../components/batches/RemoveBatchDialog";
import { DepartmentsDialog } from "../../components/batches/DepartmentsDialog";
import { supabase } from "../../../lib/supabase";
import { describeBatch } from "../../../lib/batch";
import { departmentByName } from "../../../lib/departments";
import { describeStage, type BatchSummary } from "../../../lib/batches";
import { useAuth } from "../../context/AuthContext";

/**
 * The batches in PES, and the two ends of a batch's time here.
 *
 * A new intake comes in from the faculty's list: every student gets a sign-in
 * account and a temporary password, and starts in Semester 1. A first-year is
 * not in a department yet, so the division into departments is recorded here
 * too when the faculty makes it. And a batch that has left can be removed,
 * with everything PES holds about its students.
 *
 * This is faculty-level work, so only the Super Admin sees it.
 */
export default function AdminBatches() {
  const { student } = useAuth();
  const isSuperAdmin = student?.role === "super_admin";

  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [removing, setRemoving] = useState<number | null>(null);
  const [dividing, setDividing] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: rpcError } = await supabase.rpc("get_batches");
    if (rpcError) setError(rpcError.message);
    else setBatches((data ?? []) as BatchSummary[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (isSuperAdmin) load();
    else setLoading(false);
  }, [isSuperAdmin, load]);

  if (!isSuperAdmin) {
    return (
      <div className="space-y-5">
        <PageHeader title="Batches" />
        <EmptyState
          icon={Shield}
          title="Only the Super Admin manages batches"
          description="Bringing an intake into PES and removing a batch that has left are done at the faculty level."
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Batches"
        description="Bring a new intake into PES, divide a batch into departments, and remove a batch that has left."
        actions={
          <Button onClick={() => setIntakeOpen(true)}>
            <UserPlus className="mr-1.5 h-4 w-4" aria-hidden="true" />
            New intake
          </Button>
        }
      />

      {error && <ErrorState message={error} onRetry={load} size="inline" />}

      {loading ? (
        <SkeletonRows count={3} height="h-28" />
      ) : batches.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No batches yet"
          description="Bring the first intake in from the faculty's list of students."
          action={
            <Button onClick={() => setIntakeOpen(true)}>
              <UserPlus className="mr-1.5 h-4 w-4" aria-hidden="true" />
              New intake
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {batches.map((b) => {
            const undivided = b.departments.find((d) => d.department === null)?.students ?? 0;
            return (
              <SectionCard
                key={b.batch_year}
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    {describeBatch(b.batch_year)}
                    <StatusBadge tone={b.semester > 8 ? "neutral" : "brand"}>{describeStage(b.semester)}</StatusBadge>
                  </span>
                }
                description={
                  <>
                    {b.students} student{b.students === 1 ? "" : "s"}
                    {b.active !== b.students ? ` · ${b.active} active` : ""}
                  </>
                }
              >
                <div className="space-y-4">
                  <ul className="flex flex-wrap gap-2" aria-label="Students by department">
                    {b.departments.map((d) => {
                      const dept = d.department ? departmentByName(d.department) : null;
                      return (
                        <li
                          key={d.department ?? "none"}
                          className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs"
                          title={d.department ?? "No department yet"}
                        >
                          {dept ? (
                            <DepartmentDot dept={dept} className="h-2.5 w-2.5" />
                          ) : (
                            <Users className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
                          )}
                          <span className="text-foreground">{dept?.code ?? d.department ?? "No department yet"}</span>
                          <span className="tabular-nums text-muted-foreground">{d.students}</span>
                        </li>
                      );
                    })}
                  </ul>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Button
                      size="sm"
                      variant={undivided > 0 ? "default" : "outline"}
                      onClick={() => setDividing(b.batch_year)}
                    >
                      <Split className="mr-1.5 h-4 w-4" aria-hidden="true" />
                      {undivided > 0 ? "Assign departments" : "Change departments"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-danger-fg hover:bg-danger-bg hover:text-danger-fg"
                      onClick={() => setRemoving(b.batch_year)}
                    >
                      <Trash2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
                      Remove batch
                    </Button>
                  </div>
                </div>
              </SectionCard>
            );
          })}
        </div>
      )}

      <IntakeDialog open={intakeOpen} onOpenChange={setIntakeOpen} batches={batches} onAdded={load} />
      <RemoveBatchDialog
        batchYear={removing}
        onOpenChange={(open) => !open && setRemoving(null)}
        onRemoved={load}
      />
      {dividing !== null && (
        <DepartmentsDialog
          batchYear={dividing}
          onOpenChange={(open) => !open && setDividing(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}
