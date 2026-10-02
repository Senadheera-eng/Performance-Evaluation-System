import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { CheckCircle2, Circle, Eye, EyeOff, KeyRound, Loader2, Lock, XCircle } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { supabase } from "../../lib/supabase";
import { accountCall, passwordIssues } from "../../lib/accounts";
import universityLogo from "../../assets/logo.jpg";

interface LinkInfo {
  valid: true;
  purpose: "invite" | "reset";
  email: string | null;
  first_name: string | null;
  expires_at: string;
}

/* The token is read once and taken out of the address bar, so it is not
   left in the browser's history, a bookmark or a screenshot. It came after
   "#", so it never reached the web server either. */
let taken: string | null = null;
function takeToken(): string | null {
  const match = window.location.hash.match(/token=([A-Za-z0-9_-]+)/);
  if (match) {
    taken = match[1];
    window.history.replaceState(null, "", window.location.pathname);
  }
  // Read twice in development (React's strict mode): the second read finds
  // the address bar already cleared, so it keeps the first one.
  return taken;
}

/**
 * Where an emailed link lands: /account/setup for an invitation, and
 * /account/reset for a forgotten password. Either way the person chooses a
 * password, and the link is spent.
 */
export default function AccountLinkPage() {
  const navigate = useNavigate();
  const mode: "setup" | "reset" = useLocation().pathname.endsWith("/reset") ? "reset" : "setup";
  const [token] = useState(takeToken);
  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneEmail, setDoneEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setLinkError("This page needs the link from your email. Open the link exactly as it arrived.");
      return;
    }
    accountCall<LinkInfo>({ action: "check_token", token }).then(({ data, error: e }) => {
      if (e || !data) setLinkError(e ?? "This link could not be checked.");
      else setInfo(data);
    });
  }, [token]);

  const issues = useMemo(() => passwordIssues(password, info?.email ?? null), [password, info?.email]);
  const rules = ["At least 8 characters", "Letters and numbers", "Not your email or registration number"];
  const matches = confirm.length > 0 && confirm === password;
  const invite = (info?.purpose ?? (mode === "setup" ? "invite" : "reset")) === "invite";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (issues.length) return setError(`Your password needs: ${issues.join(", ").toLowerCase()}.`);
    if (!matches) return setError("The two passwords do not match.");
    setSaving(true);
    const { data, error: e2 } = await accountCall<{ ok: true; email: string }>({ action: "redeem", token, password });
    setSaving(false);
    if (e2 || !data) return setError(e2 ?? "Your password could not be saved.");
    // Whoever was signed in on this browser is not necessarily this person.
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    setDoneEmail(data.email);
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#f7f8fa] p-4 text-[#111a3a]" style={{ colorScheme: "light" }}>
      <div className="w-full max-w-[460px] rounded-[20px] border border-[#e4e7ec] bg-white p-7 shadow-[0_16px_55px_rgba(15,23,42,0.08)] sm:p-9">
        <div className="mb-7 flex items-center gap-3">
          <img src={universityLogo} alt="University of Sri Jayewardenepura logo" className="h-12 w-12 rounded-full object-cover" />
          <div>
            <p className="text-[22px] font-extrabold tracking-[-0.02em]">PES</p>
            <p className="text-sm text-[#7a8198]">Performance Evaluation System</p>
          </div>
        </div>

        {doneEmail ? (
          <div className="space-y-5">
            <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-800">
              <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0" aria-hidden="true" />
              <div>
                <p className="font-semibold">{invite ? "Your account is ready." : "Your password has been changed."}</p>
                <p className="mt-0.5 text-sm">
                  Sign in with <strong>{doneEmail}</strong> and your new password.
                  {!invite && " You have been signed out on every other device."}
                </p>
              </div>
            </div>
            <Button
              className="h-12 w-full rounded-lg bg-[#d11238] text-base font-bold text-white hover:bg-[#ba0f32]"
              onClick={() => navigate(`/?email=${encodeURIComponent(doneEmail)}`)}
            >
              Go to sign in
            </Button>
          </div>
        ) : linkError ? (
          <div className="space-y-5">
            <div role="alert" className="flex items-start gap-3 rounded-xl border border-[#d11238]/20 bg-[#d11238]/[0.06] px-4 py-3 text-[#b40f30]">
              <XCircle className="mt-0.5 h-5 w-5 flex-shrink-0" aria-hidden="true" />
              <p className="text-sm">{linkError}</p>
            </div>
            <p className="text-sm text-[#5d6479]">
              {mode === "setup"
                ? "An invitation link works once and lasts 72 hours. Ask the faculty office to send you a new one."
                : "A reset link works once and lasts 60 minutes. You can ask for a new one from the sign-in page."}
            </p>
            <Link to="/?forgot=1" className="inline-block text-sm font-semibold text-[#d11238] hover:underline">
              {mode === "setup" ? "Back to sign in" : "Ask for a new reset link"}
            </Link>
          </div>
        ) : !info ? (
          <div className="flex items-center gap-2 py-8 text-[#5d6479]">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Checking your link…
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-5">
            <div>
              <h1 className="flex items-center gap-2 text-[26px] font-extrabold tracking-[-0.02em]">
                <KeyRound className="h-6 w-6 text-[#d11238]" aria-hidden="true" />
                {invite ? `Welcome${info.first_name ? `, ${info.first_name}` : ""}` : "Choose a new password"}
              </h1>
              <p className="mt-1.5 text-[15px] text-[#7a8198]">
                {invite ? "Set a password to finish your PES account." : "Your old password stops working once you save."}{" "}
                You sign in with <strong className="text-[#111a3a]">{info.email}</strong>.
              </p>
            </div>

            <div className="space-y-2">
              <label htmlFor="new-password" className="block text-[15px] font-semibold">New password</label>
              <div className="relative">
                <Lock aria-hidden="true" className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#9299ad]" />
                <Input
                  id="new-password"
                  type={show ? "text" : "password"}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-12 rounded-lg border-[#d7dbe4] bg-white pl-12 pr-12 text-base text-[#111a3a] dark:bg-white"
                  autoFocus
                  required
                />
                <button
                  type="button"
                  onClick={() => setShow((v) => !v)}
                  aria-label={show ? "Hide password" : "Show password"}
                  className="absolute right-4 top-1/2 -translate-y-1/2 rounded p-1 text-[#9299ad] hover:text-[#596079]"
                >
                  {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
              <ul className="space-y-1 pt-1 text-sm" aria-label="Password rules">
                {rules.map((rule) => {
                  const ok = password.length > 0 && !issues.includes(rule);
                  return (
                    <li key={rule} className={ok ? "flex items-center gap-1.5 text-emerald-700" : "flex items-center gap-1.5 text-[#7a8198]"}>
                      {ok ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <Circle className="h-4 w-4" aria-hidden="true" />}
                      {rule}
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="space-y-2">
              <label htmlFor="confirm-password" className="block text-[15px] font-semibold">Confirm password</label>
              <Input
                id="confirm-password"
                type={show ? "text" : "password"}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="h-12 rounded-lg border-[#d7dbe4] bg-white text-base text-[#111a3a] dark:bg-white"
                required
              />
              {confirm.length > 0 && !matches && <p className="text-sm text-[#b40f30]">The passwords do not match yet.</p>}
            </div>

            {error && (
              <div role="alert" className="rounded-lg border border-[#d11238]/20 bg-[#d11238]/[0.06] px-4 py-3 text-sm text-[#b40f30]">
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={saving}
              className="h-12 w-full rounded-lg bg-[#d11238] text-base font-bold text-white hover:bg-[#ba0f32]"
            >
              {saving ? "Saving…" : invite ? "Set password" : "Change password"}
            </Button>
            <p className="text-center text-xs text-[#7a8198]">
              This link works once and expires {new Date(info.expires_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}.
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
