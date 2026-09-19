-- migrate_admin_rows_to_admins_table
-- Applied 20260720053859
-- Exported from the live project; do not edit by hand.

-- Move the existing Super Admin out of students, into admins.
INSERT INTO admins (id, name, email, role, department, status)
SELECT id, name, email, 'super_admin', NULL, 'active'
FROM students WHERE email = 'admin@sjp.ac.lk';

DELETE FROM students WHERE email = 'admin@sjp.ac.lk';

-- students.role now only ever holds 'student' — no admin rows live here anymore.
ALTER TABLE students DROP CONSTRAINT students_role_check;
ALTER TABLE students ADD CONSTRAINT students_role_check CHECK (role = 'student');

-- The 5 department admin logins the user already created via the Supabase
-- Dashboard (email matched — passwords never pass through here).
INSERT INTO admins (id, name, email, role, department, status)
SELECT id, 'Computer Engineering Admin', email, 'dept_admin', 'Computer Engineering', 'active'
FROM auth.users WHERE email = 'admin.computer@sjp.ac.lk';

INSERT INTO admins (id, name, email, role, department, status)
SELECT id, 'Civil Engineering Admin', email, 'dept_admin', 'Civil Engineering', 'active'
FROM auth.users WHERE email = 'admin.civil@sjp.ac.lk';

INSERT INTO admins (id, name, email, role, department, status)
SELECT id, 'Electrical and Electronic Engineering Admin', email, 'dept_admin', 'Electrical and Electronic Engineering', 'active'
FROM auth.users WHERE email = 'admin.eee@sjp.ac.lk';

INSERT INTO admins (id, name, email, role, department, status)
SELECT id, 'Mechanical Engineering Admin', email, 'dept_admin', 'Mechanical Engineering', 'active'
FROM auth.users WHERE email = 'admin.mechanical@sjp.ac.lk';

INSERT INTO admins (id, name, email, role, department, status)
SELECT id, 'Interdisciplinary Studies Admin', email, 'dept_admin', 'Interdisciplinary Studies', 'active'
FROM auth.users WHERE email = 'admin.is@sjp.ac.lk';
