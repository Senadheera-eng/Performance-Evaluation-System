import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, CheckCircle2, KeyRound } from "lucide-react";
import { Button } from "../components/ui/button";
import { PageHeader, SectionCard } from "../components/common";
import { AppearanceCard } from "../components/account/AppearanceCard";
import { ChangePasswordDialog } from "../components/account/ChangePasswordDialog";
import { useAuth } from "../context/AuthContext";

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
 * password, the theme, the main colour, and a plain account of what PES
 * notifies you about.
 */
export default function Settings() {
  const { student } = useAuth();
  const navigate = useNavigate();

  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);

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
                setPasswordDialogOpen(true);
              }}
            >
              <KeyRound className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Change password
            </Button>
          </div>
        </SectionCard>

        <AppearanceCard />

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

      <ChangePasswordDialog
        open={passwordDialogOpen}
        onOpenChange={setPasswordDialogOpen}
      />
    </div>
  );
}
