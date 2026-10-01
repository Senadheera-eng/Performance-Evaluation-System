// Bringing a batch of students into PES, and removing one that has left.
//
// Both need the service role: a student is a sign-in account (auth.users)
// and a row in students sharing its id, and only the service role can create
// or delete sign-in accounts. So this function does the account work, and
// only for the Super Admin -- the caller's own token is checked first.
//
//   { action: "intake", batch_year, students: [{ name, reg_number,
//     index_number?, email?, department? }] }
//       Creates an account and a student row for each, with a random
//       temporary password the student must change at first sign-in, and
//       returns the passwords so the Super Admin can hand them out. They are
//       not stored anywhere. The page sends a long list in chunks.
//
//   { action: "remove", batch_year, keep_feedback }
//       Deletes the batch's students -- one statement, which takes their
//       results, attendance, enrolments, medical submissions, mentoring and
//       minor choice with them -- then their stored files and their sign-in
//       accounts. Course feedback is kept anonymously unless keep_feedback is
//       false. Returns what was removed.
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/* A chunk of an intake, not the whole of it: the page sends a long list in
   pieces so each call finishes well inside the platform's time limit. */
const MAX_PER_CALL = 60;
const CONCURRENCY = 5;
const STUDENT_DEPARTMENTS = [
  "Civil Engineering",
  "Computer Engineering",
  "Electrical and Electronic Engineering",
  "Mechanical Engineering",
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

/* Ten characters a student can read off a sheet and type: no 0/O, 1/l/I. */
function temporaryPassword(): string {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz";
  const digits = "23456789";
  const all = letters + digits;
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  const chars = Array.from(bytes, (b) => all[b % all.length]);
  // At least one digit and one letter, wherever they fall.
  chars[bytes[0] % 10] = digits[bytes[1] % digits.length];
  if (!chars.some((c) => letters.includes(c))) chars[(bytes[0] + 1) % 10] = letters[bytes[2] % letters.length];
  return chars.join("");
}

async function inParallel<T, R>(items: T[], n: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

const chunks = <T>(xs: T[], size: number) =>
  Array.from({ length: Math.ceil(xs.length / size) }, (_, i) => xs.slice(i * size, i * size + size));

interface IntakeRow {
  name?: string;
  reg_number?: string;
  index_number?: string | null;
  email?: string | null;
  department?: string | null;
}

async function intake(admin: SupabaseClient, batchYear: number, rows: IntakeRow[]) {
  // Tidy and check every row before creating anything.
  const clean = rows.map((r) => {
    const name = String(r.name ?? "").replace(/\s+/g, " ").trim();
    const reg = String(r.reg_number ?? "").trim();
    const index = String(r.index_number ?? "").trim() || null;
    const email = (String(r.email ?? "").trim() || (reg ? `en${reg}@foe.sjp.ac.lk` : "")).toLowerCase();
    const department = String(r.department ?? "").trim() || null;
    let error: string | null = null;
    if (name.length < 3) error = "Name is missing";
    else if (!/^[A-Za-z0-9/-]{3,20}$/.test(reg)) error = "Registration number is missing or not valid";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) error = "Email is not valid";
    else if (department && !STUDENT_DEPARTMENTS.includes(department)) error = `Unknown department "${department}"`;
    return { name, reg, index, email, department, error };
  });

  // Twice in the same list: the first stays, the rest are refused.
  const seenRegs = new Set<string>();
  const seenEmails = new Set<string>();
  clean.forEach((c) => {
    if (c.error) return;
    if (seenRegs.has(c.reg)) c.error = "This registration number is in the list twice";
    else if (seenEmails.has(c.email)) c.error = "This email is in the list twice";
    seenRegs.add(c.reg);
    seenEmails.add(c.email);
  });

  // Already in PES: a registration number or an email cannot be used twice.
  const regs = clean.map((c) => c.reg).filter(Boolean);
  const emails = clean.map((c) => c.email).filter(Boolean);
  const [{ data: byReg }, { data: byEmail }] = await Promise.all([
    admin.from("students").select("reg_number").in("reg_number", regs),
    admin.from("students").select("email").in("email", emails),
  ]);
  const takenRegs = new Set((byReg ?? []).map((r) => r.reg_number));
  const takenEmails = new Set((byEmail ?? []).map((r) => String(r.email).toLowerCase()));
  clean.forEach((c) => {
    if (c.error) return;
    if (takenRegs.has(c.reg)) c.error = "This registration number is already in PES";
    else if (takenEmails.has(c.email)) c.error = "This email is already in PES";
  });

  const results = await inParallel(clean, CONCURRENCY, async (c) => {
    if (c.error) return { reg_number: c.reg, name: c.name, email: c.email, ok: false, error: c.error };
    const password = temporaryPassword();
    const { data: created, error: authError } = await admin.auth.admin.createUser({
      email: c.email,
      password,
      email_confirm: true,
      user_metadata: { name: c.name, must_change_password: true },
    });
    if (authError || !created?.user) {
      const message = /already|exists|registered/i.test(authError?.message ?? "")
        ? "A sign-in account with this email already exists"
        : authError?.message ?? "The sign-in account could not be created";
      return { reg_number: c.reg, name: c.name, email: c.email, ok: false, error: message };
    }
    const { error: rowError } = await admin.from("students").insert({
      id: created.user.id,
      name: c.name,
      email: c.email,
      reg_number: c.reg,
      index_number: c.index,
      department: c.department,
      batch_year: batchYear,
      role: "student",
      status: "active",
    });
    if (rowError) {
      // No half-made student: the account goes if its row could not be made.
      await admin.auth.admin.deleteUser(created.user.id);
      return { reg_number: c.reg, name: c.name, email: c.email, ok: false, error: rowError.message };
    }
    return {
      reg_number: c.reg,
      index_number: c.index,
      name: c.name,
      email: c.email,
      department: c.department,
      ok: true,
      password,
    };
  });

  return { batch_year: batchYear, created: results.filter((r) => r.ok).length, results };
}

async function remove(
  admin: SupabaseClient,
  user: SupabaseClient,
  batchYear: number,
  keepFeedback: boolean,
) {
  // Counted through the caller's own token, before anything goes.
  const { data: footprint, error: fpError } = await user.rpc("get_batch_footprint", {
    p_batch_year: batchYear,
  });
  if (fpError) throw new Error(fpError.message);

  const { data: students, error: sError } = await admin
    .from("students")
    .select("id")
    .eq("batch_year", batchYear)
    .eq("role", "student");
  if (sError) throw new Error(sError.message);
  const ids = (students ?? []).map((s) => s.id as string);
  if (ids.length === 0) throw new Error(`There are no students in the ${batchYear} intake.`);

  // The stored files, whose paths only the database knows.
  const medicalFiles: string[] = [];
  const mentorFiles: string[] = [];
  for (const part of chunks(ids, 80)) {
    const [{ data: med }, { data: assignments }] = await Promise.all([
      admin.from("medical_submissions").select("medical_submission_files(file_url)").in("student_id", part),
      admin.from("mentor_assignments").select("id").in("student_id", part),
    ]);
    (med ?? []).forEach((m: { medical_submission_files: { file_url: string }[] }) =>
      (m.medical_submission_files ?? []).forEach((f) => f.file_url && medicalFiles.push(f.file_url))
    );
    const assignmentIds = (assignments ?? []).map((a) => a.id as string);
    for (const ap of chunks(assignmentIds, 80)) {
      const { data: msgs } = await admin
        .from("mentor_messages")
        .select("attachment_path")
        .in("assignment_id", ap)
        .not("attachment_path", "is", null);
      (msgs ?? []).forEach((m) => m.attachment_path && mentorFiles.push(m.attachment_path as string));
    }
  }

  // The records. Deleting the students takes everything they own with them;
  // course feedback lets go of them and stays, anonymous, unless asked.
  let feedbackDeleted = 0;
  for (const part of chunks(ids, 80)) {
    if (!keepFeedback) {
      const { count, error } = await admin
        .from("feedback_submissions")
        .delete({ count: "exact" })
        .in("student_id", part);
      if (error) throw new Error(`Removing course feedback: ${error.message}`);
      feedbackDeleted += count ?? 0;
    }
    const { error: nError } = await admin.from("notifications").delete().in("recipient_id", part);
    if (nError) throw new Error(`Removing notifications: ${nError.message}`);
  }
  const { error: delError } = await admin
    .from("students")
    .delete()
    .eq("batch_year", batchYear)
    .eq("role", "student");
  if (delError) throw new Error(`Removing the students: ${delError.message}`);

  // Then what lives outside the tables: files, and the sign-in accounts.
  const failures: string[] = [];
  const removeFiles = async (bucket: string, paths: string[]) => {
    let removed = 0;
    for (const part of chunks(paths, 100)) {
      const { data, error } = await admin.storage.from(bucket).remove(part);
      if (error) failures.push(`${bucket}: ${error.message}`);
      removed += data?.length ?? 0;
    }
    return removed;
  };
  const files =
    (await removeFiles("avatars", ids)) +
    (await removeFiles("medical-certificates", medicalFiles)) +
    (await removeFiles("mentor-attachments", mentorFiles));

  let accounts = 0;
  await inParallel(ids, CONCURRENCY, async (id) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (!error || /not.?found/i.test(error.message)) {
        accounts++;
        return;
      }
      if (attempt === 2) failures.push(`account ${id}: ${error.message}`);
    }
  });

  return {
    batch_year: batchYear,
    removed: {
      ...(footprint as Record<string, number>),
      files,
      accounts,
      feedback_deleted: feedbackDeleted,
    },
    feedback_kept_anonymously: keepFeedback,
    failures,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  const authHeader = req.headers.get("Authorization") ?? "";
  const user = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: isSuper, error: roleError } = await user.rpc("is_super_admin");
  if (roleError || isSuper !== true) {
    return json({ error: "Only the Super Admin can manage batches." }, 403);
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // deno-lint-ignore no-explicit-any
  const body: any = await req.json().catch(() => ({}));
  const batchYear = Number(body.batch_year);
  if (!Number.isInteger(batchYear) || batchYear < 2000 || batchYear > 2100) {
    return json({ error: "Give the intake year, e.g. 2026." }, 400);
  }

  try {
    if (body.action === "intake") {
      const rows: IntakeRow[] = Array.isArray(body.students) ? body.students : [];
      if (rows.length === 0) return json({ error: "No students to add." }, 400);
      if (rows.length > MAX_PER_CALL) {
        return json({ error: `At most ${MAX_PER_CALL} students per request.` }, 400);
      }
      return json(await intake(admin, batchYear, rows));
    }
    if (body.action === "remove") {
      return json(await remove(admin, user, batchYear, body.keep_feedback !== false));
    }
    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
