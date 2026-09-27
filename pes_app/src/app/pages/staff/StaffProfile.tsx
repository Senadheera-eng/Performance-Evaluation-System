import { useEffect, useRef, useState } from "react";
import { Camera, KeyRound, Loader2, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import {
  DepartmentBadge,
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
import { getStaffCapabilities } from "../../../lib/staffScope";

const TITLES = ["Prof.", "Dr.", "Eng.", "Mr.", "Mrs.", "Ms."];

interface LecturerRow {
  name: string;
  title: string | null;
  email: string;
  department: string;
  staff_no: string | null;
  avatar_url: string | null;
}

/**
 * A lecturer's own profile: their photo, the title and name they are shown
 * by, and their password.
 *
 * The photo is the one students see beside their mentor's messages, on the
 * mentor card, and in the staff lists, so it is changed here once. Email
 * (their sign-in), department (what they may see) and staff number stay the
 * department's to change, and say so.
 */
export default function StaffProfile() {
  const { user, staff, refreshProfile } = useAuth();
  const caps = getStaffCapabilities(staff);
  const fileInput = useRef<HTMLInputElement>(null);

  const [row, setRow] = useState<LecturerRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);

  const load = async () => {
    if (!user) return;
    setError(null);
    const { data, error: readError } = await supabase
      .from("lecturers")
      .select("name, title, email, department, staff_no, avatar_url")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (readError || !data) {
      setError("Your profile could not be loaded.");
      return;
    }
    setRow(data as LecturerRow);
    setTitle(data.title ?? "");
    setName(data.name);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const dirty = row !== null && (name.trim() !== row.name || (title || null) !== row.title);

  const saveDetails = async () => {
    setSaving(true);
    const { error: rpcError } = await supabase.rpc("update_my_lecturer_profile", {
      p_title: title || null,
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

  const displayName = row ? `${row.title ? `${row.title} ` : ""}${row.name}` : "";

  return (
    <div className="space-y-5">
      <PageHeader
        title="My Profile"
        description="Your photo and the name students and colleagues see, and your password."
      />

      {!row ? (
        <SkeletonRows count={4} height="h-16" />
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
          {/* Photo */}
          <SectionCard title="Photo" description="Shown wherever your name appears, including your mentees' chat.">
            <div className="flex flex-col items-center text-center">
              <PersonAvatar name={displayName} url={row.avatar_url} department={row.department} size="xl" />
              <p className="mt-3 text-base font-semibold text-foreground">{displayName}</p>
              <div className="mt-1.5 flex flex-wrap justify-center gap-1.5">
                <DepartmentBadge department={row.department} />
                {caps.isHod && <StatusBadge tone="brand">Head of Department</StatusBadge>}
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
            <SectionCard title="Your name" description="How you appear to students and colleagues.">
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (dirty) saveDetails();
                }}
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[10rem_1fr]">
                  <div>
                    <Label htmlFor="profile-title" className="mb-1.5 block">Title</Label>
                    <select
                      id="profile-title"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm text-foreground"
                    >
                      <option value="">No title</option>
                      {TITLES.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label htmlFor="profile-name" className="mb-1.5 block">Name</Label>
                    <Input
                      id="profile-name"
                      value={name}
                      maxLength={120}
                      onChange={(e) => setName(e.target.value)}
                      className="h-10"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  {dirty && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setTitle(row.title ?? "");
                        setName(row.name);
                      }}
                    >
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
              description="These come from your department's records. Ask the department office if any of them is wrong."
            >
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {[
                  ["University email", row.email],
                  ["Department", row.department],
                  ["Staff number", row.staff_no ?? "—"],
                ].map(([label, value]) => (
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
