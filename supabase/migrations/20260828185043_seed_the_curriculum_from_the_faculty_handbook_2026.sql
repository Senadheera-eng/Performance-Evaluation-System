-- seed_the_curriculum_from_the_faculty_handbook_2026
-- Applied 20260828185043
-- Exported from the live project; do not edit by hand.

-- The Faculty Handbook 2026 curriculum, as data.
--
-- Read out of the handbook's own semester tables. The rule for reading them:
-- a category cell is merged across the rows it covers, so it appears once and
-- opens a group at the course it is attached to, running until the next cell.
-- Getting that backwards puts Advanced Algorithms under Compulsory.
--
-- Grouped by basket here rather than listed row by row, which is both shorter
-- and easier to check against the printed table: 'O',7,'Elective (3)' really
-- is CO4351, CO4352, CO4361, CO4362.
--
-- Department letters: X common (semesters 1-2), C Civil, O Computer,
-- E Electrical and Electronic, M Mechanical. The GPA flag is the handbook's
-- own "Contributing to GPA" column, kept for cross-checking the catalogue.

-- Twenty-three courses the handbook prints that the catalogue never had.
-- Without them a student cannot be offered a course their own curriculum
-- requires. IS3173/IS3174 are printed as one row, "Sinhala/Tamil"; they are
-- two courses and are named as such.
insert into public.courses (course_code, title, credits, semester, year, department,
                            category, contributes_to_gpa, ca_weight, ese_weight)
select v.code, v.title, v.credits, v.semester, v.year, v.department, v.category,
       v.gpa, 0.300, 0.700
from (values
 ('CE3110','Surveying Field Project',1,6,3,'Civil Engineering','Compulsory',false),
 ('CE3271','Traffic Engineering',2,5,3,'Civil Engineering','Elective',true),
 ('CE3272','Rail Transport Systems',2,6,3,'Civil Engineering','Elective',false),
 ('CE3600','Industrial Training',6,6,3,'Civil Engineering','Compulsory',false),
 ('CO3252','Management Information Systems',2,5,3,'Computer Engineering','Elective',true),
 ('CO3262','Advanced Computer Architecture',2,5,3,'Computer Engineering','Elective',true),
 ('CO3600','Industrial Training',6,6,3,'Computer Engineering','Compulsory',false),
 ('EE3600','Industrial Training',6,6,3,'Electrical and Electronic Engineering','Compulsory',false),
 ('IS3172','Ethnic Cohesion and Social Harmony',1,5,3,'Interdisciplinary Studies','Elective',false),
 ('IS3173','Sinhala',1,5,3,'Interdisciplinary Studies','Elective',false),
 ('IS3174','Tamil',1,5,3,'Interdisciplinary Studies','Elective',false),
 ('IS3176','Scientific Method',1,6,3,'Interdisciplinary Studies','Elective',false),
 ('IS3177','Introduction to Psychology and Human Behaviour',1,6,3,'Interdisciplinary Studies','Elective',false),
 ('IS3204','Mathematical Modelling and Simulation',2,5,3,'Interdisciplinary Studies','Optional',true),
 ('IS3205','Operations Research',2,6,3,'Interdisciplinary Studies','Optional',false),
 ('IS3206','Advanced Probability and Statistical Analysis',2,6,3,'Interdisciplinary Studies','Optional',false),
 ('IS3207','Time Series and Stochastic Processes',2,6,3,'Interdisciplinary Studies','Optional',false),
 ('IS3208','Linear Models and Multivariate Statistics',2,6,3,'Interdisciplinary Studies','Optional',false),
 ('ME3253','Piped Services',2,5,3,'Mechanical Engineering','Elective',true),
 ('ME3258','Electrical Installation, Distribution and Lighting',2,6,3,'Mechanical Engineering','Elective',true),
 ('ME3352','HVAC System',3,5,3,'Mechanical Engineering','Elective',true),
 ('ME3359','Group Project (Building Services)',3,6,3,'Mechanical Engineering','Elective',true),
 ('ME3600','Industrial Training',6,6,3,'Mechanical Engineering','Compulsory',false)
) as v(code, title, credits, semester, year, department, category, gpa)
where not exists (select 1 from public.courses c where c.course_code = v.code);

