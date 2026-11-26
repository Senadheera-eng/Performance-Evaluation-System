import { useLocation, useNavigate } from "react-router-dom";
import { Bell, UserRound, type LucideIcon } from "lucide-react";
import { Button } from "../components/ui/button";
import { PageHeader, SectionCard } from "../components/common";
import { AppearanceCard } from "../components/account/AppearanceCard";

/**
 * Settings for lecturers, heads of department and admins.
 *
 * The same Appearance card as the student page: the theme and the main
 * colour, kept on this device. A member of staff's name, photo and password
 * already live on their profile page, so this page sends them there rather
 * than repeating the form. One page serves both portals: the URL says which
 * one it was opened in, and so where its two links go.
 */
export default function AccountSettings() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const portal = pathname.startsWith("/admin") ? "/admin" : "/staff";
  const profileHref = `${portal}/profile`;
  const notificationsHref = `${portal}/notifications`;

  const links: { icon: LucideIcon; title: string; text: string; action: string; href: string }[] = [
    {
      icon: UserRound,
      title: "Your name, photo and password",
      text: "Change how students and colleagues see you, or your password, on your profile.",
      action: "Open my profile",
      href: profileHref,
    },
    {
      icon: Bell,
      title: "Notifications",
      text: "PES tells you under the bell, at the top of every page, when something needs you.",
      action: "Open notifications",
      href: notificationsHref,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" description="How PES looks on this device, and your account." />

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <AppearanceCard />

        <SectionCard title="Account" description="Kept with your profile, so there is one place to change it.">
          <ul className="divide-y divide-border/70">
            {links.map(({ icon: Icon, title, text, action, href }) => (
              <li key={href} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                {/* On a phone the button goes under the words; wider, beside them. */}
                <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">{title}</p>
                    <p className="text-xs text-muted-foreground">{text}</p>
                  </div>
                  <Button variant="outline" size="sm" className="self-start sm:self-center" onClick={() => navigate(href)}>
                    {action}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>
    </div>
  );
}
