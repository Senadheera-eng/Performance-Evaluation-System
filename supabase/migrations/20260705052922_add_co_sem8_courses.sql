-- add_co_sem8_courses
-- Applied 20260705052922
-- Exported from the live project; do not edit by hand.


INSERT INTO courses (course_code, title, credits, department, semester, year, category, minor_category, contributes_to_gpa)
VALUES
('CO4002','Engineering Project',6,'Computer Engineering',8,4,'Compulsory',NULL,true),
('CO4205','Compilers',2,'Computer Engineering',8,4,'Compulsory',NULL,true),
('CO4306','Software Architecture and Design',3,'Computer Engineering',8,4,'Compulsory',NULL,true),
('CO4353','Distributed Systems',3,'Computer Engineering',8,4,'Elective',NULL,true),
('CO4254','Machine Learning',2,'Computer Engineering',8,4,'Elective','Data Management',true),
('CO4255','Bioinformatics',2,'Computer Engineering',8,4,'Elective',NULL,true),
('CO4256','Mobile Application Development',2,'Computer Engineering',8,4,'Elective',NULL,true),
('CO4263','Scientific Computing',2,'Computer Engineering',8,4,'Elective',NULL,true),
('IS4171','Ethics in Engineering',1,'Computer Engineering',8,4,'Compulsory',NULL,true),
('IS3175','Introduction to Philosophy',1,'Computer Engineering',8,4,'Elective',NULL,false)
ON CONFLICT (course_code, department, semester) DO NOTHING;

SELECT course_code, title, credits, semester, category, minor_category FROM courses
WHERE department='Computer Engineering' AND semester IN (7,8) ORDER BY semester, course_code;
