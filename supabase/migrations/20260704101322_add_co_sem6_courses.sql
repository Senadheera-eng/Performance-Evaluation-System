-- add_co_sem6_courses
-- Applied 20260704101322
-- Exported from the live project; do not edit by hand.


INSERT INTO courses (course_code, title, credits, department, semester, year, category, contributes_to_gpa)
VALUES
('CO3204','Robotic Design',2,'Computer Engineering',6,3,'Compulsory',true),
('CO3205','Intelligent Systems',2,'Computer Engineering',6,3,'Compulsory',true),
('CO3255','Information Security',2,'Computer Engineering',6,3,'Elective',true),
('CO3256','Quality Engineering',2,'Computer Engineering',6,3,'Elective',true),
('CO3264','Advanced Operating Systems',2,'Computer Engineering',6,3,'Elective',true),
('CO3265','Parallel Programming',2,'Computer Engineering',6,3,'Elective',true),
('IS3264','Management for Engineers',2,'Computer Engineering',6,3,'Compulsory',true),
('IS3263','Industrial Law',2,'Computer Engineering',6,3,'Compulsory',true),
('IS3151','Technical Writing',1,'Computer Engineering',6,3,'Compulsory',true),
('IS3175','Introduction to Philosophy',1,'Computer Engineering',6,3,'Elective',false)
ON CONFLICT (course_code) DO NOTHING;
