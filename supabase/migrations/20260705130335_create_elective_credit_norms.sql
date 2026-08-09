-- create_elective_credit_norms
-- Applied 20260705130335
-- Exported from the live project; do not edit by hand.


CREATE TABLE IF NOT EXISTS elective_credit_norms (
  department text NOT NULL,
  semester int NOT NULL,
  elective_credits int NOT NULL,
  PRIMARY KEY (department, semester)
);

INSERT INTO elective_credit_norms (department, semester, elective_credits) VALUES
('Computer Engineering', 7, 5),
('Computer Engineering', 8, 5),
('Civil Engineering', 7, 6),
('Civil Engineering', 8, 10),
('Electrical and Electronic Engineering', 7, 5),
('Electrical and Electronic Engineering', 8, 9),
('Mechanical Engineering', 7, 5),
('Mechanical Engineering', 8, 5)
ON CONFLICT (department, semester) DO NOTHING;

ALTER TABLE elective_credit_norms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authenticated can read elective norms"
ON elective_credit_norms FOR SELECT
USING (auth.role() = 'authenticated');
