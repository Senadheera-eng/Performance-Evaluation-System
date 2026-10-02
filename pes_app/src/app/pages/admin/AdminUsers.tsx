import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Ban,
  MailWarning,
  MoreHorizontal,
  RotateCcw,
  Search,
  Send,
  Shield,
  UserCheck,
  UserPlus,
  Users,
  XCircle,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Textarea } from "../../components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../components/ui/alert-dialog";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  SectionCard,
  SegmentedTabs,
  SkeletonRows,
  StatusBadge,
  type StatusTone,
} from "../../components/common";
import { AddUserDialog } from "../../components/users/AddUserDialog";
import { supabase } from "../../../lib/supabase";
import { describeBatch } from "../../../lib/batch";
import { departmentByName } from "../../../lib/departments";
import {
  accountCall,
  KIND_LABEL,
  type AccountState,
  type InviteResult,
  type ManagedUser,
  type UserKind,
} from "../../../lib/accounts";
import { useAuth } from "../../context/AuthContext";

const STATE: Record<AccountState, { label: string; tone: StatusTone }> = {
  active: { label: "Active", tone: "success" },
  invited: { label: "Invited", tone: "info" },
  invite_expired: { label: "Invitation expired", tone: "warning" },
  deactivated: { label: "Deactivated", tone: "danger" },
  no_account: { label: "No account", tone: "neutral" },
};

type Pending =
  | { action: "deactivate"; user: ManagedUser }
  | { action: "reactivate"; user: ManagedUser }
  | { action: "cancel_invite"; user: ManagedUser };

const PAGE = 60;

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null;

/**
 * Everyone who can sign in to PES, and adding and removing them.
 *
 * People are added by invitation: they choose their own password from an
 * emailed link. They are removed by deactivation: access ends at once, and
 * nothing they did -- results, attendance, feedback, enrolments -- is
 * deleted. A deactivated account can be reactivated.
 */
