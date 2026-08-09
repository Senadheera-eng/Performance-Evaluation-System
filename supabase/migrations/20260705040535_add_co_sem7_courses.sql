-- add_co_sem7_courses
-- Applied 20260705040535
-- Exported from the live project; do not edit by hand.


INSERT INTO courses (course_code, title, credits, department, semester, year, category, minor_category, contributes_to_gpa)
VALUES
('CO4301','Individual Research/Design Project',3,'Computer Engineering',7,4,'Compulsory',NULL,true),
('CO4002','Engineering Project',4,'Computer Engineering',7,4,'Compulsory',NULL,true),
('CO4203','Micro Controllers and Applications',2,'Computer Engineering',7,4,'Compulsory',NULL,true),
('CO4204','Computer Vision and Image Processing',2,'Computer Engineering',7,4,'Compulsory',NULL,true),
('CO3554','Data Management Project',2,'Computer Engineering',7,4,'Elective','Data Management',true),
('CO3563','High Performance Computing Project',2,'Computer Engineering',7,4,'Elective','High-Performance Computing',true),
('CO4351','Advanced Database Systems',3,'Computer Engineering',7,4,'Elective','Data Management',true),
('CO4352','Advanced Algorithms',3,'Computer Engineering',7,4,'Elective',NULL,true),
('CO4361','Concurrent Processing',3,'Computer Engineering',7,4,'Elective','High-Performance Computing',true),
('CO4362','GPU Programming',3,'Computer Engineering',7,4,'Elective','High-Performance Computing',true),
('IS4161','Sustainability and Disaster Management',1,'Computer Engineering',7,4,'Compulsory',NULL,true)
ON CONFLICT (course_code) DO NOTHING;
