-- restrict_ai_usage_log_to_super_admin
-- Applied 20260720045621
-- Exported from the live project; do not edit by hand.

-- ai_assistant_usage_log is a shared cross-department operational metric
-- (Gemini quota tracking), not department-owned data — narrow visibility
-- to the Super Admin rather than every department admin.
DROP POLICY IF EXISTS ai_usage_log_admin_read ON ai_assistant_usage_log;

CREATE POLICY ai_usage_log_super_admin_read ON ai_assistant_usage_log
  FOR SELECT
  USING (get_my_role() = 'super_admin');