with raw(d, sem, basket, gpa, codes) as (values
('X',1,'Compulsory','t','CE1201,CO1201,EE1201,ME1301,ME1202,IS1301,IS1281'),
 ('X',1,'Compulsory','f','IS1151,IS1171'),
 ('X',2,'Compulsory','t','CE1202,CO1302,EE1302,ME1303,ME1304,IS1302'),
 ('X',2,'Optional','f','IS1152'),
 ('C',3,'Compulsory','t','CE2301,CE2302,CE2203,CE2304,IS2301,IS2202,IS2261'),
 ('C',4,'Compulsory','t','CE2305,CE2306,CE2307,CE2208,CE2209,CE2210,CE2211,IS2303,IS2262'),
 ('C',5,'Compulsory','t','CE3301,CE3202,CE3203,CE3204,CE3205'),
 ('C',5,'Elective (2)','t','CE3251,CE3271'),
 ('C',5,'Compulsory','f','IS3261,IS3162'),
 ('C',5,'Elective (1)','f','IS3171,IS3172,IS3173,IS3174'),
 ('C',6,'Compulsory','t','CE3306,CE3207,CE3308,CE3209,IS3263,IS3151'),
 ('C',6,'Compulsory','f','CE3110,CE3600'),
 ('C',6,'Elective (2)','f','CE3252,CE3272'),
 ('C',6,'Elective (1)','f','IS3175,IS3176,IS3177'),
 ('C',7,'Compulsory','t','CE4301,CE4202,CE4603,CE4404'),
 ('C',7,'Elective (6)','t','CE4351,CE4352,CE4361,CE4362,CE4371,CE4372'),
 ('C',7,'Optional','t','CE4305,CE4306'),
 ('C',7,'Elective (1)','f','IS3171,IS3172,IS3173,IS3174'),
 ('C',8,'Compulsory','t','CE4603,CE4404,IS4171'),
 ('C',8,'Elective (10)','t','CE4353,CE4254,CE4355,CE4361,CE4363,CE4365,CE4371,CE4373,CE4264,CE4374,CE4256'),
 ('C',8,'Optional','t','CE4305,CE4306'),
 ('C',8,'Elective (1)','f','IS3175,IS3176,IS3177'),
 ('O',3,'Compulsory','t','CO2201,CO2202,CO2203,CO2204,CO2105,EE2206,IS2301,IS2202,IS2261'),
 ('O',4,'Compulsory','t','CO2206,CO2307,CO2208,CO2209,CO2210,ME2208,IS2303,IS2262'),
 ('O',5,'Compulsory','t','CO3201,CO3302,IS3202,IS3261'),
 ('O',5,'Elective (7)','t','CO3203,CO3251,CO3252,CO3353,CO3261,CO3262'),
 ('O',5,'Optional','t','IS3201,IS3204'),
 ('O',5,'Compulsory','f','IS3162'),
 ('O',5,'Elective (1)','f','IS3171,IS3172,IS3173,IS3174'),
 ('O',6,'Compulsory','t','CO3204,CO3205,IS3151,IS3263,IS3264'),
 ('O',6,'Elective (3)','t','CO3554,CO3563'),
 ('O',6,'Elective (6)','t','CO3255,CO3256,CO3264,CO3265'),
 ('O',6,'Optional','f','IS3205,IS3206,IS3207,IS3208'),
 ('O',6,'Elective (0/1)','f','IS3175,IS3176,IS3177'),
 ('O',6,'Compulsory','f','CO3600'),
 ('O',7,'Compulsory','t','CO4301,CO4002,CO4203,CO4204,IS4161'),
 ('O',7,'Elective (2)','t','CO3554,CO3563'),
 ('O',7,'Elective (3)','t','CO4351,CO4352,CO4361,CO4362'),
 ('O',7,'Elective (1)','f','IS3171,IS3172,IS3173,IS3174'),
 ('O',8,'Compulsory','t','CO4002,CO4205,CO4306,IS4171'),
 ('O',8,'Elective (5)','t','CO4353,CO4254,CO4255,CO4256,CO4263'),
 ('O',8,'Elective (1/0)','f','IS3175,IS3176,IS3177'),
 ('E',3,'Compulsory','t','EE2201,EE2203,EE2305,EE2206,CO2202,IS2301,IS2202,IS2261'),
 ('E',3,'Optional','f','CO2203'),
 ('E',4,'Compulsory','t','EE2202,EE2204,EE2207,EE2208,EE2309,ME2208,IS2303,IS2262'),
 ('E',5,'Compulsory','t','EE3201,EE3202'),
 ('E',5,'Elective (8/7)','t','EE3151,EE3252,EE3253,EE3361,EE3262'),
 ('E',5,'Optional','f','CO3201'),
 ('E',5,'Elective (2)','t','IS3201,IS3202,IS3203,IS3204'),
 ('E',5,'Compulsory','f','IS3261,IS3162'),
 ('E',5,'Elective (1)','f','IS3171,IS3172,IS3173,IS3174'),
 ('E',6,'Compulsory','t','EE3203,EE3204,EE3205,IS3263,IS3264,IS3151'),
 ('E',6,'Elective (7/8)','t','EE3354,EE3255,EE3363,EE3264'),
 ('E',6,'Optional','t','IS3205,IS3206,IS3207,IS3208'),
 ('E',6,'Elective (0/1)','f','IS3175,IS3176,IS3177'),
 ('E',6,'Compulsory','f','EE3600'),
 ('E',7,'Compulsory','t','EE4301,EE4002,EE4303,EE4204,IS4161'),
 ('E',7,'Elective (5)','t','EE4205,EE4351,EE4252,EE4253,EE4361,EE4262'),
 ('E',7,'Elective (1)','f','IS3171,IS3172,IS3173,IS3174'),
 ('E',8,'Compulsory','t','EE4002,IS4171'),
 ('E',8,'Elective (3)','t','EE4308,EE4354'),
 ('E',8,'Elective (6)','t','EE4206,EE4207,EE4255,EE4256,EE4263,EE4209,EE4264'),
 ('E',8,'Elective (1/0)','f','IS3175,IS3176,IS3177'),
 ('M',3,'Compulsory','t','ME2301,ME2302,ME2303,ME2104,EE2191,IS2301,IS2202,IS2261'),
 ('M',4,'Compulsory','t','ME2305,ME2206,ME2307,ME2208,ME2209,IS2303,IS2262'),
 ('M',5,'Compulsory','t','ME3201,ME3202,ME3203,ME3205,IS3261'),
 ('M',5,'Elective (5)','t','ME3250,ME3351,ME3352,ME3253,ME3354,ME3255'),
 ('M',5,'Elective (2)','t','IS3201,IS3202,IS3203,IS3204'),
 ('M',5,'Compulsory','f','IS3162'),
 ('M',5,'Elective (1)','f','IS3171,IS3172,IS3173'),
 ('M',6,'Compulsory','n','ME3806'),
 ('M',6,'Compulsory','t','ME3207,IS3263,IS3151,IS3264'),
 ('M',6,'Elective (5)','t','ME3256,ME3357,ME3258,ME3359,ME3260,ME3361'),
 ('M',6,'Optional','t','IS3205,IS3206,IS3207,IS3208'),
 ('M',6,'Elective (1)','f','IS3175,IS3176,IS3177'),
 ('M',6,'Compulsory','f','ME3600'),
 ('M',7,'Compulsory','t','ME4001,ME4102,ME4404,ME4103,IS4161'),
 ('M',7,'Elective (5)','t','ME4262,ME4363,ME4364,ME4265,ME4366,ME4267'),
 ('M',7,'Elective (1)','f','IS3171,IS3172,IS3173,IS3174'),
 ('M',8,'Compulsory','t','ME4001,ME4205,ME4106,IS4171'),
 ('M',8,'Elective (5)','t','ME4369,ME4270,ME4271,ME4372,ME4373,ME4274'),
 ('M',8,'Elective (1)','f','IS3175,IS3176,IS3177')
), flat as (
  select case r.d when 'X' then 'COMMON' when 'C' then 'Civil Engineering'
                  when 'O' then 'Computer Engineering'
                  when 'E' then 'Electrical and Electronic Engineering'
                  else 'Mechanical Engineering' end as department,
         r.sem as semester,
         trim(code) as course_code,
         r.basket,
         case r.gpa when 't' then true when 'f' then false end as gpa
    from raw r, unnest(string_to_array(r.codes, ',')) as code
)
insert into public.curriculum_slots
  (department, semester, course_id, basket, required_credits, handbook_gpa)
select f.department, f.semester, coalesce(exact.id, any_sem.id), f.basket,
       (regexp_match(f.basket, '\((\d+)'))[1]::int, f.gpa
  from flat f
  -- Prefer the catalogue row for that semester; a course the handbook lists in
  -- two semesters exists once, so fall back to the code.
  left join lateral (select c.id from public.courses c
                      where c.course_code = f.course_code
                        and c.semester = f.semester limit 1) exact on true
  left join lateral (select c.id from public.courses c
                      where c.course_code = f.course_code
                      order by c.semester limit 1) any_sem on true
 where coalesce(exact.id, any_sem.id) is not null
on conflict (department, semester, course_id) do update
  set basket = excluded.basket,
      required_credits = excluded.required_credits,
      handbook_gpa = excluded.handbook_gpa;

-- What a minor costs. The handbook names the minors on offer but does not
-- print a credit total -- it says only that a student claims one "after
-- successfully completing an approved combination of Courses", made known to
-- them in advance. Five is a placeholder the department can change; it is not
-- a figure taken from the handbook.
insert into public.minor_requirements (department, minor, required_credits)
select department, minor_category, 5
  from public.courses where minor_category is not null
 group by department, minor_category
on conflict (department, minor) do nothing;
