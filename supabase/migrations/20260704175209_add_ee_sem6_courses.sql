-- add_ee_sem6_courses
-- Applied 20260704175209
-- Exported from the live project; do not edit by hand.


INSERT INTO courses (course_code, title, credits, department, semester, year, category, contributes_to_gpa)
VALUES
('EE3203','Electromagnetics',2,'Electrical and Electronic Engineering',6,3,'Compulsory',true),
('EE3204','Industrial Automation and System Design',2,'Electrical and Electronic Engineering',6,3,'Compulsory',true),
('EE3205','Digital System Design',2,'Electrical and Electronic Engineering',6,3,'Compulsory',true),
('EE3354','Machine Learning',3,'Electrical and Electronic Engineering',6,3,'Elective',true),
('EE3255','Anatomy and Control Systems of the Human Body II',2,'Electrical and Electronic Engineering',6,3,'Elective',true),
('EE3363','Next Generation Networks',3,'Electrical and Electronic Engineering',6,3,'Elective',true),
('EE3264','Digital Communication',2,'Electrical and Electronic Engineering',6,3,'Elective',true)
ON CONFLICT (course_code) DO NOTHING;