export default function AdminUsers() {
  const { student: me } = useAuth();
  const isSuperAdmin = me?.role === "super_admin";

  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [emailReady, setEmailReady] = useState<boolean | null>(null);
  const [kind, setKind] = useState<"all" | UserKind>("all");
  const [state, setState] = useState<"all" | AccountState>("all");
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: e } = await supabase.rpc("admin_list_users");
    if (e) setError(e.message);
    else setUsers((data ?? []) as ManagedUser[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!isSuperAdmin) return setLoading(false);
    load();
    accountCall<{ configured: boolean }>({ action: "email_status" }).then(({ data }) =>
      setEmailReady(data?.configured ?? null),
    );
  }, [isSuperAdmin, load]);

  useEffect(() => setShown(PAGE), [kind, state, query]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: users.length };
    for (const u of users) c[u.kind] = (c[u.kind] ?? 0) + 1;
    return c;
  }, [users]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((u) => {
      if (kind !== "all" && u.kind !== kind) return false;
      if (state !== "all" && (state === "invited" ? !["invited", "invite_expired"].includes(u.state) : u.state !== state)) {
        return false;
      }
      if (!q) return true;
      return [u.name, u.email, u.detail.reg_number, u.detail.index_number, u.detail.staff_no, u.department]
        .some((v) => v && String(v).toLowerCase().includes(q));
    });
  }, [users, kind, state, query]);

  const run = async (body: Record<string, unknown>, done: string) => {
    setBusy(true);
    const { data, error: e } = await accountCall<InviteResult | { ok: true }>(body);
    setBusy(false);
    if (e) {
      toast.error(e);
      return false;
    }
    const invite = data as InviteResult;
    if (invite && "emailed" in invite && !invite.emailed && invite.invite_link) {
      await navigator.clipboard.writeText(invite.invite_link).catch(() => undefined);
      toast.warning("The email could not be sent, so the invitation link was copied. Send it to the person yourself.", {
        duration: 10_000,
      });
    } else {
      toast.success(done);
    }
    await load();
    return true;
  };

  const confirmPending = async () => {
    if (!pending) return;
    const { action, user } = pending;
    const ok = await run(
      { action, user_id: user.user_id, ...(action === "deactivate" ? { reason } : {}) },
      action === "deactivate"
        ? `${user.name} has been deactivated and signed out.`
        : action === "reactivate"
          ? `${user.name} can sign in again.`
          : `The invitation to ${user.name} was cancelled.`,
    );
    if (ok) {
      setPending(null);
      setReason("");
    }
  };

  if (!isSuperAdmin) {
    return (
      <div className="space-y-5">
        <PageHeader title="Users" />
        <EmptyState icon={Shield} title="Only the Super Admin manages users" />
      </div>
    );
  }

  const describe = (u: ManagedUser) => {
    if (u.kind === "student") {
      return [u.detail.index_number, u.detail.reg_number, u.detail.batch_year ? describeBatch(u.detail.batch_year) : null]
        .filter(Boolean)
        .join(" · ");
    }
    return [KIND_LABEL[u.kind], u.detail.staff_no].filter(Boolean).join(" · ");
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Users"
        description="Add students, lecturers and department admins by email invitation, and deactivate anyone who should no longer sign in. Deactivating keeps all of their records."
        actions={
          <Button onClick={() => setAdding(true)}>
            <UserPlus className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Add user
          </Button>
        }
      />

      {emailReady === false && (
        <div className="flex items-start gap-3 rounded-xl border border-warning-border bg-warning-bg px-4 py-3 text-sm text-warning-fg">
          <MailWarning className="mt-0.5 h-5 w-5 flex-shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">Invitation and password-reset emails are not set up yet</p>
            <p className="text-xs">
              Until the <code>RESEND_API_KEY</code> secret is set in Supabase, PES shows each invitation link here for you to
              send yourself, and "Forgot password" cannot deliver its email.
            </p>
          </div>
        </div>
      )}

      {error && <ErrorState message={error} onRetry={load} size="inline" />}

      <SectionCard flush>
        <div className="space-y-3 border-b border-border p-4">
          <SegmentedTabs
            aria-label="Kind of user"
            layoutId="users-kind"
            value={kind}
            onChange={(v) => setKind(v as typeof kind)}
            tabs={[
              { value: "all", label: `All ${counts.all ?? 0}` },
              { value: "student", label: `Students ${counts.student ?? 0}` },
              { value: "lecturer", label: `Lecturers ${counts.lecturer ?? 0}` },
              { value: "dept_admin", label: `Dept. Admins ${counts.dept_admin ?? 0}` },
            ]}
          />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name, email, registration or index number"
                aria-label="Search users"
                className="pl-9"
              />
            </div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Account state">
              {(["all", "active", "invited", "deactivated"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={state === s}
                  onClick={() => setState(s)}
                  className={
                    state === s
                      ? "h-8 rounded-full border border-foreground/20 bg-foreground px-3 text-xs font-medium text-background"
                      : "h-8 rounded-full border border-border bg-card px-3 text-xs font-medium text-muted-foreground hover:bg-muted"
                  }
                >
                  {s === "all" ? "Any state" : STATE[s].label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="p-4">
            <SkeletonRows count={6} height="h-14" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={Users} title="No one matches" description="Try another search or filter." size="inline" />
        ) : (
          <ul className="divide-y divide-border">
            {filtered.slice(0, shown).map((u) => {
              const dept = u.department ? departmentByName(u.department) : null;
              const s = STATE[u.state];
              const key = u.user_id ?? `${u.kind}-${u.detail.lecturer_id ?? u.email}`;
              return (
                <li key={key} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium text-foreground">
                      <span className="truncate">{u.name}</span>
                      <StatusBadge tone={s.tone}>{s.label}</StatusBadge>
                      {u.kind !== "student" && <span className="text-xs text-muted-foreground">{KIND_LABEL[u.kind]}</span>}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {u.email}
                      {describe(u) && u.kind === "student" ? ` · ${describe(u)}` : ""}
                      {dept ? ` · ${dept.code}` : u.kind === "student" ? " · No department yet" : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {u.state === "deactivated"
                        ? `Deactivated ${when(u.deactivated_at) ?? ""}${u.deactivation_reason ? ` — ${u.deactivation_reason}` : ""}`
                        : u.state === "invited"
                          ? `Invited ${when(u.invited_at)} · link valid until ${when(u.invite_expires_at)}`
                          : u.state === "invite_expired"
                            ? "The invitation link has expired. Send a new one."
                            : u.last_sign_in_at
                              ? `Last signed in ${when(u.last_sign_in_at)}`
                              : u.state === "active"
                                ? "Has not signed in yet"
                                : ""}
                    </p>
                  </div>
                  {u.kind !== "super_admin" && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="sm" variant="ghost" aria-label={`Actions for ${u.name}`} disabled={busy}>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {u.state === "no_account" && (
                          <DropdownMenuItem
                            onSelect={() =>
                              run(
                                { action: "invite", kind: "lecturer", name: u.name, email: u.email, department: u.department },
                                `An invitation was sent to ${u.email}.`,
                              )
                            }
                          >
                            <Send className="mr-2 h-4 w-4" /> Invite to PES
                          </DropdownMenuItem>
                        )}
                        {(u.state === "invited" || u.state === "invite_expired") && (
                          <>
                            <DropdownMenuItem
                              onSelect={() => run({ action: "resend_invite", user_id: u.user_id }, `A new invitation was sent to ${u.email}.`)}
                            >
                              <Send className="mr-2 h-4 w-4" /> Send a new invitation
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setPending({ action: "cancel_invite", user: u })}>
                              <XCircle className="mr-2 h-4 w-4" /> Cancel invitation
                            </DropdownMenuItem>
                          </>
                        )}
                        {u.state === "active" && (
                          <DropdownMenuItem
                            className="text-danger-fg focus:text-danger-fg"
                            onSelect={() => setPending({ action: "deactivate", user: u })}
                          >
                            <Ban className="mr-2 h-4 w-4" /> Deactivate
                          </DropdownMenuItem>
                        )}
                        {u.state === "deactivated" && u.user_id && (
                          <DropdownMenuItem onSelect={() => setPending({ action: "reactivate", user: u })}>
                            <UserCheck className="mr-2 h-4 w-4" /> Reactivate
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {filtered.length > shown && (
          <div className="border-t border-border p-3 text-center">
            <Button variant="ghost" size="sm" onClick={() => setShown((n) => n + PAGE)}>
              Show more ({filtered.length - shown} left)
            </Button>
          </div>
        )}
      </SectionCard>

      <AddUserDialog open={adding} onOpenChange={setAdding} onAdded={load} />

      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && !busy && setPending(null)}>
        <AlertDialogContent>
          {pending && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {pending.action === "deactivate"
                    ? `Deactivate ${pending.user.name}?`
                    : pending.action === "reactivate"
                      ? `Reactivate ${pending.user.name}?`
                      : `Cancel the invitation to ${pending.user.name}?`}
                </AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-2 text-sm">
                    {pending.action === "deactivate" && (
                      <>
                        <p>
                          They are signed out at once and can no longer sign in or reset their password. Nothing is deleted: their
                          results, attendance, feedback and enrolment history stay as they are, and you can reactivate the account
                          later.
                        </p>
                        <div>
                          <Label htmlFor="deactivate-reason">Reason (optional, only you see it)</Label>
                          <Textarea
                            id="deactivate-reason"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            maxLength={300}
                            rows={2}
                            className="mt-1"
                            placeholder="e.g. Left the faculty"
                          />
                        </div>
                      </>
                    )}
                    {pending.action === "reactivate" && <p>They can sign in again with their existing password.</p>}
                    {pending.action === "cancel_invite" && (
                      <p>
                        Their invitation link stops working and the account is removed. They never signed in, so no records are
                        lost. {pending.user.kind === "lecturer" && "Their lecturer record stays."}
                      </p>
                    )}
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={busy}>Keep as is</AlertDialogCancel>
                <Button
                  variant={pending.action === "reactivate" ? "default" : "destructive"}
                  onClick={confirmPending}
                  disabled={busy}
                >
                  {pending.action === "deactivate" ? (
                    <Ban className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  ) : pending.action === "reactivate" ? (
                    <RotateCcw className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  ) : (
                    <XCircle className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  )}
                  {busy
                    ? "Working…"
                    : pending.action === "deactivate"
                      ? "Deactivate"
                      : pending.action === "reactivate"
                        ? "Reactivate"
                        : "Cancel invitation"}
                </Button>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
