-- add_me_sem5_courses
-- Applied 20260704091521
-- Exported from the live project; do not edit by hand.


INSERT INTO courses (course_code, title, credits, department, semester, year, category, contributes_to_gpa)
VALUES
('ME3201','Strength of Materials II',2,'Mechanical Engineering',5,3,'Compulsory',true),
('ME3202','Fluid Machinery',2,'Mechanical Engineering',5,3,'Compulsory',true),
('ME3203','Dynamics of Mechanical Systems',2,'Mechanical Engineering',5,3,'Compulsory',true),
('ME3250','Manufacturing Systems',2,'Mechanical Engineering',5,3,'Elective',true),
('ME3351','Production and Operations Management',3,'Mechanical Engineering',5,3,'Elective',true),
('ME3354','Robotics and Vision Systems',3,'Mechanical Engineering',5,3,'Elective',true),
('ME3255','Microcontrollers and Microprocessor Based Systems',2,'Mechanical Engineering',5,3,'Elective',true),
('IS3203','Newtonian Mechanics and Lagrangian Dynamics',2,'Mechanical Engineering',5,3,'Elective',true)
ON CONFLICT (course_code) DO NOTHING;
