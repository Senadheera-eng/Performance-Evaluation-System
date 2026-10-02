// Accounts: invitations, password resets, deactivation.
//
// Public actions (no sign-in needed):
//   { action: "request_reset", identifier }   email or registration/index number
//   { action: "check_token", token }          is an emailed link still good?
//   { action: "redeem", token, password }     set the password from a link
//
// Super Admin actions (the caller's own token is checked):
//   { action: "invite", kind, email, name, ... }   student | lecturer | dept_admin
//   { action: "resend_invite", user_id }
//   { action: "cancel_invite", user_id }      only before the invite is accepted
//   { action: "deactivate", user_id, reason? }
//   { action: "reactivate", user_id }
//
// How the links are kept safe:
//   * A link carries a random 256-bit token. Only its SHA-256 hash is stored,
//     so the table cannot be used to sign in as anyone.
//   * Single use: setting the password claims the token in one conditional
//     update (unused and unexpired), so two uses cannot both succeed. Issuing
//     a new link cancels the person's earlier ones.
//   * Time-limited: invitations last 72 hours, resets 60 minutes.
//   * The token travels after "#" in the link, so it is never sent to the
//     web server or kept in its logs, and opening the page does not use it
//     up -- email scanners that open links cannot spend it.
//   * Links always point at PES_APP_URL, never at an address taken from the
//     request, so a reset email cannot be made to point somewhere else.
//   * Asking for a reset always gets the same answer, whether or not the
//     account exists, and is rate limited per account and per address.
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { emailConfigured, inviteEmail, resetEmail, sendEmail } from "./email.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const APP_URL = (Deno.env.get("PES_APP_URL") ?? "https://pes-usj.vercel.app").replace(/\/+$/, "");

const INVITE_HOURS = 72;
const RESET_MINUTES = 60;
const MIN_PASSWORD = 8;

const STUDENT_DEPARTMENTS = [
  "Civil Engineering",
  "Computer Engineering",
  "Electrical and Electronic Engineering",
  "Mechanical Engineering",
];
const STAFF_DEPARTMENTS = [...STUDENT_DEPARTMENTS, "Interdisciplinary Studies"];

const RESET_REPLY =
  `If that matches an active PES account, a password reset link has been sent to the email address it is registered with. The link expires in ${RESET_MINUTES} minutes.`;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
/** An email as an exact, case-blind ilike pattern: "_" and "%" are not wildcards. */
const exactly = (email: string) => email.replace(/[\\%_]/g, "\\$&");

