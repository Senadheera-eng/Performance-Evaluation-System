-- add_me_sem6_courses
-- Applied 20260704171114
-- Exported from the live project; do not edit by hand.


INSERT INTO courses (course_code, title, credits, department, semester, year, category, contributes_to_gpa)
VALUES
('ME3205','Automobile Technology',2,'Mechanical Engineering',6,3,'Compulsory',true),
('ME3806','Mechanical Engineering Design',8,'Mechanical Engineering',6,3,'Compulsory',true),
('ME3207','Applied Thermodynamics II',2,'Mechanical Engineering',6,3,'Compulsory',true),
('ME3256','Product-Process Design',2,'Mechanical Engineering',6,3,'Elective',true),
('ME3357','Group Project (Manufacturing)',3,'Mechanical Engineering',6,3,'Elective',true),
('ME3260','Advanced Automation',2,'Mechanical Engineering',6,3,'Elective',true),
('ME3361','Mechatronics Project',3,'Mechanical Engineering',6,3,'Elective',true),
('ME3106','Elective Course (ME3106)',1,'Mechanical Engineering',6,3,'Elective',false)
ON CONFLICT (course_code) DO NOTHING;
