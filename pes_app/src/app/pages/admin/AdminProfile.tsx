import { useEffect, useRef, useState } from "react";
import { Camera, KeyRound, Loader2, Save, Shield, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import {
  DepartmentBadge,
  DepartmentDot,
  ErrorState,
  PageHeader,
  PersonAvatar,
  SectionCard,
  SkeletonRows,
  StatusBadge,
} from "../../components/common";
import { ChangePasswordDialog } from "../../components/account/ChangePasswordDialog";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../../lib/supabase";
import { removeMyAvatar, uploadMyAvatar } from "../../../lib/avatars";
import { departmentByName } from "../../../lib/departments";
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
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
          {/* Photo */}
          <SectionCard
            title="Photo"
            description="Shown beside your name in the portal."
            className={cn("border-l-4", dept?.stripeClass ?? "border-l-primary")}
          >
            <div className="flex flex-col items-center text-center">
              <PersonAvatar name={row.name} url={row.avatar_url} department={row.department} size="xl" />
              <p className="mt-3 text-base font-semibold text-foreground">{row.name}</p>
              <div className="mt-1.5 flex flex-wrap justify-center gap-1.5">
                {dept ? (
                  <DepartmentBadge department={row.department} />
                ) : (
                  <StatusBadge tone="neutral">All departments</StatusBadge>
                )}
                <StatusBadge tone="brand" icon={Shield}>
                  {roleLabel}
                </StatusBadge>
              </div>
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
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Button size="sm" onClick={() => fileInput.current?.click()} disabled={photoBusy}>
                  {photoBusy ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Camera className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  )}
                  {row.avatar_url ? "Change photo" : "Add a photo"}
                </Button>
                {row.avatar_url && (
                  <Button size="sm" variant="outline" onClick={removePhoto} disabled={photoBusy}>
                    <Trash2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    Remove
                  </Button>
                )}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">JPG, PNG or WebP, up to 2 MB.</p>
            </div>
          </SectionCard>

          <div className="space-y-4 lg:col-span-2">
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

            {/* Fixed details */}
            <SectionCard
              title="Account"
              description="Your role and department set what you can see and change, so they are kept by the faculty."
            >
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
                        "All departments (whole faculty)"
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
              <div className="mt-4 border-t border-border/70 pt-4">
                <Button variant="outline" onClick={() => setPasswordOpen(true)}>
                  <KeyRound className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  Change password
                </Button>
              </div>
            </SectionCard>
          </div>
        </div>
      )}

      <ChangePasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
    </div>
  );
}
