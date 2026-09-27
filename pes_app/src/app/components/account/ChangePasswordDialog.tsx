import { useEffect, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { Input } from "../ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../ui/dialog";
import { supabase } from "../../../lib/supabase";

/**
 * Change the signed-in person's password. Shared by the student Settings
 * page and the lecturer profile, so both follow the same rules.
 */
export function ChangePasswordDialog({
  open: passwordDialogOpen,
  onOpenChange: setPasswordDialogOpen,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  // Each opening starts clean, however the last one was closed.
  useEffect(() => {
    if (!passwordDialogOpen) return;
    setNewPassword("");
    setConfirmPassword("");
    setFormError(null);
    setFormSuccess(null);
  }, [passwordDialogOpen]);

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

  return (
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
  );
}
