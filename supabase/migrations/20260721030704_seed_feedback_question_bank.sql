-- seed_feedback_question_bank
-- Applied 20260721030704
-- Exported from the live project; do not edit by hand.


INSERT INTO public.feedback_questions (question_text, question_type, category, display_order, is_required) VALUES
('The course content was clearly organised.', 'rating', 'Course Content', 1, true),
('The learning outcomes were clearly communicated.', 'rating', 'Course Content', 2, true),
('The lecturer explained the subject clearly.', 'rating', 'Teaching', 3, true),
('The lecturer encouraged student participation.', 'rating', 'Teaching', 4, true),
('Learning materials and resources were useful.', 'rating', 'Resources', 5, true),
('Practical sessions or tutorials supported the course content.', 'rating', 'Resources', 6, true),
('Assessments were relevant to the course content.', 'rating', 'Assessment', 7, true),
('The course workload was reasonable.', 'rating', 'Workload', 8, true),
('I received adequate academic support when needed.', 'rating', 'Support', 9, true),
('Overall, I am satisfied with this course.', 'rating', 'Overall', 10, true),
('What did you find most useful about this course?', 'long_text', 'Comments', 11, false),
('What aspects of the course could be improved?', 'long_text', 'Comments', 12, false),
('Do you have any suggestions for the lecturer or course coordinator?', 'long_text', 'Comments', 13, false),
('Additional comments', 'long_text', 'Comments', 14, false);
