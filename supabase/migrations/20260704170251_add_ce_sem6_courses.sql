-- add_ce_sem6_courses
-- Applied 20260704170251
-- Exported from the live project; do not edit by hand.


INSERT INTO courses (course_code, title, credits, department, semester, year, category, contributes_to_gpa)
VALUES
('CE3306','Design of Concrete Structures I',3,'Civil Engineering',6,3,'Compulsory',true),
('CE3207','Hydraulic Design',2,'Civil Engineering',6,3,'Compulsory',true),
('CE3308','Geotechnical Engineering',3,'Civil Engineering',6,3,'Compulsory',true),
('CE3209','Construction Management',2,'Civil Engineering',6,3,'Compulsory',true),
('CE3252','Design of Masonry Structures',2,'Civil Engineering',6,3,'Elective',true),
('IS3263','Industrial Law',2,'Civil Engineering',6,3,'Compulsory',true),
('IS3151','Technical Writing',1,'Civil Engineering',6,3,'Compulsory',true)
ON CONFLICT (course_code) DO NOTHING;
