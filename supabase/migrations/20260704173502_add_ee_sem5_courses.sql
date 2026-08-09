-- add_ee_sem5_courses
-- Applied 20260704173502
-- Exported from the live project; do not edit by hand.


INSERT INTO courses (course_code, title, credits, department, semester, year, category, contributes_to_gpa)
VALUES
('EE3201','Signal Processing',2,'Electrical and Electronic Engineering',5,3,'Compulsory',true),
('EE3202','Machines and Drives II',2,'Electrical and Electronic Engineering',5,3,'Compulsory',true),
('EE3151','Introduction to Biomedical Engineering',1,'Electrical and Electronic Engineering',5,3,'Elective',true),
('EE3252','Anatomy and Control Systems of the Human Body I',2,'Electrical and Electronic Engineering',5,3,'Elective',true),
('EE3253','Introduction to Image Processing',2,'Electrical and Electronic Engineering',5,3,'Elective',true),
('EE3361','Communication II',3,'Electrical and Electronic Engineering',5,3,'Elective',true),
('EE3262','Data Communication',2,'Electrical and Electronic Engineering',5,3,'Elective',true),
('IS3201','Algorithms and Optimization Methods',2,'Electrical and Electronic Engineering',5,3,'Elective',true)
ON CONFLICT (course_code) DO NOTHING;
