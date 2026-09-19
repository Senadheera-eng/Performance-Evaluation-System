-- the_section_icons_the_printed_report_uses
-- Applied 20260830134414
-- Exported from the live project; do not edit by hand.

-- The section icons the printed report uses.
--
-- The bank picked its own icons when it was seeded and the faculty's report
-- prints different ones for the same sections -- a folder rather than a
-- notebook for Learning Resources, a monitor rather than a laptop for
-- Delivery Mode, books for Course Content. The generated PDF sets them to
-- match the reference; this brings the on-screen report into line, so a
-- lecturer reading it in the browser and reading the downloaded file is
-- looking at the same document.

update public.feedback_questions set section_icon = v.icon
  from (values
    ('course_content',     '📚'),
    ('learning_resources', '🗂️'),
    ('delivery_mode',      '🖥️'),
    ('other_comments',     '🗒️')
  ) as v(key, icon)
 where public.feedback_questions.section_key = v.key
   and public.feedback_questions.section_icon is distinct from v.icon;