/* Work that should not hold up the reply (see requestReset). */
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;
function inBackground(p: Promise<unknown>) {
  const guarded = p.catch((e) => console.error("account: background task failed", e));
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(guarded);
  return guarded;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

class Refusal extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/* ------------------------------------------------------------------ */
/* Tokens, hashes, limits                                              */
/* ------------------------------------------------------------------ */

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A hashed subject for the rate-limit log: never the email or address itself. */
const subjectOf = (kind: string, value: string) => sha256(`pes-rate:${kind}:${value.toLowerCase()}`);

function clientIp(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

async function overLimit(db: SupabaseClient, kind: string, subject: string, max: number, minutes: number) {
  const since = new Date(Date.now() - minutes * 60_000).toISOString();
  const { count } = await db
    .from("account_request_log")
    .select("id", { count: "exact", head: true })
    .eq("kind", kind)
    .eq("subject", subject)
    .gte("created_at", since);
  return (count ?? 0) >= max;
}

async function logRequest(db: SupabaseClient, kind: string, subject: string) {
  await db.from("account_request_log").insert({ kind, subject });
}

/** A new link for this person and purpose; their earlier unused ones stop working. */
async function issueToken(
  db: SupabaseClient,
  userId: string,
  purpose: "invite" | "reset",
  sentTo: string,
  createdBy: string | null,
): Promise<string> {
  await db.from("account_tokens").delete().eq("user_id", userId).eq("purpose", purpose).is("used_at", null);
  const token = newToken();
  const lifetime = purpose === "invite" ? INVITE_HOURS * 3_600_000 : RESET_MINUTES * 60_000;
  const { error } = await db.from("account_tokens").insert({
    user_id: userId,
    purpose,
    token_hash: await sha256(token),
    sent_to: sentTo,
    created_by: createdBy,
    expires_at: new Date(Date.now() + lifetime).toISOString(),
  });
  if (error) throw new Error(`Could not create the link: ${error.message}`);
  return token;
}

const linkFor = (purpose: "invite" | "reset", token: string) =>
  `${APP_URL}/account/${purpose === "invite" ? "setup" : "reset"}#token=${token}`;

function passwordProblem(password: unknown, email: string): string | null {
  if (typeof password !== "string" || password.length < MIN_PASSWORD) {
    return `Use at least ${MIN_PASSWORD} characters.`;
  }
  if (password.length > 72) return "Use at most 72 characters.";
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return "Use both letters and numbers.";
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  if (local.length >= 4 && password.toLowerCase().includes(local)) {
    return "Do not use your email or registration number in your password.";
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Who is who                                                          */
/* ------------------------------------------------------------------ */

interface Person {
  userId: string;
  kind: "student" | "lecturer" | "dept_admin" | "super_admin";
  name: string;
  lecturerId?: string;
}

async function personOf(db: SupabaseClient, userId: string): Promise<Person | null> {
  const [{ data: a }, { data: l }, { data: s }] = await Promise.all([
    db.from("admins").select("role, name").eq("id", userId).maybeSingle(),
    db.from("lecturers").select("id, name, title").eq("auth_user_id", userId).maybeSingle(),
    db.from("students").select("name").eq("id", userId).maybeSingle(),
  ]);
  if (a) return { userId, kind: a.role, name: a.name };
  if (l) return { userId, kind: "lecturer", name: l.title ? `${l.title} ${l.name}` : l.name, lecturerId: l.id };
  if (s) return { userId, kind: "student", name: s.name };
  return null;
}

async function isDeactivated(db: SupabaseClient, userId: string): Promise<boolean> {
  const [{ data: d }, { data: a }, { data: l }] = await Promise.all([
    db.from("account_deactivations").select("user_id").eq("user_id", userId).maybeSingle(),
    db.from("admins").select("status").eq("id", userId).maybeSingle(),
    db.from("lecturers").select("status").eq("auth_user_id", userId).maybeSingle(),
  ]);
  return !!d || (a && a.status !== "active") || (l && l.status !== "active") || false;
}

/** Has this account been set up -- a password chosen, or ever signed in?
    An account from a batch intake has a temporary password, so it counts. */
async function hasAccepted(db: SupabaseClient, userId: string): Promise<boolean> {
  const { data: u } = await db.auth.admin.getUserById(userId);
  if (!u?.user) return false;
  if (u.user.last_sign_in_at) return true;
  const { data: hasPassword, error } = await db.rpc("account_has_password", { p_user: userId });
  if (error) throw new Error(error.message);
  return hasPassword === true;
}

/* ------------------------------------------------------------------ */
/* Public: forgot password, check a link, set the password             */
/* ------------------------------------------------------------------ */

async function requestReset(db: SupabaseClient, req: Request, identifier: unknown) {
  const raw = String(identifier ?? "").trim().toLowerCase();
  if (!raw || raw.length > 200) throw new Refusal("Enter your email address or registration number.");

  // The same answer whatever happens below, so nobody can learn from it
  // which addresses have accounts.
  const ip = await subjectOf("ip", clientIp(req));
  const who = await subjectOf("id", raw);
  if (await overLimit(db, "reset_ip", ip, 10, 60)) return { ok: true, message: RESET_REPLY };
  await logRequest(db, "reset_ip", ip);
  if (await overLimit(db, "reset_id", who, 3, 60)) return { ok: true, message: RESET_REPLY };
  await logRequest(db, "reset_id", who);

  // Finding the account and sending the email happen after the reply, so
  // the reply takes the same time whether or not the account exists.
  inBackground(sendReset(db, raw));
  if (Math.random() < 0.05) inBackground(tidyUp(db));
  return { ok: true, message: RESET_REPLY };
}

async function sendReset(db: SupabaseClient, raw: string) {
  let userId: string | null = null;
  if (raw.includes("@")) {
    if (!EMAIL_RE.test(raw)) return;
    const [{ data: s }, { data: l }, { data: a }] = await Promise.all([
      db.from("students").select("id").ilike("email", exactly(raw)).maybeSingle(),
      db.from("lecturers").select("auth_user_id").ilike("email", exactly(raw)).maybeSingle(),
      db.from("admins").select("id").ilike("email", exactly(raw)).maybeSingle(),
    ]);
    userId = s?.id ?? l?.auth_user_id ?? a?.id ?? null;
  } else {
    const id = raw.replace(/[^a-z0-9/-]/g, "");
    if (id.length < 3) return;
    const { data: s } = await db
      .from("students")
      .select("id")
      .or(`reg_number.eq.${id},index_number.ilike.${id}`)
      .limit(1)
      .maybeSingle();
    userId = s?.id ?? null;
  }
  if (!userId || await isDeactivated(db, userId)) return;

  // The address the account signs in with is where the link goes.
  const { data: u } = await db.auth.admin.getUserById(userId);
  const email = u?.user?.email;
  const person = await personOf(db, userId);
  if (!email || !person) return;

  const token = await issueToken(db, userId, "reset", email, null);
  const mail = resetEmail({ name: person.name, url: linkFor("reset", token), minutes: RESET_MINUTES });
  const sent = await sendEmail(email, mail.subject, mail.html, mail.text);
  if (!sent.sent) console.error(`account: reset email not sent: ${sent.error}`);
}

/* Old rate-limit entries and spent links are of no further use. */
async function tidyUp(db: SupabaseClient) {
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  await db.from("account_request_log").delete().lt("created_at", dayAgo);
  await db.from("account_tokens").delete().lt("expires_at", weekAgo);
}

async function findToken(db: SupabaseClient, req: Request, token: unknown) {
  const ip = await subjectOf("ip", clientIp(req));
  if (await overLimit(db, "token_fail", ip, 20, 60)) {
    throw new Refusal("Too many attempts from this network. Try again in an hour.", 429);
  }
  const t = typeof token === "string" && /^[A-Za-z0-9_-]{40,60}$/.test(token) ? token : null;
  const { data } = t
    ? await db
      .from("account_tokens")
      .select("id, user_id, purpose, expires_at, used_at")
      .eq("token_hash", await sha256(t))
      .maybeSingle()
    : { data: null };
  if (!data || data.used_at || new Date(data.expires_at).getTime() <= Date.now()) {
    await logRequest(db, "token_fail", ip);
    throw new Refusal(
      "This link is no longer valid: it has expired, has already been used, or a newer link was sent. Ask for a new one.",
      410,
    );
  }
  return data as { id: string; user_id: string; purpose: "invite" | "reset"; expires_at: string };
}

async function checkToken(db: SupabaseClient, req: Request, token: unknown) {
  const row = await findToken(db, req, token);
  if (await isDeactivated(db, row.user_id)) throw new Refusal("This account has been deactivated.", 403);
  const { data: u } = await db.auth.admin.getUserById(row.user_id);
  const person = await personOf(db, row.user_id);
  return {
    valid: true,
    purpose: row.purpose,
    // The holder of the link reached it through this mailbox; telling them
    // the address they will sign in with is what they need next.
    email: u?.user?.email ?? null,
    first_name: person?.name.split(" ")[0] ?? null,
    expires_at: row.expires_at,
  };
}

async function redeem(db: SupabaseClient, req: Request, token: unknown, password: unknown) {
  const row = await findToken(db, req, token);
  const { data: u } = await db.auth.admin.getUserById(row.user_id);
  const user = u?.user;
  if (!user?.email) throw new Refusal("This account no longer exists.", 410);
  if (await isDeactivated(db, row.user_id)) throw new Refusal("This account has been deactivated.", 403);
  const problem = passwordProblem(password, user.email);
  if (problem) throw new Refusal(problem);

  // Claim the link: one statement, so only one use can win.
  const { data: claimed } = await db
    .from("account_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("id", row.id)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("id");
  if (!claimed?.length) throw new Refusal("This link has already been used.", 410);

  const { error } = await db.auth.admin.updateUserById(row.user_id, {
    password: password as string,
    email_confirm: true,
    user_metadata: { ...(user.user_metadata ?? {}), must_change_password: false },
  });
  if (error) {
    // Not set, so the link is not spent.
    await db.from("account_tokens").update({ used_at: null }).eq("id", row.id);
    throw new Refusal(/weak|pwned|leaked/i.test(error.message)
      ? "That password is too easy to guess or has appeared in a data breach. Choose another."
      : `The password could not be set: ${error.message}`);
  }

  // Any other open link for this person is now pointless.
  await db.from("account_tokens").delete().eq("user_id", row.user_id).is("used_at", null);

  // A reset also signs the account out everywhere else: whoever knew the old
  // password is no longer signed in with it.
  if (row.purpose === "reset") {
    try {
      const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
      const { data: s } = await anon.auth.signInWithPassword({ email: user.email, password: password as string });
      if (s?.session) await db.auth.admin.signOut(s.session.access_token, "global");
    } catch (e) {
      console.error("account: could not sign out other sessions", e);
    }
  }
  return { ok: true, email: user.email };
}

/* ------------------------------------------------------------------ */
/* Super Admin                                                         */
/* ------------------------------------------------------------------ */

// deno-lint-ignore no-explicit-any
type Body = Record<string, any>;

const clean = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();

async function invite(db: SupabaseClient, adminId: string, b: Body) {
  if (await overLimit(db, "invite", adminId, 200, 60)) {
    throw new Refusal("Too many invitations in the last hour. Try again later.", 429);
  }
  const kind = String(b.kind ?? "");
  if (!["student", "lecturer", "dept_admin"].includes(kind)) throw new Refusal("Choose student, lecturer or department admin.");
  const name = clean(b.name);
  if (name.length < 3) throw new Refusal("Enter the person's name.");
  const reg = clean(b.reg_number);
  const email = (clean(b.email) || (kind === "student" && reg ? `en${reg}@foe.sjp.ac.lk` : "")).toLowerCase();
  if (!EMAIL_RE.test(email)) throw new Refusal("Enter a valid email address.");
  const department = clean(b.department) || null;

  // What each kind needs, checked before anything is created.
  let profile: Record<string, unknown> = {};
  let existingLecturer: { id: string } | null = null;
  if (kind === "student") {
    if (!/^[A-Za-z0-9/-]{3,20}$/.test(reg)) throw new Refusal("Enter a valid registration number.");
    const batchYear = Number(b.batch_year);
    if (!Number.isInteger(batchYear) || batchYear < 2000 || batchYear > 2100) throw new Refusal("Enter the intake year.");
    if (department && !STUDENT_DEPARTMENTS.includes(department)) throw new Refusal("Unknown department.");
    const { data: taken } = await db.from("students").select("id").or(`reg_number.eq.${reg},email.eq.${email}`).limit(1);
    if (taken?.length) throw new Refusal("A student with this registration number or email is already in PES.");
    profile = {
      name, email, reg_number: reg, index_number: clean(b.index_number).toUpperCase() || null,
      department, batch_year: batchYear, role: "student", status: "active",
    };
  } else if (kind === "lecturer") {
    if (!department || !STAFF_DEPARTMENTS.includes(department)) throw new Refusal("Choose the lecturer's department.");
    const { data: l } = await db.from("lecturers").select("id, auth_user_id").ilike("email", exactly(email)).maybeSingle();
    if (l?.auth_user_id) throw new Refusal("This lecturer already has a PES account.");
    existingLecturer = l ? { id: l.id } : null;
    profile = { name, email, department, title: clean(b.title) || null, staff_no: clean(b.staff_no) || null, status: "active" };
  } else {
    if (!department || !STAFF_DEPARTMENTS.includes(department)) throw new Refusal("Choose the department this admin looks after.");
    profile = { name, email, department, role: "dept_admin", status: "active" };
  }
  // The sign-in account, with no password: they choose it from the link.
  const { data: created, error: authError } = await db.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { name },
  });
  if (authError || !created?.user) {
    throw new Refusal(/already|registered|exists/i.test(authError?.message ?? "")
      ? "This email address already has a PES account."
      : authError?.message ?? "The account could not be created.");
  }
  const userId = created.user.id;

  const { error: rowError } = kind === "student"
    ? await db.from("students").insert({ id: userId, ...profile })
    : kind === "lecturer"
    ? existingLecturer
      ? await db.from("lecturers").update({ auth_user_id: userId, status: "active", updated_at: new Date().toISOString() }).eq("id", existingLecturer.id).is("auth_user_id", null)
      : await db.from("lecturers").insert({ ...profile, auth_user_id: userId })
    : await db.from("admins").insert({ id: userId, ...profile });
  if (rowError) {
    await db.auth.admin.deleteUser(userId); // no half-made account
    throw new Refusal(`The ${kind === "dept_admin" ? "admin" : kind} could not be added: ${rowError.message}`);
  }
  await logRequest(db, "invite", adminId);
  return { user_id: userId, ...(await sendInvite(db, adminId, userId, email, name, kind)) };
}

async function sendInvite(db: SupabaseClient, adminId: string, userId: string, email: string, name: string, kind: string) {
  const token = await issueToken(db, userId, "invite", email, adminId);
  const url = linkFor("invite", token);
  const mail = inviteEmail({ name, email, kind, url, hours: INVITE_HOURS });
  const sent = await sendEmail(email, mail.subject, mail.html, mail.text);
  return {
    ok: true,
    email,
    emailed: sent.sent,
    // Only when the email could not go: the Super Admin passes it on.
    ...(sent.sent ? {} : { invite_link: url, email_error: sent.error }),
    expires_in_hours: INVITE_HOURS,
  };
}

async function resendInvite(db: SupabaseClient, adminId: string, userId: string) {
  const person = await personOf(db, userId);
  if (!person || person.kind === "super_admin") throw new Refusal("No such user.", 404);
  if (await isDeactivated(db, userId)) throw new Refusal("This account is deactivated. Reactivate it first.");
  if (await hasAccepted(db, userId)) throw new Refusal("This person has already set their password. They can use Forgot password.");
  const { data: u } = await db.auth.admin.getUserById(userId);
  if (!u?.user?.email) throw new Refusal("No such user.", 404);
  return sendInvite(db, adminId, userId, u.user.email, person.name, person.kind);
}

async function cancelInvite(db: SupabaseClient, userId: string) {
  const person = await personOf(db, userId);
  if (!person || person.kind === "super_admin") throw new Refusal("No such user.", 404);
  if (await hasAccepted(db, userId)) {
    throw new Refusal("This person has already set up their account. Deactivate it instead.");
  }
  if (person.kind === "student") {
    // A student who never signed in has no records -- but if someone has
    // already added some, deleting would take them too. Refuse.
    const [{ count: r }, { count: e }, { count: a }] = await Promise.all([
      db.from("results").select("id", { count: "exact", head: true }).eq("student_id", userId),
      db.from("enrollments").select("id", { count: "exact", head: true }).eq("student_id", userId),
      db.from("attendance").select("id", { count: "exact", head: true }).eq("student_id", userId),
    ]);
    if ((r ?? 0) + (e ?? 0) + (a ?? 0) > 0) {
      throw new Refusal("This student already has academic records. Deactivate the account instead.");
    }
    await db.from("students").delete().eq("id", userId);
  }
  // A lecturer keeps their lecturer record (it lets go of the account);
  // an admin's row goes with the account.
  const { error } = await db.auth.admin.deleteUser(userId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

async function deactivate(db: SupabaseClient, adminId: string, userId: string, reason: unknown) {
  if (userId === adminId) throw new Refusal("You cannot deactivate your own account.");
  const person = await personOf(db, userId);
  if (!person) throw new Refusal("No such user.", 404);
  if (person.kind === "super_admin") throw new Refusal("The Super Admin's account cannot be deactivated here.");
  if (person.lecturerId) {
    const { data: hod } = await db
      .from("hod_appointments")
      .select("department")
      .eq("lecturer_id", person.lecturerId)
      .eq("is_active", true)
      .maybeSingle();
    if (hod) {
      throw new Refusal(`This lecturer is Head of ${hod.department}. Appoint another head first, on Heads of Department.`);
    }
  }

  // Nothing is deleted: the person's records stay. Access ends now -- the
  // database refuses their admin and lecturer rights from this moment, the
  // app signs them out, and the sign-in itself is barred.
  const { error } = await db.from("account_deactivations").upsert({
    user_id: userId,
    deactivated_by: adminId,
    reason: clean(reason).slice(0, 300) || null,
    deactivated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  if (person.kind === "dept_admin") await db.from("admins").update({ status: "inactive" }).eq("id", userId);
  if (person.kind === "lecturer") {
    await db.from("lecturers").update({ status: "inactive", updated_at: new Date().toISOString() }).eq("auth_user_id", userId);
  }
  await db.auth.admin.updateUserById(userId, { ban_duration: "876000h" });
  await db.from("account_tokens").delete().eq("user_id", userId).is("used_at", null);
  return { ok: true };
}

async function reactivate(db: SupabaseClient, userId: string) {
  const person = await personOf(db, userId);
  if (!person || person.kind === "super_admin") throw new Refusal("No such user.", 404);
  await db.from("account_deactivations").delete().eq("user_id", userId);
  if (person.kind === "dept_admin") await db.from("admins").update({ status: "active" }).eq("id", userId);
  if (person.kind === "lecturer") {
    await db.from("lecturers").update({ status: "active", updated_at: new Date().toISOString() }).eq("auth_user_id", userId);
  }
  const { error } = await db.auth.admin.updateUserById(userId, { ban_duration: "none" });
  if (error) throw new Error(error.message);
  return { ok: true };
}

/* ------------------------------------------------------------------ */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const body: Body = await req.json().catch(() => ({}));

  try {
    switch (body.action) {
      case "request_reset":
        return json(await requestReset(db, req, body.identifier));
      case "check_token":
        return json(await checkToken(db, req, body.token));
      case "redeem":
        return json(await redeem(db, req, body.token, body.password));
    }

    // Everything else is the Super Admin's.
    const caller = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
      auth: { persistSession: false },
    });
    const [{ data: who }, { data: isSuper }] = await Promise.all([
      caller.auth.getUser(),
      caller.rpc("is_super_admin"),
    ]);
    if (!who?.user || isSuper !== true) return json({ error: "Only the Super Admin can manage users." }, 403);
    const adminId = who.user.id;
    const userId = typeof body.user_id === "string" ? body.user_id : "";

    switch (body.action) {
      case "invite":
        return json(await invite(db, adminId, body));
      case "resend_invite":
        return json(await resendInvite(db, adminId, userId));
      case "cancel_invite":
        return json(await cancelInvite(db, userId));
      case "deactivate":
        return json(await deactivate(db, adminId, userId, body.reason));
      case "reactivate":
        return json(await reactivate(db, userId));
      case "email_status":
        return json({ configured: emailConfigured(), app_url: APP_URL });
      default:
        return json({ error: "Unknown action." }, 400);
    }
  } catch (e) {
    if (e instanceof Refusal) return json({ error: e.message }, e.status);
    console.error("account:", e);
    return json({ error: "Something went wrong. Try again." }, 500);
  }
});
