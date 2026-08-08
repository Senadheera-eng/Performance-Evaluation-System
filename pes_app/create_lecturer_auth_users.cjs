// ============================================================
// PES — provision Lecturer login accounts
//
//   node create_lecturer_auth_users.cjs            # dry run, changes nothing
//   node create_lecturer_auth_users.cjs --apply    # actually create + link
//
// Reads the active lecturers straight out of the database rather than a
// hardcoded list, so it stays correct as staff change, and writes the new
// auth user id back to lecturers.auth_user_id — which is what
// my_lecturer_id() resolves through, and therefore what every lecturer
// permission in the schema depends on.
//
// Idempotent: a lecturer that already has auth_user_id set is skipped, and
// an auth user that already exists for that email is linked rather than
// re-created.
//
// SECURITY: the shared default password below is a development convenience
// only. Every lecturer email is printed in the public Faculty Handbook, so
// the username list is already public and the password is the only thing
// standing in front of real student records. Before this system is used for
// real, switch to inviteUserByEmail() (see --invite) so each lecturer sets
// their own password and nobody else ever knows it.
// ============================================================

const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DEFAULT_PASSWORD = process.env.LECTURER_DEFAULT_PASSWORD || "pes@123";

const APPLY = process.argv.includes("--apply");
const INVITE = process.argv.includes("--invite");

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local",
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** Existing auth users keyed by lowercased email, so a re-run links instead
 *  of failing on "user already registered". */
async function loadExistingAuthUsers() {
  const byEmail = new Map();
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    if (!data.users.length) break;
    for (const u of data.users) {
      if (u.email) byEmail.set(u.email.toLowerCase(), u.id);
    }
    if (data.users.length < 200) break;
  }
  return byEmail;
}

async function main() {
  const { data: lecturers, error } = await supabase
    .from("lecturers")
    .select("id, name, title, email, department, auth_user_id")
    .eq("status", "active")
    .order("department")
    .order("name");

  if (error) {
    console.error(`Could not read lecturers: ${error.message}`);
    process.exit(1);
  }

  const { data: hods } = await supabase
    .from("hod_appointments")
    .select("lecturer_id")
    .eq("is_active", true);
  const hodIds = new Set((hods ?? []).map((h) => h.lecturer_id));

  const existing = await loadExistingAuthUsers();

  const toCreate = [];
  const toLink = [];
  const alreadyDone = [];
  const nonFaculty = [];

  for (const l of lecturers) {
    if (l.auth_user_id) {
      alreadyDone.push(l);
      continue;
    }
    // The handbook prints one personal address among the academic staff; a
    // login on a non-faculty domain is a decision for the department, not
    // something this script should make silently.
    if (!l.email.toLowerCase().endsWith("sjp.ac.lk")) nonFaculty.push(l);

    const found = existing.get(l.email.toLowerCase());
    if (found) toLink.push({ ...l, authId: found });
    else toCreate.push(l);
  }

  const label = (l) =>
    `${(l.title ? l.title + " " : "") + l.name}${hodIds.has(l.id) ? "  [HOD]" : ""}`;

  console.log(`Active lecturers:        ${lecturers.length}`);
  console.log(`Already linked:          ${alreadyDone.length}`);
  console.log(`Existing auth to link:   ${toLink.length}`);
  console.log(`Accounts to create:      ${toCreate.length}`);
  if (nonFaculty.length) {
    console.log(
      `\nNot on an sjp.ac.lk address (${nonFaculty.length}) — confirm before provisioning:`,
    );
    for (const l of nonFaculty) console.log(`  ${l.email}  ${label(l)}`);
  }

  if (!APPLY) {
    console.log(
      `\nDRY RUN — nothing was changed. Re-run with --apply to proceed.`,
    );
    console.log(
      INVITE
        ? "Mode: --invite (each lecturer receives an email and sets their own password)"
        : `Mode: shared default password "${DEFAULT_PASSWORD}" — development only`,
    );
    for (const l of [...toCreate, ...toLink]) {
      console.log(`  ${l.email.padEnd(34)} ${l.department.padEnd(38)} ${label(l)}`);
    }
    return;
  }

  let created = 0,
    linked = 0,
    failed = 0;

  for (const l of toLink) {
    const { error: linkErr } = await supabase
      .from("lecturers")
      .update({ auth_user_id: l.authId })
      .eq("id", l.id);
    if (linkErr) {
      console.error(`LINK FAIL ${l.email}: ${linkErr.message}`);
      failed++;
    } else {
      console.log(`LINKED    ${l.email}`);
      linked++;
    }
  }

  for (const l of toCreate) {
    let authId;

    if (INVITE) {
      const { data, error: invErr } = await supabase.auth.admin.inviteUserByEmail(
        l.email,
      );
      if (invErr) {
        console.error(`INVITE FAIL ${l.email}: ${invErr.message}`);
        failed++;
        continue;
      }
      authId = data.user.id;
    } else {
      const { data, error: createErr } = await supabase.auth.admin.createUser({
        email: l.email,
        password: DEFAULT_PASSWORD,
        email_confirm: true,
        user_metadata: { kind: "lecturer", department: l.department },
      });
      if (createErr) {
        console.error(`CREATE FAIL ${l.email}: ${createErr.message}`);
        failed++;
        continue;
      }
      authId = data.user.id;
    }

    // Link immediately. An auth user with no lecturers.auth_user_id can sign
    // in but resolves to no profile at all, which is worse than not existing.
    const { error: linkErr } = await supabase
      .from("lecturers")
      .update({ auth_user_id: authId })
      .eq("id", l.id);

    if (linkErr) {
      console.error(
        `CREATED BUT NOT LINKED ${l.email}: ${linkErr.message} (auth id ${authId})`,
      );
      failed++;
    } else {
      console.log(`${INVITE ? "INVITED" : "CREATED"}   ${l.email}  ${label(l)}`);
      created++;
    }
  }

  console.log(
    `\nDone: ${created} ${INVITE ? "invited" : "created"}, ${linked} linked, ${failed} failed.`,
  );
  if (!INVITE && created > 0) {
    console.log(
      `\nAll ${created} accounts share the password "${DEFAULT_PASSWORD}". ` +
        `Replace this with --invite before the system holds anything you would not publish.`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
