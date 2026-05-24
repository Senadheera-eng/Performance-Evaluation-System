require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const emailToReg = {
  "en109010@foe.sjp.ac.lk": "22/ENG/001",
  "en108913@foe.sjp.ac.lk": "22/ENG/002",
  "en108961@foe.sjp.ac.lk": "22/ENG/003",
  "en109020@foe.sjp.ac.lk": "22/ENG/004",
  "en109052@foe.sjp.ac.lk": "22/ENG/005",
  "en108893@foe.sjp.ac.lk": "22/ENG/006",
  "en109044@foe.sjp.ac.lk": "22/ENG/007",
  "en108921@foe.sjp.ac.lk": "22/ENG/008",
  "en109015@foe.sjp.ac.lk": "22/ENG/009",
  "en109030@foe.sjp.ac.lk": "22/ENG/010",
  "en108933@foe.sjp.ac.lk": "22/ENG/011",
  "en109046@foe.sjp.ac.lk": "22/ENG/013",
  "en108970@foe.sjp.ac.lk": "22/ENG/014",
  "en108994@foe.sjp.ac.lk": "22/ENG/016",
  "en108908@foe.sjp.ac.lk": "22/ENG/017",
  "en108897@foe.sjp.ac.lk": "22/ENG/018",
  "en108884@foe.sjp.ac.lk": "22/ENG/019",
  "en108889@foe.sjp.ac.lk": "22/ENG/020",
  "en108912@foe.sjp.ac.lk": "22/ENG/021",
  "en108902@foe.sjp.ac.lk": "22/ENG/022",
  "en108926@foe.sjp.ac.lk": "22/ENG/023",
  "en108924@foe.sjp.ac.lk": "22/ENG/024",
  "en109026@foe.sjp.ac.lk": "22/ENG/025",
  "en108916@foe.sjp.ac.lk": "22/ENG/026",
  "en108945@foe.sjp.ac.lk": "22/ENG/027",
  "en108972@foe.sjp.ac.lk": "22/ENG/028",
  "en108885@foe.sjp.ac.lk": "22/ENG/029",
  "en108910@foe.sjp.ac.lk": "22/ENG/030",
  "en108931@foe.sjp.ac.lk": "22/ENG/031",
  "en108946@foe.sjp.ac.lk": "22/ENG/032",
  "en109014@foe.sjp.ac.lk": "22/ENG/033",
  "en109023@foe.sjp.ac.lk": "22/ENG/034",
  "en108886@foe.sjp.ac.lk": "22/ENG/035",
  "en109011@foe.sjp.ac.lk": "22/ENG/036",
  "en108929@foe.sjp.ac.lk": "22/ENG/037",
  "en108907@foe.sjp.ac.lk": "22/ENG/038",
  "en108918@foe.sjp.ac.lk": "22/ENG/039",
  "en108969@foe.sjp.ac.lk": "22/ENG/040",
  "en108888@foe.sjp.ac.lk": "22/ENG/041",
  "en109035@foe.sjp.ac.lk": "22/ENG/042",
  "en108941@foe.sjp.ac.lk": "22/ENG/043",
  "en108930@foe.sjp.ac.lk": "22/ENG/044",
  "en108948@foe.sjp.ac.lk": "22/ENG/046",
  "en108923@foe.sjp.ac.lk": "22/ENG/047",
  "en108989@foe.sjp.ac.lk": "22/ENG/048",
  "en108903@foe.sjp.ac.lk": "22/ENG/049",
  "en108895@foe.sjp.ac.lk": "22/ENG/050",
  "en108998@foe.sjp.ac.lk": "22/ENG/051",
  "en108883@foe.sjp.ac.lk": "22/ENG/052",
  "en108917@foe.sjp.ac.lk": "22/ENG/053",
  "en108909@foe.sjp.ac.lk": "22/ENG/054",
  "en109025@foe.sjp.ac.lk": "22/ENG/055",
  "en109028@foe.sjp.ac.lk": "22/ENG/057",
  "en108925@foe.sjp.ac.lk": "22/ENG/058",
  "en108978@foe.sjp.ac.lk": "22/ENG/059",
  "en108906@foe.sjp.ac.lk": "22/ENG/060",
  "en108891@foe.sjp.ac.lk": "22/ENG/061",
  "en108949@foe.sjp.ac.lk": "22/ENG/062",
  "en108991@foe.sjp.ac.lk": "22/ENG/063",
  "en108952@foe.sjp.ac.lk": "22/ENG/064",
  "en108932@foe.sjp.ac.lk": "22/ENG/065",
  "en108942@foe.sjp.ac.lk": "22/ENG/066",
  "en108974@foe.sjp.ac.lk": "22/ENG/067",
  "en108915@foe.sjp.ac.lk": "22/ENG/068",
  "en108928@foe.sjp.ac.lk": "22/ENG/069",
  "en108986@foe.sjp.ac.lk": "22/ENG/070",
  "en108951@foe.sjp.ac.lk": "22/ENG/071",
  "en108890@foe.sjp.ac.lk": "22/ENG/072",
  "en108983@foe.sjp.ac.lk": "22/ENG/073",
  "en109024@foe.sjp.ac.lk": "22/ENG/074",
  "en108936@foe.sjp.ac.lk": "22/ENG/075",
  "en108922@foe.sjp.ac.lk": "22/ENG/076",
  "en108950@foe.sjp.ac.lk": "22/ENG/077",
  "en109034@foe.sjp.ac.lk": "22/ENG/078",
  "en108953@foe.sjp.ac.lk": "22/ENG/079",
  "en108954@foe.sjp.ac.lk": "22/ENG/080",
  "en108927@foe.sjp.ac.lk": "22/ENG/081",
  "en108960@foe.sjp.ac.lk": "22/ENG/082",
  "en108956@foe.sjp.ac.lk": "22/ENG/083",
  "en108892@foe.sjp.ac.lk": "22/ENG/084",
  "en108894@foe.sjp.ac.lk": "22/ENG/085",
  "en109036@foe.sjp.ac.lk": "22/ENG/086",
  "en108920@foe.sjp.ac.lk": "22/ENG/087",
  "en108993@foe.sjp.ac.lk": "22/ENG/088",
  "en108980@foe.sjp.ac.lk": "22/ENG/089",
  "en108940@foe.sjp.ac.lk": "22/ENG/090",
  "en109041@foe.sjp.ac.lk": "22/ENG/091",
  "en108900@foe.sjp.ac.lk": "22/ENG/092",
  "en108973@foe.sjp.ac.lk": "22/ENG/093",
  "en108965@foe.sjp.ac.lk": "22/ENG/094",
  "en109016@foe.sjp.ac.lk": "22/ENG/095",
  "en108963@foe.sjp.ac.lk": "22/ENG/096",
  "en109009@foe.sjp.ac.lk": "22/ENG/097",
  "en109008@foe.sjp.ac.lk": "22/ENG/099",
  "en109051@foe.sjp.ac.lk": "22/ENG/100",
  "en109019@foe.sjp.ac.lk": "22/ENG/101",
  "en108938@foe.sjp.ac.lk": "22/ENG/102",
  "en109018@foe.sjp.ac.lk": "22/ENG/104",
  "en109022@foe.sjp.ac.lk": "22/ENG/105",
  "en108975@foe.sjp.ac.lk": "22/ENG/106",
  "en108977@foe.sjp.ac.lk": "22/ENG/107",
  "en109012@foe.sjp.ac.lk": "22/ENG/108",
  "en108968@foe.sjp.ac.lk": "22/ENG/109",
  "en109000@foe.sjp.ac.lk": "22/ENG/110",
  "en108937@foe.sjp.ac.lk": "22/ENG/111",
  "en109013@foe.sjp.ac.lk": "22/ENG/112",
  "en109027@foe.sjp.ac.lk": "22/ENG/113",
  "en109005@foe.sjp.ac.lk": "22/ENG/114",
  "en108898@foe.sjp.ac.lk": "22/ENG/116",
  "en109021@foe.sjp.ac.lk": "22/ENG/117",
  "en108911@foe.sjp.ac.lk": "22/ENG/118",
  "en109038@foe.sjp.ac.lk": "22/ENG/119",
  "en108981@foe.sjp.ac.lk": "22/ENG/120",
  "en108887@foe.sjp.ac.lk": "22/ENG/121",
  "en108959@foe.sjp.ac.lk": "22/ENG/122",
  "en109049@foe.sjp.ac.lk": "22/ENG/123",
  "en109045@foe.sjp.ac.lk": "22/ENG/124",
  "en108979@foe.sjp.ac.lk": "22/ENG/125",
  "en108992@foe.sjp.ac.lk": "22/ENG/126",
  "en108904@foe.sjp.ac.lk": "22/ENG/127",
  "en108882@foe.sjp.ac.lk": "22/ENG/128",
  "en108896@foe.sjp.ac.lk": "22/ENG/129",
  "en108966@foe.sjp.ac.lk": "22/ENG/130",
  "en108934@foe.sjp.ac.lk": "22/ENG/131",
  "en108957@foe.sjp.ac.lk": "22/ENG/132",
  "en108919@foe.sjp.ac.lk": "22/ENG/133",
  "en108935@foe.sjp.ac.lk": "22/ENG/134",
  "en108971@foe.sjp.ac.lk": "22/ENG/135",
  "en108997@foe.sjp.ac.lk": "22/ENG/136",
  "en109040@foe.sjp.ac.lk": "22/ENG/137",
  "en108914@foe.sjp.ac.lk": "22/ENG/138",
  "en108985@foe.sjp.ac.lk": "22/ENG/139",
  "en108999@foe.sjp.ac.lk": "22/ENG/141",
  "en108905@foe.sjp.ac.lk": "22/ENG/142",
  "en108939@foe.sjp.ac.lk": "22/ENG/143",
  "en108962@foe.sjp.ac.lk": "22/ENG/144",
  "en108955@foe.sjp.ac.lk": "22/ENG/145",
  "en109006@foe.sjp.ac.lk": "22/ENG/147",
  "en108943@foe.sjp.ac.lk": "22/ENG/148",
  "en109007@foe.sjp.ac.lk": "22/ENG/149",
  "en108958@foe.sjp.ac.lk": "22/ENG/150",
  "en108944@foe.sjp.ac.lk": "22/ENG/151",
  "en109031@foe.sjp.ac.lk": "22/ENG/152",
  "en108982@foe.sjp.ac.lk": "22/ENG/153",
  "en108984@foe.sjp.ac.lk": "22/ENG/154",
  "en109042@foe.sjp.ac.lk": "22/ENG/155",
  "en108988@foe.sjp.ac.lk": "22/ENG/156",
  "en108987@foe.sjp.ac.lk": "22/ENG/157",
  "en108964@foe.sjp.ac.lk": "22/ENG/158",
  "en109033@foe.sjp.ac.lk": "22/ENG/159",
  "en108990@foe.sjp.ac.lk": "22/ENG/161",
  "en108976@foe.sjp.ac.lk": "22/ENG/162",
  "en108996@foe.sjp.ac.lk": "22/ENG/163",
  "en108901@foe.sjp.ac.lk": "22/ENG/166",
  "en108947@foe.sjp.ac.lk": "22/ENG/167",
  "en109124@foe.sjp.ac.lk": "22/ENG/168",
  "en109122@foe.sjp.ac.lk": "22/ENG/169",
  "en109129@foe.sjp.ac.lk": "22/ENG/170",
  "en109132@foe.sjp.ac.lk": "22/ENG/171",
  "en109541@foe.sjp.ac.lk": "22/ENG/172",
  "en102756@foe.sjp.ac.lk": "21/ENG/040",
  "en102843@foe.sjp.ac.lk": "21/ENG/051",
  "en102729@foe.sjp.ac.lk": "21/ENG/062",
  "en102750@foe.sjp.ac.lk": "21/ENG/052",
  "en102786@foe.sjp.ac.lk": "21/ENG/104",
  "en102802@foe.sjp.ac.lk": "21/ENG/142",
  "en102780@foe.sjp.ac.lk": "21/ENG/146",
  "en102846@foe.sjp.ac.lk": "21/ENG/065",
  "en102823@foe.sjp.ac.lk": "21/ENG/137",
  "en102727@foe.sjp.ac.lk": "21/ENG/153",
};

