-- replace_question_bank_with_faculty_course_feedback_form
-- Applied 20260809073905
-- Exported from the live project; do not edit by hand.

-- Replace the placeholder question bank with the faculty's actual form.
--
-- The bank shipped with fourteen invented questions ("The course content was
-- clearly organised") that exist in no faculty document. The department runs a
-- real form — the CO Course Feedback portal — and this is that form, question
-- for question: eight sections, thirty-seven questions, the same wording, the
-- same options, the same order.
--
-- The four periods built on the old bank were test rows (one student, two
-- submissions, twenty answers) and go with it. Nothing here belongs to a real
-- feedback round.

delete from public.feedback_answers;
delete from public.feedback_submissions;
delete from public.feedback_releases;
delete from public.feedback_period_questions;
delete from public.feedback_period_courses;
delete from public.feedback_periods;
delete from public.feedback_questions;

-- The author of record is the faculty, not one admin, so created_by is left
-- null; the column is nullable and only ever used to let an author edit their
-- own question.
alter table public.feedback_questions alter column created_by drop not null;

insert into public.feedback_questions (
  question_text, question_type, target_type, options, placeholder,
  section_key, section_title, section_description, section_icon, section_order,
  is_required, display_order, category
) values

-- ── 1. Course Content ────────────────────────────────────────────────
('The course improved my knowledge in the field','rating','course',null,null,
 'course_content','Course Content','Rate all statements below','📑',1,true,101,'Course Content'),
('The course content was relevant and interesting','rating','course',null,null,
 'course_content','Course Content','Rate all statements below','📑',1,true,102,'Course Content'),
('The course content was clear and understandable','rating','course',null,null,
 'course_content','Course Content','Rate all statements below','📑',1,true,103,'Course Content'),
('The workload of the course was reasonable','rating','course',null,null,
 'course_content','Course Content','Rate all statements below','📑',1,true,104,'Course Content'),
('Additional topics/areas to be included (if any)','long_text','course',null,
 'Suggest any topics you feel should be added…',
 'course_content','Course Content','Rate all statements below','📑',1,false,105,'Course Content'),
('Existing topics/areas that should be excluded (if any)','long_text','course',null,
 'Suggest any topics you feel should be removed…',
 'course_content','Course Content','Rate all statements below','📑',1,false,106,'Course Content'),

-- ── 2. Learning Resources ────────────────────────────────────────────
('Lecture notes were provided and were clear and useful','rating','course',null,null,
 'learning_resources','Learning Resources','Rate all statements below','📒',2,true,201,'Learning Resources'),
('Recommended references supported my learning','rating','course',null,null,
 'learning_resources','Learning Resources','Rate all statements below','📒',2,true,202,'Learning Resources'),
('Lecture video recordings were available and supported my understanding of the content','rating','course',null,null,
 'learning_resources','Learning Resources','Rate all statements below','📒',2,true,203,'Learning Resources'),
('Learning materials were made available in a timely manner','rating','course',null,null,
 'learning_resources','Learning Resources','Rate all statements below','📒',2,true,204,'Learning Resources'),
('Learning resources were easily accessible through the LMS or other platforms','rating','course',null,null,
 'learning_resources','Learning Resources','Rate all statements below','📒',2,true,205,'Learning Resources'),

-- ── 3. Delivery Mode ─────────────────────────────────────────────────
('What was the primary delivery mode used for this course?','single_choice','course',
 '[{"value":"fully_physical","label":"Fully Physical"},
   {"value":"mostly_physical","label":"Mostly Physical"},
   {"value":"hybrid","label":"Hybrid (Both online and physical)"},
   {"value":"mostly_online","label":"Mostly Online"},
   {"value":"fully_online","label":"Fully Online"}]'::jsonb, null,
 'delivery_mode','Delivery Mode',null,'💻',3,true,301,'Delivery Mode'),
('What is your preferred delivery mode for this course?','single_choice','course',
 '[{"value":"fully_physical","label":"Fully Physical"},
   {"value":"mostly_physical","label":"Mostly Physical"},
   {"value":"hybrid","label":"Hybrid (Both online and physical)"},
   {"value":"mostly_online","label":"Mostly Online"},
   {"value":"fully_online","label":"Fully Online"}]'::jsonb, null,
 'delivery_mode','Delivery Mode',null,'💻',3,true,302,'Delivery Mode'),
('How effective was the delivery mode used in supporting your learning?','single_choice','course',
 '[{"value":"very_effective","label":"Very Effective"},
   {"value":"effective","label":"Effective"},
   {"value":"neutral","label":"Neutral"},
   {"value":"ineffective","label":"Ineffective"},
   {"value":"very_ineffective","label":"Very Ineffective"}]'::jsonb, null,
 'delivery_mode','Delivery Mode',null,'💻',3,true,303,'Delivery Mode'),

-- ── 4. Continuous Assessments ────────────────────────────────────────
('Did you have Assignments / Projects?','yes_no','course',null,null,
 'continuous_assessments','Continuous Assessments','Assignments, projects and lab work','📝',4,true,401,'Continuous Assessments'),
('Did you have Practical / Lab Classes?','yes_no','course',null,null,
 'continuous_assessments','Continuous Assessments','Assignments, projects and lab work','📝',4,true,402,'Continuous Assessments'),

