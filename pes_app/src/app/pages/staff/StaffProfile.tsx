import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Award, Camera, KeyRound, Loader2, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
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
import { getStaffCapabilities } from "../../../lib/staffScope";
import { departmentByName } from "../../../lib/departments";
import { cn } from "../../components/ui/utils";

const TITLES = ["Prof.", "Dr.", "Eng.", "Mr.", "Mrs.", "Ms."];

/* The shared select cannot hold an empty value, so "no title" has a
   stand-in that never reaches the profile. */
const NO_TITLE = "__none__";

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
  const reduce = useReducedMotion();

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
  const dept = departmentByName(row?.department);

  return (
    <div className="space-y-5">
      <PageHeader
        title="My Profile"
        description="Your photo and the name students and colleagues see, and your password."
      />

      {!row ? (
        <SkeletonRows count={4} height="h-16" />
      ) : (
        <>
          {/* Who you are, as the student and admin profiles open: a brand
              band, the photo across its edge, the name and badges under it,
              then what the department keeps on record. */}
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
                    buttons beside the name as the labelled way to do it. */}
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  disabled={photoBusy}
                  aria-label={row.avatar_url ? "Change photo" : "Add a photo"}
                  className="group relative flex-shrink-0 rounded-full bg-card ring-4 ring-card focus-visible:outline-none focus-visible:ring-primary"
                >
                  <PersonAvatar name={displayName} url={row.avatar_url} department={row.department} size="xl" />
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
                    <h2 className="text-xl font-bold leading-tight text-foreground">{displayName}</h2>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <DepartmentBadge department={row.department} />
                      {caps.isHod && (
                        /* The headship in the department's own colour, as on
                           the Heads of Department page. */
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
                            dept?.chipClass ?? "bg-primary/10 text-primary",
                          )}
                        >
                          <Award className="h-3 w-3" aria-hidden="true" />
                          Head of Department
                        </span>
                      )}
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
                    <p className="text-xs text-muted-foreground">
                      JPG, PNG or WebP, up to 2 MB · shown wherever your name appears, including your mentees' chat.
                    </p>
                  </div>
                </div>
              </div>

              <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-3 border-t border-border/70 pt-4 sm:grid-cols-3">
                {([
                  ["University email", row.email],
                  [
                    "Department",
                    <span className="inline-flex items-center gap-1.5">
                      {dept && <DepartmentDot dept={dept} />}
                      <span className={dept?.textClass}>{row.department}</span>
                    </span>,
                  ],
                  ["Staff number", row.staff_no ?? "—"],
                ] as [string, React.ReactNode][]).map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="mt-0.5 break-words text-sm font-medium text-foreground">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-xs text-muted-foreground">
                These come from your department's records. Ask the department office if any of them is wrong.
              </p>
            </div>
          </motion.section>

          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
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
                    <Select
                      value={title === "" ? NO_TITLE : title}
                      onValueChange={(v) => setTitle(v === NO_TITLE ? "" : v)}
                    >
                      <SelectTrigger id="profile-title" className="h-10 w-full rounded-control border-border bg-card">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_TITLE}>No title</SelectItem>
                        {TITLES.map((t) => (
                          <SelectItem key={t} value={t}>{t}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
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

            {/* The account's one editable secret. */}
            <SectionCard
              title="Password"
              description="The password you sign in with, alongside your university email."
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
