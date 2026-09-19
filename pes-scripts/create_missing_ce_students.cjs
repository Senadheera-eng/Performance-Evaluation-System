// Creates Supabase Auth accounts + students table rows for the 4 Civil
// Engineering Batch 7 students who were missing from the system:
// 21/ENG/040, 21/ENG/051, 21/ENG/062, 21/ENG/137
//
// SETUP:
//   npm install @supabase/supabase-js
//   Set these two environment variables before running (or paste
//   directly below where marked):
//     SUPABASE_URL              -> https://cktbxkxhthoqeyvzspav.supabase.co
//     SUPABASE_SERVICE_ROLE_KEY -> from Supabase dashboard > Project Settings > API
//                                   (the "service_role" secret key, NOT the anon key)
//
// RUN:
//   node create_missing_ce_students.cjs
//
// Safe to re-run: skips any student whose reg_number already exists.

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://cktbxkxhthoqeyvzspav.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'PASTE_YOUR_SERVICE_ROLE_KEY_HERE';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const NEW_STUDENTS = [
  { reg_number: '102756', name: 'HEWA ALANKARAGE PIYUMI NAVODYA THAKSARANI', index_no: '21/ENG/040' },
  { reg_number: '102843', name: 'KALUAPPUWA HANNADIGE THANURA RAVEEN',       index_no: '21/ENG/051' },
  { reg_number: '102729', name: 'KATUPOTHA NAIDELAGE LAHIRU DILSHAN NANDASENA', index_no: '21/ENG/062' },
  { reg_number: '102823', name: 'SUWENTHIRAN KEERTHIKA',                    index_no: '21/ENG/137' },
];

const DEPARTMENT = 'Civil Engineering';
const BATCH_YEAR = 2021;
const PASSWORD = 'pes@123';

async function main() {
  if (SERVICE_ROLE_KEY === 'PASTE_YOUR_SERVICE_ROLE_KEY_HERE') {
    console.error('ERROR: set SUPABASE_SERVICE_ROLE_KEY (env var or edit the script).');
    process.exit(1);
  }

  for (const s of NEW_STUDENTS) {
    const email = `en${s.reg_number}@foe.sjp.ac.lk`;

    const { data: existing } = await supabase
      .from('students')
      .select('id')
      .eq('reg_number', s.reg_number)
      .maybeSingle();

    if (existing) {
      console.log(`SKIP ${s.index_no} (${s.reg_number}) - already exists`);
      continue;
    }

    // 1. Create the Auth user
    const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { name: s.name, reg_number: s.reg_number }
    });

    if (authErr) {
      console.error(`AUTH FAILED for ${s.index_no} (${email}):`, authErr.message);
      continue;
    }

    const authId = authData.user.id;

    // 2. Insert the students row using the SAME id as the auth user
    //    (Supabase ignores a custom id passed to createUser, so we sync
    //    it here instead, matching your existing account-creation pattern)
    const { error: dbErr } = await supabase
      .from('students')
      .insert({
        id: authId,
        reg_number: s.reg_number,
        name: s.name,
        email,
        department: DEPARTMENT,
        batch_year: BATCH_YEAR,
        role: 'student'
      });

    if (dbErr) {
      console.error(`STUDENTS INSERT FAILED for ${s.index_no}:`, dbErr.message);
      // roll back the auth user so a re-run can try cleanly
      await supabase.auth.admin.deleteUser(authId);
      continue;
    }

    console.log(`OK ${s.index_no} (${s.reg_number}) -> ${email}, id=${authId}`);
  }

  console.log('Done.');
}

main();