-- ── 5. Field Visits ──────────────────────────────────────────────────
('Did you have Field Visits?','yes_no','course',null,null,
 'field_visits','Field Visits','Only fill if your course included field visits','🏭',5,true,501,'Field Visits'),

-- ── 6. Feedback on Lecturers — asked once per assigned lecturer ──────
('Lecturer seemed well prepared','rating','lecturer',null,null,
 'lecturers','Feedback on Lecturers','Rate each lecturer','👨‍🏫',6,true,601,'Feedback on Lecturers'),
('Showed good knowledge of the subject matter','rating','lecturer',null,null,
 'lecturers','Feedback on Lecturers','Rate each lecturer','👨‍🏫',6,true,602,'Feedback on Lecturers'),
('Explained the Learning Outcomes at the beginning','rating','lecturer',null,null,
 'lecturers','Feedback on Lecturers','Rate each lecturer','👨‍🏫',6,true,603,'Feedback on Lecturers'),
('Explained the content at the beginning','rating','lecturer',null,null,
 'lecturers','Feedback on Lecturers','Rate each lecturer','👨‍🏫',6,true,604,'Feedback on Lecturers'),
('Explained concepts with clarity','rating','lecturer',null,null,
 'lecturers','Feedback on Lecturers','Rate each lecturer','👨‍🏫',6,true,605,'Feedback on Lecturers'),
('Used simple language and short sentences','rating','lecturer',null,null,
 'lecturers','Feedback on Lecturers','Rate each lecturer','👨‍🏫',6,true,606,'Feedback on Lecturers'),
('Related new concepts to what we already know','rating','lecturer',null,null,
 'lecturers','Feedback on Lecturers','Rate each lecturer','👨‍🏫',6,true,607,'Feedback on Lecturers'),
('Related concepts to practical applications','rating','lecturer',null,null,
 'lecturers','Feedback on Lecturers','Rate each lecturer','👨‍🏫',6,true,608,'Feedback on Lecturers'),
('Speech was clear and audible','rating','lecturer',null,null,
 'lecturers','Feedback on Lecturers','Rate each lecturer','👨‍🏫',6,true,609,'Feedback on Lecturers'),
('Used voice and gesture effectively','rating','lecturer',null,null,
 'lecturers','Feedback on Lecturers','Rate each lecturer','👨‍🏫',6,true,610,'Feedback on Lecturers'),
('Used audio-visual equipment effectively (if applicable)','rating','lecturer',null,null,
 'lecturers','Feedback on Lecturers','Rate each lecturer','👨‍🏫',6,true,611,'Feedback on Lecturers'),
('Encouraged students to ask questions','rating','lecturer',null,null,
 'lecturers','Feedback on Lecturers','Rate each lecturer','👨‍🏫',6,true,612,'Feedback on Lecturers'),
('Conducted the lecture at a pace that I can follow comfortably','rating','lecturer',null,null,
 'lecturers','Feedback on Lecturers','Rate each lecturer','👨‍🏫',6,true,613,'Feedback on Lecturers'),
('Summarized major points at the end','rating','lecturer',null,null,
 'lecturers','Feedback on Lecturers','Rate each lecturer','👨‍🏫',6,true,614,'Feedback on Lecturers'),
('Lecturer''s overall teaching method/approach is good','rating','lecturer',null,null,
 'lecturers','Feedback on Lecturers','Rate each lecturer','👨‍🏫',6,true,615,'Feedback on Lecturers'),
('What do you like most about this lecturer''s teaching?','long_text','lecturer',null,
 'Share what stood out…',
 'lecturers','Feedback on Lecturers','Rate each lecturer','👨‍🏫',6,true,616,'Feedback on Lecturers'),
('Suggestions to improve delivery','long_text','lecturer',null,
 'Constructive suggestions…',
 'lecturers','Feedback on Lecturers','Rate each lecturer','👨‍🏫',6,true,617,'Feedback on Lecturers'),

-- ── 7. Teaching Approach ─────────────────────────────────────────────
('Which teaching approach was primarily used by the lecturer?','single_choice','course',
 '[{"value":"teacher_centered","label":"Teacher-centered (lecture-driven)"},
   {"value":"student_centered","label":"Student-centered (interactive/discussion-based)"},
   {"value":"problem_based","label":"Problem-based learning"},
   {"value":"flipped","label":"Flipped classroom"},
   {"value":"mixed","label":"Mixed approach (combination of the above)"}]'::jsonb, null,
 'teaching_approach','Teaching Approach',null,'🎯',7,true,701,'Teaching Approach'),
('Which teaching approach do you prefer for this course?','single_choice','course',
 '[{"value":"teacher_centered","label":"Teacher-centered (lecture-driven)"},
   {"value":"student_centered","label":"Student-centered (interactive/discussion-based)"},
   {"value":"problem_based","label":"Problem-based learning"},
   {"value":"flipped","label":"Flipped classroom"},
   {"value":"mixed","label":"Mixed approach (combination of the above)"}]'::jsonb, null,
 'teaching_approach','Teaching Approach',null,'🎯',7,true,702,'Teaching Approach'),

-- ── 8. Other Comments ────────────────────────────────────────────────
('Any other comments on this course','long_text','course',null,
 'Share any overall thoughts or suggestions…',
 'other_comments','Other Comments','Any additional feedback on the overall course','💬',8,false,801,'Other Comments');
