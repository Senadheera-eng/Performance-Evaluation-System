import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Camera, KeyRound, Loader2, Save, Shield, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import {
  cardReveal,
  DepartmentBadge,
  DepartmentDot,
  ErrorState,
  PageHeader,
  PersonAvatar,
  SectionCard,
  SkeletonRows,
} from "../../components/common";
import { ChangePasswordDialog } from "../../components/account/ChangePasswordDialog";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../../lib/supabase";
import { removeMyAvatar, uploadMyAvatar } from "../../../lib/avatars";
import { DEPARTMENTS, departmentByName } from "../../../lib/departments";
import { cn } from "../../components/ui/utils";

interface AdminRow {
  name: string;
  role: string;
  department: string | null;
  avatar_url: string | null;
}

/**
 * An admin's own profile — the Faculty Admin's or a department admin's: their
 * photo, the name they are shown by, and their password.
 *
 * Role and department decide what an admin may see and change, so they are
 * shown but not editable here; the sign-in email is the account itself.
 */
export default function AdminProfile() {
  const { user, refreshProfile } = useAuth();
  const fileInput = useRef<HTMLInputElement>(null);

  const [row, setRow] = useState<AdminRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const reduce = useReducedMotion();

  const load = async () => {
    if (!user) return;
    setError(null);
    const { data, error: readError } = await supabase
      .from("admins")
      .select("name, role, department, avatar_url")
      .eq("id", user.id)
      .maybeSingle();
    if (readError || !data) {
      setError("Your profile could not be loaded.");
      return;
    }
    setRow(data as AdminRow);
    setName(data.name);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const dirty = row !== null && name.trim() !== row.name;

  const saveDetails = async () => {
    setSaving(true);
    const { error: rpcError } = await supabase.rpc("update_my_admin_profile", {
      p_name: name,
    });
    setSaving(false);
    if (rpcError) {
      toast.error(rpcError.message);
      return;
    }
    toast.success("Profile updated");
    await Promise.all([load(), refreshProfile()]);
  };

  const pickPhoto = async (file: File | undefined) => {
    if (!file || !user) return;
    setPhotoBusy(true);
    const result = await uploadMyAvatar(user.id, file);
    setPhotoBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Profile photo updated");
    await Promise.all([load(), refreshProfile()]);
  };

  const removePhoto = async () => {
    if (!user) return;
    setPhotoBusy(true);
    const result = await removeMyAvatar(user.id);
    setPhotoBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Profile photo removed");
    await Promise.all([load(), refreshProfile()]);
  };

  if (error) {
    return (
      <div className="space-y-5">
        <PageHeader title="My Profile" />
        <ErrorState message={error} onRetry={load} />
      </div>
    );
  }

  const isSuper = row?.role === "super_admin";
  const dept = departmentByName(row?.department);
  const roleLabel = isSuper ? "Super Admin" : "Department Admin";

  return (
    <div className="space-y-5">
      <PageHeader
        title="My Profile"
        description="Your photo and the name others see, and your password."
      />

      {!row ? (
        <SkeletonRows count={4} height="h-16" />
      ) : (
        <>
          {/* Who you are, as the student profile opens: a brand band, the
              photo across its edge, the name and badges under it, then the
              account the faculty keeps for you. */}
          <motion.section
            variants={cardReveal}
            initial={reduce ? false : "hidden"}
            animate="show"
            className="overflow-hidden rounded-card border border-border bg-card shadow-elevation-sm"
          >
            <div className="surface-band h-20 sm:h-24" aria-hidden="true" />
            <div className="px-4 pb-5 sm:px-6">
              <div className="-mt-12 flex flex-col items-start gap-3">
                {/* The photo itself opens the file picker too, with the
                    buttons below as the labelled way to do it. */}
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  disabled={photoBusy}
                  aria-label={row.avatar_url ? "Change photo" : "Add a photo"}
                  className="group relative flex-shrink-0 rounded-full bg-card ring-4 ring-card focus-visible:outline-none focus-visible:ring-primary"
                >
                  <PersonAvatar name={row.name} url={row.avatar_url} department={row.department} size="xl" />
                  <span className="absolute bottom-0 right-0 flex h-7 w-7 items-center justify-center rounded-full border-2 border-card bg-primary text-primary-foreground shadow-elevation-sm transition-transform group-hover:scale-110">
                    {photoBusy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Camera className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                  </span>
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    pickPhoto(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />

                <div className="flex w-full flex-wrap items-end justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-xl font-bold leading-tight text-foreground">{row.name}</h2>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {dept ? (
                        <DepartmentBadge department={row.department} />
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-foreground">
                          <AllDepartmentDots />
                          All departments
                        </span>
                      )}
                      {/* The role in the department's own colour, as a head's
                          headship is; the faculty's admin keeps the brand. */}
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
                          dept?.chipClass ?? "bg-primary/10 text-primary",
                        )}
                      >
                        <Shield className="h-3 w-3" aria-hidden="true" />
                        {roleLabel}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col items-start gap-1 sm:items-end">
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => fileInput.current?.click()} disabled={photoBusy}>
                        <Camera className="mr-1.5 h-4 w-4" aria-hidden="true" />
                        {row.avatar_url ? "Change photo" : "Add a photo"}
                      </Button>
                      {row.avatar_url && (
                        <Button size="sm" variant="ghost" onClick={removePhoto} disabled={photoBusy}>
                          <Trash2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
                          Remove
                        </Button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">JPG, PNG or WebP, up to 2 MB.</p>
                  </div>
                </div>
              </div>

              <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-3 border-t border-border/70 pt-4 sm:grid-cols-3">
                {(
                  [
                    ["Sign-in email", user?.email ?? "—"],
                    ["Role", roleLabel],
                    [
                      "Department",
                      dept ? (
                        <span className="inline-flex items-center gap-1.5">
                          <DepartmentDot dept={dept} />
                          <span className={dept.textClass}>{row.department}</span>
                        </span>
                      ) : (
                        <span className="inline-flex flex-wrap items-center gap-1.5">
                          <AllDepartmentDots />
                          All departments (whole faculty)
                        </span>
                      ),
                    ],
                  ] as [string, React.ReactNode][]
                ).map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="mt-0.5 break-words text-sm font-medium text-foreground">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-xs text-muted-foreground">
                Your role and department set what you can see and change, so they are kept by the faculty.
              </p>
            </div>
          </motion.section>

          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
            {/* Editable details */}
            <SectionCard
              title="Your name"
              description={
                isSuper
                  ? "How you appear across the portal."
                  : "How you appear across the portal, e.g. the office's name or your own."
              }
            >
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (dirty) saveDetails();
                }}
              >
                <div>
                  <Label htmlFor="admin-profile-name" className="mb-1.5 block">Name</Label>
                  <Input
                    id="admin-profile-name"
                    value={name}
                    maxLength={120}
                    onChange={(e) => setName(e.target.value)}
                    className="h-10"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  {dirty && (
                    <Button type="button" variant="outline" onClick={() => setName(row.name)}>
                      Discard
                    </Button>
                  )}
                  <Button type="submit" disabled={!dirty || saving || name.trim().length < 3}>
                    <Save className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    {saving ? "Saving…" : "Save changes"}
                  </Button>
                </div>
              </form>
            </SectionCard>

            {/* The account's one editable secret. */}
            <SectionCard
              title="Password"
              description="The password you sign in with, alongside your faculty email."
            >
              <Button variant="outline" onClick={() => setPasswordOpen(true)}>
                <KeyRound className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Change password
              </Button>
            </SectionCard>
          </div>
        </>
      )}

      <ChangePasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
    </div>
  );
}

/** Every department's dot, side by side: the whole faculty at a glance. */
function AllDepartmentDots() {
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden="true">
      {Object.values(DEPARTMENTS).map((d) => (
        <DepartmentDot key={d.key} dept={d} />
      ))}
    </span>
  );
}
