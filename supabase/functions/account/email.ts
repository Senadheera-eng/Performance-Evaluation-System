// The emails PES sends about accounts, and sending them through Resend.
//
// RESEND_API_KEY must be set for anything to be sent; PES_EMAIL_FROM is the
// sender, e.g. "PES <no-reply@eng.sjp.ac.lk>" once that domain is verified
// in Resend. Until then Resend's test sender works, but only to the address
// the Resend account was opened with.

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const EMAIL_FROM = Deno.env.get("PES_EMAIL_FROM") ?? "PES <onboarding@resend.dev>";

export const emailConfigured = () => RESEND_API_KEY.length > 0;

export interface Sent {
  sent: boolean;
  error?: string;
}

export async function sendEmail(to: string, subject: string, html: string, text: string): Promise<Sent> {
  if (!emailConfigured()) return { sent: false, error: "Email is not set up (RESEND_API_KEY)." };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject, html, text }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) return { sent: true };
    const body = await res.text();
    console.error(`account: Resend ${res.status}: ${body.slice(0, 300)}`);
    return { sent: false, error: `The email service refused the message (${res.status}).` };
  } catch (e) {
    console.error("account: Resend unreachable", e);
    return { sent: false, error: "The email service could not be reached." };
  }
}

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function layout(heading: string, paragraphs: string[], button: { label: string; url: string }, footnote: string) {
  const body = paragraphs.map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#1f2937">${p}</p>`).join("");
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f5f7;font-family:Segoe UI,Arial,sans-serif">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
<table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb">
<tr><td style="padding:20px 28px;border-bottom:3px solid #8b1a1a">
<div style="font-size:18px;font-weight:700;color:#8b1a1a">PES</div>
<div style="font-size:12px;color:#6b7280">Performance Evaluation System · Faculty of Engineering, University of Sri Jayewardenepura</div>
</td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 16px;font-size:20px;color:#111827">${heading}</h1>
${body}
<p style="margin:22px 0"><a href="${escape(button.url)}" style="display:inline-block;background:#8b1a1a;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:8px">${button.label}</a></p>
<p style="margin:0 0 6px;font-size:12px;color:#6b7280">If the button does not work, copy this link into your browser:</p>
<p style="margin:0 0 18px;font-size:12px;word-break:break-all"><a href="${escape(button.url)}" style="color:#8b1a1a">${escape(button.url)}</a></p>
<p style="margin:0;font-size:12px;color:#6b7280">${footnote}</p>
</td></tr></table>
<p style="font-size:11px;color:#9ca3af;margin:14px 0 0">This is an automated message from PES. Please do not reply.</p>
</td></tr></table></body></html>`;
}

const ROLE_NAMES: Record<string, string> = {
  student: "a student",
  lecturer: "a lecturer",
  dept_admin: "a department admin",
};

export function inviteEmail(o: { name: string; email: string; kind: string; url: string; hours: number }) {
  const first = escape(o.name.split(" ")[0] || o.name);
  const role = ROLE_NAMES[o.kind] ?? "a user";
  const subject = "Your PES account is ready — set your password";
  const html = layout(
    `Welcome to PES, ${first}`,
    [
      `You have been added to PES, the Faculty of Engineering's Performance Evaluation System, as ${role}.`,
      `Choose your password to finish setting up your account. You will sign in with <strong>${escape(o.email)}</strong>.`,
    ],
    { label: "Set my password", url: o.url },
    `This link works once and expires in ${o.hours} hours. If you were not expecting this email, you can ignore it.`,
  );
  const text = [
    `Welcome to PES, ${o.name.split(" ")[0] || o.name}.`,
    "",
    `You have been added to PES, the Faculty of Engineering's Performance Evaluation System, as ${role}.`,
    `Set your password here (you will sign in with ${o.email}):`,
    o.url,
    "",
    `This link works once and expires in ${o.hours} hours. If you were not expecting this email, ignore it.`,
  ].join("\n");
  return { subject, html, text };
}

export function resetEmail(o: { name: string; url: string; minutes: number }) {
  const first = escape(o.name.split(" ")[0] || o.name);
  const subject = "Reset your PES password";
  const html = layout(
    "Reset your password",
    [
      `Hi ${first}, someone asked to reset the password for your PES account.`,
      "If it was you, choose a new password with the button below.",
    ],
    { label: "Choose a new password", url: o.url },
    `This link works once and expires in ${o.minutes} minutes. If you did not ask for this, ignore this email — your password stays as it is.`,
  );
  const text = [
    `Hi ${o.name.split(" ")[0] || o.name},`,
    "",
    "Someone asked to reset the password for your PES account. If it was you, choose a new password here:",
    o.url,
    "",
    `This link works once and expires in ${o.minutes} minutes. If you did not ask for this, ignore this email.`,
  ].join("\n");
  return { subject, html, text };
}