async function syncIds() {
  console.log('Step 1: Fetching all auth users...');

  let allUsers = [];
  let page = 1;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) { console.error('Error fetching users:', error.message); break; }
    allUsers = allUsers.concat(data.users);
    if (data.users.length < 200) break;
    page++;
  }

  const foeUsers = allUsers.filter(u => u.email && u.email.endsWith('@foe.sjp.ac.lk'));
  console.log(`Found ${foeUsers.length} FOE student accounts in auth`);

  console.log('Step 2: Updating students table IDs...');
  let ok = 0, skip = 0;

  for (const user of foeUsers) {
    const reg = emailToReg[user.email];
    if (!reg) { console.log(`  SKIP: no reg_number for ${user.email}`); skip++; continue; }

    const { error } = await supabase
      .from('students')
      .update({ id: user.id })
      .eq('reg_number', reg);

    if (error) {
      console.error(`  FAIL ${reg}: ${error.message}`);
    } else {
      console.log(`  OK   ${reg}  =>  ${user.id}`);
      ok++;
    }
  }

  console.log(`\nStep 2 done: ${ok} updated, ${skip} skipped`);
  console.log('\nStep 3: Fixing enrollments and results foreign keys...');

  // Fix enrollments - update student_id to match new students.id via email join
  const { error: e1 } = await supabase.rpc('exec_sql', {
    sql: `UPDATE public.enrollments e
          SET student_id = s.id
          FROM public.students s
          INNER JOIN auth.users a ON a.id = s.id
          WHERE e.student_id != s.id
            AND a.email LIKE 'en%@foe.sjp.ac.lk'`
  });

  if (e1) {
    console.log('  RPC not available - please run fix_fk_after_sync.sql manually in SQL Editor');
  } else {
    console.log('  Enrollments fixed');
  }

  console.log('\nAll done! Now run fix_fk_after_sync.sql in Supabase SQL Editor to fix enrollments and results.');
  console.log('Then try logging in with en108953@foe.sjp.ac.lk / pes@123');
}

syncIds();
