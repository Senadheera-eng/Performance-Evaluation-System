import { useState } from "react";
import { KeyRound, LogOut, XCircle } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { supabase } from "../../../lib/supabase";
import { useAuth } from "../../context/AuthContext";

/**
 * A student brought in with a new intake signs in the first time with a
 * temporary password from a sheet the faculty handed out. Until they choose
 * their own, nothing else opens: the sheet has been on a desk, and everyone
 * in the batch has seen it.
 *
 * The flag is the account's own metadata, set when the account was made and
 * cleared by the same call that sets the new password.
 */
export function FirstSignInPassword() {
  const { user, signOut } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user?.user_metadata?.must_change_password) return null;

  const save = async () => {
    setError(null);
    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setSaving(true);
    const { error: e } = await supabase.auth.updateUser({
      password,
      data: { must_change_password: false },
    });
    setSaving(false);
    if (e) {
      setError(
        /different from the old/i.test(e.message)
          ? "Choose a password different from the temporary one."
          : e.message,
      );
    }
    // On success the session's user updates and this closes by itself.
  };

  return (
    <AlertDialog open>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" aria-hidden="true" />
            Choose your own password
          </AlertDialogTitle>
          <AlertDialogDescription>
            Welcome to PES. You signed in with a temporary password; choose one only you know before you
            continue. At least 8 characters.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <form
          id="first-password"
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div>
            <Label htmlFor="first-new-password">New password</Label>
            <Input
              id="first-new-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1"
              autoFocus
            />
          </div>
          <div>
            <Label htmlFor="first-confirm-password">Confirm new password</Label>
            <Input
              id="first-confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="mt-1"
            />
          </div>
          {error && (
            <p role="alert" className="flex items-center gap-1.5 text-sm text-danger-fg">
              <XCircle className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
              {error}
            </p>
          )}
        </form>
        <AlertDialogFooter>
          <Button variant="ghost" onClick={() => signOut()} disabled={saving}>
            <LogOut className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Sign out
          </Button>
          <Button type="submit" form="first-password" disabled={saving}>
            {saving ? "Saving…" : "Save and continue"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
