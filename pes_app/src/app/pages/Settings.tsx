import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, CheckCircle2, KeyRound, Monitor, Moon, Sun, XCircle } from "lucide-react";
import { Button } from "../components/ui/button";
import { Label } from "../components/ui/label";
import { Input } from "../components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../components/ui/dialog";
import { PageHeader, SectionCard } from "../components/common";
import { cn } from "../components/ui/utils";
import { useTheme } from "../context/ThemeContext";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../../lib/supabase";

const THEMES = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "auto", label: "Auto", icon: Monitor },
] as const;

/* What the bell reports, in the words a student would use. Each line is a
   notification the database actually raises for a student (the notify_*
   functions): nothing here is promised that is not sent. */
const NOTIFIED_ABOUT = [
  "A result is published for one of your courses",
  "A lecturer opens a register you can sign in to",
  "An enrolment window opens for your batch",
  "A feedback form opens for a course you took",
  "Your medical certificate is reviewed",
  "You are given a mentor, or your mentor writes to you",
];

/**
 * Settings: only what can actually be changed.
 *
 * This page used to carry five notification switches, a compact mode,
 * two-factor authentication, profile visibility, an online status, a
 * "Delete Account" button and a language section. None of them was stored
 * or read anywhere: a student could turn two-factor authentication "on" and
 * nothing happened. They are gone. What is left all works: the account's
 * password, the theme, and a plain account of what PES notifies you about.
 */
export default function Settings() {
  const { theme, setTheme } = useTheme();
  const { student } = useAuth();
  const navigate = useNavigate();

  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  const handleChangePassword = async () => {
    setFormError(null);
    setFormSuccess(null);
    if (newPassword.length < 6) {
      setFormError("Password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setFormError("Passwords do not match.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });
    setSaving(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    setFormSuccess("Password updated successfully.");
    setNewPassword("");
    setConfirmPassword("");
    setTimeout(() => {
      setPasswordDialogOpen(false);
      setFormSuccess(null);
    }, 1500);
  };

  const account: [string, string][] = [
    ["University email", student?.email ?? "—"],
    ["Index number", student?.index_number ?? "—"],
    ["Registration number", student?.reg_number ? `EN${student.reg_number}` : "—"],
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Settings"
        description="Your password, how PES looks, and what it tells you about."
      />

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <SectionCard
          title="Account"
          description="Your details come from the faculty's records. Ask your department office if any of them is wrong."
        >
          <dl className="space-y-3">
            {account.map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-0.5 break-words text-sm font-medium text-foreground">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 border-t border-border/70 pt-4">
            <Button
              variant="outline"
              onClick={() => {
                setFormError(null);
                setFormSuccess(null);
                setPasswordDialogOpen(true);
              }}
            >
              <KeyRound className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Change password
            </Button>
          </div>
        </SectionCard>

        <SectionCard
          title="Appearance"
          description="Auto follows your device's light or dark setting."
        >
          <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-3">
            {THEMES.map(({ value, label, icon: Icon }) => {
              const active = theme === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setTheme(value)}
                  className={cn(
                    "rounded-xl border-2 p-3 text-center transition-colors",
                    active
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50",
                  )}
                >
                  <Icon
                    className={cn(
                      "mx-auto mb-1.5 h-5 w-5",
                      active ? "text-primary" : "text-muted-foreground",
                    )}
                    aria-hidden="true"
                  />
                  <span className="block text-sm font-medium text-foreground">{label}</span>
                </button>
              );
            })}
          </div>
        </SectionCard>

        <SectionCard
          title="Notifications"
          description="PES tells you in the app, under the bell at the top of every page, when:"
          className="lg:col-span-2"
          actions={
            <Button variant="outline" size="sm" onClick={() => navigate("/app/notifications")}>
              <Bell className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Open notifications
            </Button>
          }
        >
          <ul className="grid gap-2 sm:grid-cols-2">
            {NOTIFIED_ABOUT.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-foreground">
                <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-success-fg" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>

      {/* Change Password Dialog */}
      <Dialog
        open={passwordDialogOpen}
        onOpenChange={(open) => {
          setPasswordDialogOpen(open);
          if (!open) {
            setNewPassword("");
            setConfirmPassword("");
            setFormError(null);
            setFormSuccess(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change password</DialogTitle>
            <DialogDescription>
              At least 6 characters. You stay signed in on this device.
            </DialogDescription>
          </DialogHeader>
          <form
            id="change-password"
            className="space-y-4 py-2"
            onSubmit={(e) => {
              e.preventDefault();
              handleChangePassword();
            }}
          >
            <div>
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="confirm-password">Confirm new password</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="mt-1"
              />
            </div>
            {formError && (
              <p role="alert" className="flex items-center gap-1.5 text-sm text-danger-fg">
                <XCircle className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                {formError}
              </p>
            )}
            {formSuccess && (
              <p role="status" className="flex items-center gap-1.5 text-sm text-success-fg">
                <CheckCircle2 className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                {formSuccess}
              </p>
            )}
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasswordDialogOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="change-password" disabled={saving}>
              {saving ? "Saving…" : "Save password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
