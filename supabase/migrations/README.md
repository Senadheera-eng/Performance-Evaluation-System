# Database migrations

The 268 migrations in this folder, numbered in the order they were applied.

The files keep their timestamp names on purpose. The live database records each
migration it has run by that timestamp (`supabase_migrations.schema_migrations`),
and the Supabase CLI matches files to that history by it. Renaming a file would
make the CLI treat it as never applied and try to run it again. Use the numbers
below to refer to a migration; use the file name to run one.

New migrations are added to the end of this list.

| No. | Applied | What it does | File |
|---:|---|---|---|
| 001 | 2026-07-04 | Add student status column | [`20260704090726_add_student_status_column.sql`](20260704090726_add_student_status_column.sql) |
| 002 | 2026-07-04 | Add me sem5 courses | [`20260704091521_add_me_sem5_courses.sql`](20260704091521_add_me_sem5_courses.sql) |
| 003 | 2026-07-04 | Add co sem6 courses | [`20260704101322_add_co_sem6_courses.sql`](20260704101322_add_co_sem6_courses.sql) |
| 004 | 2026-07-04 | Add ce sem6 courses | [`20260704170251_add_ce_sem6_courses.sql`](20260704170251_add_ce_sem6_courses.sql) |
| 005 | 2026-07-04 | Add me sem6 courses | [`20260704171114_add_me_sem6_courses.sql`](20260704171114_add_me_sem6_courses.sql) |
| 006 | 2026-07-04 | Add ee sem5 courses | [`20260704173502_add_ee_sem5_courses.sql`](20260704173502_add_ee_sem5_courses.sql) |
| 007 | 2026-07-04 | Add ee sem6 courses | [`20260704175209_add_ee_sem6_courses.sql`](20260704175209_add_ee_sem6_courses.sql) |
| 008 | 2026-07-04 | Add index number column | [`20260704183326_add_index_number_column.sql`](20260704183326_add_index_number_column.sql) |
| 009 | 2026-07-05 | Add co sem7 courses | [`20260705040535_add_co_sem7_courses.sql`](20260705040535_add_co_sem7_courses.sql) |
| 010 | 2026-07-05 | Enhance medical submissions | [`20260705041042_enhance_medical_submissions.sql`](20260705041042_enhance_medical_submissions.sql) |
| 011 | 2026-07-05 | Create medical certificates bucket | [`20260705041109_create_medical_certificates_bucket.sql`](20260705041109_create_medical_certificates_bucket.sql) |
| 012 | 2026-07-05 | Fix courses unique constraint for multi semester codes | [`20260705052856_fix_courses_unique_constraint_for_multi_semester_codes.sql`](20260705052856_fix_courses_unique_constraint_for_multi_semester_codes.sql) |
| 013 | 2026-07-05 | Add co sem8 courses | [`20260705052922_add_co_sem8_courses.sql`](20260705052922_add_co_sem8_courses.sql) |
| 014 | 2026-07-05 | Add sem7 sem8 all departments | [`20260705062016_add_sem7_sem8_all_departments.sql`](20260705062016_add_sem7_sem8_all_departments.sql) |
| 015 | 2026-07-05 | Create elective credit norms | [`20260705130335_create_elective_credit_norms.sql`](20260705130335_create_elective_credit_norms.sql) |
| 016 | 2026-07-05 | Create ai assistant rpcs | [`20260705130407_create_ai_assistant_rpcs.sql`](20260705130407_create_ai_assistant_rpcs.sql) |
| 017 | 2026-07-05 | Improve course search matching | [`20260705171754_improve_course_search_matching.sql`](20260705171754_improve_course_search_matching.sql) |
| 018 | 2026-07-05 | Improve course search word boundaries | [`20260705171854_improve_course_search_word_boundaries.sql`](20260705171854_improve_course_search_word_boundaries.sql) |
| 019 | 2026-07-05 | Fix course search mixed matching | [`20260705171924_fix_course_search_mixed_matching.sql`](20260705171924_fix_course_search_mixed_matching.sql) |
| 020 | 2026-07-18 | Add handbook rag support | [`20260718153916_add_handbook_rag_support.sql`](20260718153916_add_handbook_rag_support.sql) |
| 021 | 2026-07-18 | Resize handbook embedding to 64dim | [`20260718195828_resize_handbook_embedding_to_64dim.sql`](20260718195828_resize_handbook_embedding_to_64dim.sql) |
| 022 | 2026-07-18 | Restore handbook embedding to 384dim | [`20260718202007_restore_handbook_embedding_to_384dim.sql`](20260718202007_restore_handbook_embedding_to_384dim.sql) |
| 023 | 2026-07-18 | Fix search handbook public grant | [`20260718205843_fix_search_handbook_public_grant.sql`](20260718205843_fix_search_handbook_public_grant.sql) |
| 024 | 2026-07-19 | Create ai assistant usage log | [`20260719061401_create_ai_assistant_usage_log.sql`](20260719061401_create_ai_assistant_usage_log.sql) |
| 025 | 2026-07-19 | Add search handbook text for llm tool | [`20260719061524_add_search_handbook_text_for_llm_tool.sql`](20260719061524_add_search_handbook_text_for_llm_tool.sql) |
| 026 | 2026-07-19 | Add get courses by semester | [`20260719064540_add_get_courses_by_semester.sql`](20260719064540_add_get_courses_by_semester.sql) |
| 027 | 2026-07-19 | Add get student results | [`20260719070005_add_get_student_results.sql`](20260719070005_add_get_student_results.sql) |
| 028 | 2026-07-19 | Add get student course result | [`20260719070017_add_get_student_course_result.sql`](20260719070017_add_get_student_course_result.sql) |
| 029 | 2026-07-19 | Add course filter to get student results | [`20260719122110_add_course_filter_to_get_student_results.sql`](20260719122110_add_course_filter_to_get_student_results.sql) |
| 030 | 2026-07-19 | Fix get student course result token matching | [`20260719122124_fix_get_student_course_result_token_matching.sql`](20260719122124_fix_get_student_course_result_token_matching.sql) |
| 031 | 2026-07-20 | Dept admin rbac foundation | [`20260720045404_dept_admin_rbac_foundation.sql`](20260720045404_dept_admin_rbac_foundation.sql) |
| 032 | 2026-07-20 | Dept scope students rls | [`20260720045524_dept_scope_students_rls.sql`](20260720045524_dept_scope_students_rls.sql) |
| 033 | 2026-07-20 | Dept scope courses rls | [`20260720045543_dept_scope_courses_rls.sql`](20260720045543_dept_scope_courses_rls.sql) |
| 034 | 2026-07-20 | Dept scope results attendance enrollments medical rls | [`20260720045606_dept_scope_results_attendance_enrollments_medical_rls.sql`](20260720045606_dept_scope_results_attendance_enrollments_medical_rls.sql) |
| 035 | 2026-07-20 | Restrict ai usage log to super admin | [`20260720045621_restrict_ai_usage_log_to_super_admin.sql`](20260720045621_restrict_ai_usage_log_to_super_admin.sql) |
| 036 | 2026-07-20 | Create admins table | [`20260720053831_create_admins_table.sql`](20260720053831_create_admins_table.sql) |
| 037 | 2026-07-20 | Resolve role and department across admins and students | [`20260720053844_resolve_role_and_department_across_admins_and_students.sql`](20260720053844_resolve_role_and_department_across_admins_and_students.sql) |
| 038 | 2026-07-20 | Migrate admin rows to admins table | [`20260720053859_migrate_admin_rows_to_admins_table.sql`](20260720053859_migrate_admin_rows_to_admins_table.sql) |
| 039 | 2026-07-20 | Fix rls recursion in role helpers | [`20260720054717_fix_rls_recursion_in_role_helpers.sql`](20260720054717_fix_rls_recursion_in_role_helpers.sql) |
| 040 | 2026-07-20 | Fix rls recursion via plpgsql helpers | [`20260720054838_fix_rls_recursion_via_plpgsql_helpers.sql`](20260720054838_fix_rls_recursion_via_plpgsql_helpers.sql) |
| 041 | 2026-07-20 | Fix is admin read recursion | [`20260720055047_fix_is_admin_read_recursion.sql`](20260720055047_fix_is_admin_read_recursion.sql) |
| 042 | 2026-07-20 | Add admin student academic stats rpc | [`20260720061352_add_admin_student_academic_stats_rpc.sql`](20260720061352_add_admin_student_academic_stats_rpc.sql) |
| 043 | 2026-07-20 | Fix academic stats rpc credits cast | [`20260720061412_fix_academic_stats_rpc_credits_cast.sql`](20260720061412_fix_academic_stats_rpc_credits_cast.sql) |
| 044 | 2026-07-20 | Retag singular is courses | [`20260720063520_retag_singular_is_courses.sql`](20260720063520_retag_singular_is_courses.sql) |
| 045 | 2026-07-20 | Dedupe and retag duplicated is courses | [`20260720063614_dedupe_and_retag_duplicated_is_courses.sql`](20260720063614_dedupe_and_retag_duplicated_is_courses.sql) |
| 046 | 2026-07-20 | Correct academic year labels from batch and course year | [`20260720082248_correct_academic_year_labels_from_batch_and_course_year.sql`](20260720082248_correct_academic_year_labels_from_batch_and_course_year.sql) |
| 047 | 2026-07-20 | Medical submissions multi course and multi file | [`20260720084322_medical_submissions_multi_course_and_multi_file.sql`](20260720084322_medical_submissions_multi_course_and_multi_file.sql) |
| 048 | 2026-07-20 | Include is courses in department scoped rpcs | [`20260720085915_include_is_courses_in_department_scoped_rpcs.sql`](20260720085915_include_is_courses_in_department_scoped_rpcs.sql) |
| 049 | 2026-07-20 | Add attendance total to academic stats rpc | [`20260720093338_add_attendance_total_to_academic_stats_rpc.sql`](20260720093338_add_attendance_total_to_academic_stats_rpc.sql) |
| 050 | 2026-07-21 | Course feedback system schema | [`20260721030459_course_feedback_system_schema.sql`](20260721030459_course_feedback_system_schema.sql) |
| 051 | 2026-07-21 | Course feedback system rls | [`20260721030528_course_feedback_system_rls.sql`](20260721030528_course_feedback_system_rls.sql) |
| 052 | 2026-07-21 | Course feedback student rpcs | [`20260721030606_course_feedback_student_rpcs.sql`](20260721030606_course_feedback_student_rpcs.sql) |
| 053 | 2026-07-21 | Course feedback admin rpcs | [`20260721030649_course_feedback_admin_rpcs.sql`](20260721030649_course_feedback_admin_rpcs.sql) |
| 054 | 2026-07-21 | Seed feedback question bank | [`20260721030704_seed_feedback_question_bank.sql`](20260721030704_seed_feedback_question_bank.sql) |
| 055 | 2026-07-21 | Fix feedback small group suppression | [`20260721031056_fix_feedback_small_group_suppression.sql`](20260721031056_fix_feedback_small_group_suppression.sql) |
| 056 | 2026-07-21 | Allow dept admins to author feedback questions | [`20260721035606_allow_dept_admins_to_author_feedback_questions.sql`](20260721035606_allow_dept_admins_to_author_feedback_questions.sql) |
| 057 | 2026-07-25 | Add course results roster rpc | [`20260725074120_add_course_results_roster_rpc.sql`](20260725074120_add_course_results_roster_rpc.sql) |
| 058 | 2026-07-25 | Create enrollment periods | [`20260725074449_create_enrollment_periods.sql`](20260725074449_create_enrollment_periods.sql) |
| 059 | 2026-07-25 | Harden function grants and search paths | [`20260725074917_harden_function_grants_and_search_paths.sql`](20260725074917_harden_function_grants_and_search_paths.sql) |
| 060 | 2026-07-25 | Harden avatar storage policies | [`20260725075352_harden_avatar_storage_policies.sql`](20260725075352_harden_avatar_storage_policies.sql) |
| 061 | 2026-07-25 | Revoke public execute on security definer functions | [`20260725075824_revoke_public_execute_on_security_definer_functions.sql`](20260725075824_revoke_public_execute_on_security_definer_functions.sql) |
| 062 | 2026-07-25 | Remove student self registration | [`20260725084328_remove_student_self_registration.sql`](20260725084328_remove_student_self_registration.sql) |
| 063 | 2026-07-25 | Make courses read only | [`20260725085532_make_courses_read_only.sql`](20260725085532_make_courses_read_only.sql) |
| 064 | 2026-07-25 | Create course prerequisites | [`20260725085557_create_course_prerequisites.sql`](20260725085557_create_course_prerequisites.sql) |
| 065 | 2026-07-25 | Create system settings regulation engine | [`20260725085658_create_system_settings_regulation_engine.sql`](20260725085658_create_system_settings_regulation_engine.sql) |
| 066 | 2026-07-25 | Remove course prerequisites | [`20260725092420_remove_course_prerequisites.sql`](20260725092420_remove_course_prerequisites.sql) |
| 067 | 2026-07-25 | Fix feedback eligibility include historical results | [`20260725092454_fix_feedback_eligibility_include_historical_results.sql`](20260725092454_fix_feedback_eligibility_include_historical_results.sql) |
| 068 | 2026-07-25 | Fix feedback form and write path | [`20260725092553_fix_feedback_form_and_write_path.sql`](20260725092553_fix_feedback_form_and_write_path.sql) |
| 069 | 2026-07-26 | Add results published at and admin recent results rpc | [`20260726083325_add_results_published_at_and_admin_recent_results_rpc.sql`](20260726083325_add_results_published_at_and_admin_recent_results_rpc.sql) |
| 070 | 2026-07-26 | Add batch year to course roster | [`20260726084354_add_batch_year_to_course_roster.sql`](20260726084354_add_batch_year_to_course_roster.sql) |
| 071 | 2026-07-26 | Add department to course roster | [`20260726090131_add_department_to_course_roster.sql`](20260726090131_add_department_to_course_roster.sql) |
| 072 | 2026-07-26 | Extend enrollment periods statuses courses and stats | [`20260726092527_extend_enrollment_periods_statuses_courses_and_stats.sql`](20260726092527_extend_enrollment_periods_statuses_courses_and_stats.sql) |
| 073 | 2026-07-26 | Fix enrollment period stats visibility | [`20260726092612_fix_enrollment_period_stats_visibility.sql`](20260726092612_fix_enrollment_period_stats_visibility.sql) |
| 074 | 2026-07-26 | Add course enrollment overview rpcs | [`20260726110114_add_course_enrollment_overview_rpcs.sql`](20260726110114_add_course_enrollment_overview_rpcs.sql) |
| 075 | 2026-07-26 | Nest course stats under period and scope roster by period | [`20260726111824_nest_course_stats_under_period_and_scope_roster_by_period.sql`](20260726111824_nest_course_stats_under_period_and_scope_roster_by_period.sql) |
| 076 | 2026-07-26 | Fix period course stats academic year derivation | [`20260726112040_fix_period_course_stats_academic_year_derivation.sql`](20260726112040_fix_period_course_stats_academic_year_derivation.sql) |
| 077 | 2026-07-26 | Drop unused course enrollment overview rpc | [`20260726112436_drop_unused_course_enrollment_overview_rpc.sql`](20260726112436_drop_unused_course_enrollment_overview_rpc.sql) |
| 078 | 2026-07-26 | Scope period course list by admin department | [`20260726113431_scope_period_course_list_by_admin_department.sql`](20260726113431_scope_period_course_list_by_admin_department.sql) |
| 079 | 2026-07-26 | Scope is course counts and roster by viewer department | [`20260726134413_scope_is_course_counts_and_roster_by_viewer_department.sql`](20260726134413_scope_is_course_counts_and_roster_by_viewer_department.sql) |
| 080 | 2026-07-26 | Always scope period course counts by admin department | [`20260726135637_always_scope_period_course_counts_by_admin_department.sql`](20260726135637_always_scope_period_course_counts_by_admin_department.sql) |
| 081 | 2026-07-26 | Scope period summary header by admin department | [`20260726140229_scope_period_summary_header_by_admin_department.sql`](20260726140229_scope_period_summary_header_by_admin_department.sql) |
| 082 | 2026-07-26 | Add per course medical review schema | [`20260726145515_add_per_course_medical_review_schema.sql`](20260726145515_add_per_course_medical_review_schema.sql) |
| 083 | 2026-07-26 | Add medical review rpcs | [`20260726145551_add_medical_review_rpcs.sql`](20260726145551_add_medical_review_rpcs.sql) |
| 084 | 2026-07-26 | Lock down medical submission course department trigger | [`20260726145852_lock_down_medical_submission_course_department_trigger.sql`](20260726145852_lock_down_medical_submission_course_department_trigger.sql) |
| 085 | 2026-08-08 | Extend lecturers and seed from handbook | [`20260808104242_extend_lecturers_and_seed_from_handbook.sql`](20260808104242_extend_lecturers_and_seed_from_handbook.sql) |
| 086 | 2026-08-08 | Create hod appointments | [`20260808104334_create_hod_appointments.sql`](20260808104334_create_hod_appointments.sql) |
| 087 | 2026-08-08 | Create course offerings and backfill | [`20260808104409_create_course_offerings_and_backfill.sql`](20260808104409_create_course_offerings_and_backfill.sql) |
| 088 | 2026-08-08 | Rebuild course lecturers offering scoped | [`20260808104506_rebuild_course_lecturers_offering_scoped.sql`](20260808104506_rebuild_course_lecturers_offering_scoped.sql) |
| 089 | 2026-08-08 | Scope lecturer writes and allow department course editing | [`20260808104605_scope_lecturer_writes_and_allow_department_course_editing.sql`](20260808104605_scope_lecturer_writes_and_allow_department_course_editing.sql) |
| 090 | 2026-08-08 | Revoke execute on new trigger functions | [`20260808105224_revoke_execute_on_new_trigger_functions.sql`](20260808105224_revoke_execute_on_new_trigger_functions.sql) |
| 091 | 2026-08-08 | Results offering link and submission workflow | [`20260808113049_results_offering_link_and_submission_workflow.sql`](20260808113049_results_offering_link_and_submission_workflow.sql) |
| 092 | 2026-08-08 | Student result visibility hide ese and oa | [`20260808113153_student_result_visibility_hide_ese_and_oa.sql`](20260808113153_student_result_visibility_hide_ese_and_oa.sql) |
| 093 | 2026-08-08 | Lecturer attendance and result entry permissions | [`20260808113255_lecturer_attendance_and_result_entry_permissions.sql`](20260808113255_lecturer_attendance_and_result_entry_permissions.sql) |
| 094 | 2026-08-08 | Staff dashboard rpcs | [`20260808114835_staff_dashboard_rpcs.sql`](20260808114835_staff_dashboard_rpcs.sql) |
| 095 | 2026-08-08 | Align offering student count with roster | [`20260808115709_align_offering_student_count_with_roster.sql`](20260808115709_align_offering_student_count_with_roster.sql) |
| 096 | 2026-08-08 | Attendance unique per student course date | [`20260808121001_attendance_unique_per_student_course_date.sql`](20260808121001_attendance_unique_per_student_course_date.sql) |
| 097 | 2026-08-08 | Hod department student records | [`20260808123938_hod_department_student_records.sql`](20260808123938_hod_department_student_records.sql) |
| 098 | 2026-08-08 | Fix null role three valued logic in staff rpcs | [`20260808155127_fix_null_role_three_valued_logic_in_staff_rpcs.sql`](20260808155127_fix_null_role_three_valued_logic_in_staff_rpcs.sql) |
| 099 | 2026-08-08 | Pending result reviews rpc | [`20260808160811_pending_result_reviews_rpc.sql`](20260808160811_pending_result_reviews_rpc.sql) |
| 100 | 2026-08-08 | Complete ese hiding drop student policies on results | [`20260808162644_complete_ese_hiding_drop_student_policies_on_results.sql`](20260808162644_complete_ese_hiding_drop_student_policies_on_results.sql) |
| 101 | 2026-08-08 | Student batch change with history | [`20260808165752_student_batch_change_with_history.sql`](20260808165752_student_batch_change_with_history.sql) |
| 102 | 2026-08-08 | Feedback question model extension | [`20260808203957_feedback_question_model_extension.sql`](20260808203957_feedback_question_model_extension.sql) |
| 103 | 2026-08-08 | Feedback student rpcs lecturer targeting | [`20260808204129_feedback_student_rpcs_lecturer_targeting.sql`](20260808204129_feedback_student_rpcs_lecturer_targeting.sql) |
| 104 | 2026-08-08 | Feedback form keep flat questions for deployed client | [`20260808204332_feedback_form_keep_flat_questions_for_deployed_client.sql`](20260808204332_feedback_form_keep_flat_questions_for_deployed_client.sql) |
| 105 | 2026-08-08 | Feedback release control and lecturer analytics | [`20260808204504_feedback_release_control_and_lecturer_analytics.sql`](20260808204504_feedback_release_control_and_lecturer_analytics.sql) |
| 106 | 2026-08-08 | Lecturer created feedback periods with approval | [`20260808204634_lecturer_created_feedback_periods_with_approval.sql`](20260808204634_lecturer_created_feedback_periods_with_approval.sql) |
| 107 | 2026-08-08 | Fix lecturer period lifecycle after approval | [`20260808204755_fix_lecturer_period_lifecycle_after_approval.sql`](20260808204755_fix_lecturer_period_lifecycle_after_approval.sql) |
| 108 | 2026-08-08 | Pin search path on feedback answer provided | [`20260808213454_pin_search_path_on_feedback_answer_provided.sql`](20260808213454_pin_search_path_on_feedback_answer_provided.sql) |
| 109 | 2026-08-09 | Releasable feedback rpc | [`20260809031424_releasable_feedback_rpc.sql`](20260809031424_releasable_feedback_rpc.sql) |
| 110 | 2026-08-09 | Temp export migrations rpc | [`20260809033302_temp_export_migrations_rpc.sql`](20260809033302_temp_export_migrations_rpc.sql) |
| 111 | 2026-08-09 | Drop temp export migrations rpc | [`20260809033408_drop_temp_export_migrations_rpc.sql`](20260809033408_drop_temp_export_migrations_rpc.sql) |
| 112 | 2026-08-09 | Fix null unsafe feedback question constraints | [`20260809034904_fix_null_unsafe_feedback_question_constraints.sql`](20260809034904_fix_null_unsafe_feedback_question_constraints.sql) |
| 113 | 2026-08-09 | Lecturer can resubmit and withdraw feedback requests | [`20260809035908_lecturer_can_resubmit_and_withdraw_feedback_requests.sql`](20260809035908_lecturer_can_resubmit_and_withdraw_feedback_requests.sql) |
| 114 | 2026-08-09 | Hod department feedback analytics | [`20260809064202_hod_department_feedback_analytics.sql`](20260809064202_hod_department_feedback_analytics.sql) |
| 115 | 2026-08-09 | Drop stale feedback answer uniqueness blocking lecturer targeting | [`20260809064426_drop_stale_feedback_answer_uniqueness_blocking_lecturer_targeting.sql`](20260809064426_drop_stale_feedback_answer_uniqueness_blocking_lecturer_targeting.sql) |
| 116 | 2026-08-09 | Feedback question presentation fields | [`20260809073757_feedback_question_presentation_fields.sql`](20260809073757_feedback_question_presentation_fields.sql) |
| 117 | 2026-08-09 | Replace question bank with faculty course feedback form | [`20260809073905_replace_question_bank_with_faculty_course_feedback_form.sql`](20260809073905_replace_question_bank_with_faculty_course_feedback_form.sql) |
| 118 | 2026-08-09 | Student feedback catalogue and form presentation | [`20260809074028_student_feedback_catalogue_and_form_presentation.sql`](20260809074028_student_feedback_catalogue_and_form_presentation.sql) |
| 119 | 2026-08-09 | Permanent service role migration export rpc | [`20260809074927_permanent_service_role_migration_export_rpc.sql`](20260809074927_permanent_service_role_migration_export_rpc.sql) |
| 120 | 2026-08-09 | Field visit followup questions | [`20260809080559_field_visit_followup_questions.sql`](20260809080559_field_visit_followup_questions.sql) |
| 121 | 2026-08-09 | Exact section subtitles from faculty form | [`20260809081443_exact_section_subtitles_from_faculty_form.sql`](20260809081443_exact_section_subtitles_from_faculty_form.sql) |
| 122 | 2026-08-09 | Course scoped feedback questions | [`20260809083411_course_scoped_feedback_questions.sql`](20260809083411_course_scoped_feedback_questions.sql) |
| 123 | 2026-08-09 | Coordinator course specific questions | [`20260809083528_coordinator_course_specific_questions.sql`](20260809083528_coordinator_course_specific_questions.sql) |
| 124 | 2026-08-09 | Feedback question author may be a lecturer | [`20260809083628_feedback_question_author_may_be_a_lecturer.sql`](20260809083628_feedback_question_author_may_be_a_lecturer.sql) |
| 125 | 2026-08-22 | Sidebar notification counts | [`20260822064701_sidebar_notification_counts.sql`](20260822064701_sidebar_notification_counts.sql) |
| 126 | 2026-08-22 | Resit updates the original result and caps a repeat at c | [`20260822125839_resit_updates_the_original_result_and_caps_a_repeat_at_c.sql`](20260822125839_resit_updates_the_original_result_and_caps_a_repeat_at_c.sql) |
| 127 | 2026-08-22 | Repeat and medical students may enrol with a later batch | [`20260822125928_repeat_and_medical_students_may_enrol_with_a_later_batch.sql`](20260822125928_repeat_and_medical_students_may_enrol_with_a_later_batch.sql) |
| 128 | 2026-08-22 | Notify students of repeat enrolment | [`20260822130322_notify_students_of_repeat_enrolment.sql`](20260822130322_notify_students_of_repeat_enrolment.sql) |
| 129 | 2026-08-22 | Correcting a mistaken grade | [`20260822132418_correcting_a_mistaken_grade.sql`](20260822132418_correcting_a_mistaken_grade.sql) |
| 130 | 2026-08-22 | Cap a repeat on every write not just the first | [`20260822132539_cap_a_repeat_on_every_write_not_just_the_first.sql`](20260822132539_cap_a_repeat_on_every_write_not_just_the_first.sql) |
| 131 | 2026-08-22 | Enrolment eligibility follows the students semester | [`20260822170712_enrolment_eligibility_follows_the_students_semester.sql`](20260822170712_enrolment_eligibility_follows_the_students_semester.sql) |
| 132 | 2026-08-23 | A super admin can move a headship | [`20260823055636_a_super_admin_can_move_a_headship.sql`](20260823055636_a_super_admin_can_move_a_headship.sql) |
| 133 | 2026-08-23 | Students check themselves in with a rotating code | [`20260823085152_students_check_themselves_in_with_a_rotating_code.sql`](20260823085152_students_check_themselves_in_with_a_rotating_code.sql) |
| 134 | 2026-08-23 | Signing the register by typing the code | [`20260823085557_signing_the_register_by_typing_the_code.sql`](20260823085557_signing_the_register_by_typing_the_code.sql) |
| 135 | 2026-08-23 | Presence checks and where the scan came from | [`20260823093027_presence_checks_and_where_the_scan_came_from.sql`](20260823093027_presence_checks_and_where_the_scan_came_from.sql) |
| 136 | 2026-08-23 | The lecturer sees who needs a second look | [`20260823093114_the_lecturer_sees_who_needs_a_second_look.sql`](20260823093114_the_lecturer_sees_who_needs_a_second_look.sql) |
| 137 | 2026-08-23 | A register outlives the browser tab that opened it | [`20260823101252_a_register_outlives_the_browser_tab_that_opened_it.sql`](20260823101252_a_register_outlives_the_browser_tab_that_opened_it.sql) |
| 138 | 2026-08-23 | The admin period list says which round it is | [`20260823133517_the_admin_period_list_says_which_round_it_is.sql`](20260823133517_the_admin_period_list_says_which_round_it_is.sql) |
| 139 | 2026-08-23 | The faculty grade scale and per course assessment weights | [`20260823135302_the_faculty_grade_scale_and_per_course_assessment_weights.sql`](20260823135302_the_faculty_grade_scale_and_per_course_assessment_weights.sql) |
| 140 | 2026-08-23 | A degree is eight semesters whether or not they have results | [`20260823135427_a_degree_is_eight_semesters_whether_or_not_they_have_results.sql`](20260823135427_a_degree_is_eight_semesters_whether_or_not_they_have_results.sql) |
| 141 | 2026-08-23 | A course is marked on ca and ese the way the handbook says | [`20260823145849_a_course_is_marked_on_ca_and_ese_the_way_the_handbook_says.sql`](20260823145849_a_course_is_marked_on_ca_and_ese_the_way_the_handbook_says.sql) |
| 142 | 2026-08-23 | Put names on the published result sheet | [`20260823153108_put_names_on_the_published_result_sheet.sql`](20260823153108_put_names_on_the_published_result_sheet.sql) |
| 143 | 2026-08-28 | The curriculum as the handbook lays it out | [`20260828183623_the_curriculum_as_the_handbook_lays_it_out.sql`](20260828183623_the_curriculum_as_the_handbook_lays_it_out.sql) |
| 144 | 2026-08-28 | Enrolment reads the semester as baskets | [`20260828184349_enrolment_reads_the_semester_as_baskets.sql`](20260828184349_enrolment_reads_the_semester_as_baskets.sql) |
| 145 | 2026-08-28 | Seed the curriculum from the faculty handbook 2026 | [`20260828185043_seed_the_curriculum_from_the_faculty_handbook_2026.sql`](20260828185043_seed_the_curriculum_from_the_faculty_handbook_2026.sql) |
| 146 | 2026-08-28 | A student can change their mind while the window is open | [`20260828192311_a_student_can_change_their_mind_while_the_window_is_open.sql`](20260828192311_a_student_can_change_their_mind_while_the_window_is_open.sql) |
| 147 | 2026-08-28 | A mark locks the attempt it belongs to not the course | [`20260828193906_a_mark_locks_the_attempt_it_belongs_to_not_the_course.sql`](20260828193906_a_mark_locks_the_attempt_it_belongs_to_not_the_course.sql) |
| 148 | 2026-08-28 | A drop takes back the year the window is offering | [`20260828200228_a_drop_takes_back_the_year_the_window_is_offering.sql`](20260828200228_a_drop_takes_back_the_year_the_window_is_offering.sql) |
| 149 | 2026-08-29 | An open enrolment window is something waiting for the student | [`20260829043122_an_open_enrolment_window_is_something_waiting_for_the_student.sql`](20260829043122_an_open_enrolment_window_is_something_waiting_for_the_student.sql) |
| 150 | 2026-08-29 | The sheet says which courses this round is actually offering | [`20260829043512_the_sheet_says_which_courses_this_round_is_actually_offering.sql`](20260829043512_the_sheet_says_which_courses_this_round_is_actually_offering.sql) |
| 151 | 2026-08-29 | A window offers what the semester curriculum contains | [`20260829044717_a_window_offers_what_the_semester_curriculum_contains.sql`](20260829044717_a_window_offers_what_the_semester_curriculum_contains.sql) |
| 152 | 2026-08-29 | A credit already earned still counts toward its basket | [`20260829131047_a_credit_already_earned_still_counts_toward_its_basket.sql`](20260829131047_a_credit_already_earned_still_counts_toward_its_basket.sql) |
| 153 | 2026-08-29 | The lab section the report was already printing | [`20260829172705_the_lab_section_the_report_was_already_printing.sql`](20260829172705_the_lab_section_the_report_was_already_printing.sql) |
| 154 | 2026-08-29 | Draft is when the form is written open is when it is answered | [`20260829172837_draft_is_when_the_form_is_written_open_is_when_it_is_answered.sql`](20260829172837_draft_is_when_the_form_is_written_open_is_when_it_is_answered.sql) |
| 155 | 2026-08-29 | Opening the form is the release | [`20260829173044_opening_the_form_is_the_release.sql`](20260829173044_opening_the_form_is_the_release.sql) |
| 156 | 2026-08-29 | The feedback report the faculty already prints | [`20260829173156_the_feedback_report_the_faculty_already_prints.sql`](20260829173156_the_feedback_report_the_faculty_already_prints.sql) |
| 157 | 2026-08-29 | Count a multi select by the students who picked not the ticks | [`20260829173458_count_a_multi_select_by_the_students_who_picked_not_the_ticks.sql`](20260829173458_count_a_multi_select_by_the_students_who_picked_not_the_ticks.sql) |
| 158 | 2026-08-29 | The overview names the course the report asks for | [`20260829173806_the_overview_names_the_course_the_report_asks_for.sql`](20260829173806_the_overview_names_the_course_the_report_asks_for.sql) |
| 159 | 2026-08-29 | A multi select answer has to survive the write | [`20260829174515_a_multi_select_answer_has_to_survive_the_write.sql`](20260829174515_a_multi_select_answer_has_to_survive_the_write.sql) |
| 160 | 2026-08-29 | The form reads back what the student ticked | [`20260829174556_the_form_reads_back_what_the_student_ticked.sql`](20260829174556_the_form_reads_back_what_the_student_ticked.sql) |
| 161 | 2026-08-29 | The form hands back the answers it lets you edit | [`20260829175054_the_form_hands_back_the_answers_it_lets_you_edit.sql`](20260829175054_the_form_hands_back_the_answers_it_lets_you_edit.sql) |
| 162 | 2026-08-30 | Count the students not the answers they left | [`20260830124147_count_the_students_not_the_answers_they_left.sql`](20260830124147_count_the_students_not_the_answers_they_left.sql) |
| 163 | 2026-08-30 | The section icons the printed report uses | [`20260830134414_the_section_icons_the_printed_report_uses.sql`](20260830134414_the_section_icons_the_printed_report_uses.sql) |
| 164 | 2026-08-30 | Every student has a lecturer who is theirs to ask | [`20260830135934_every_student_has_a_lecturer_who_is_theirs_to_ask.sql`](20260830135934_every_student_has_a_lecturer_who_is_theirs_to_ask.sql) |
| 165 | 2026-08-30 | What each side of a mentoring pair can see | [`20260830140059_what_each_side_of_a_mentoring_pair_can_see.sql`](20260830140059_what_each_side_of_a_mentoring_pair_can_see.sql) |
| 166 | 2026-08-30 | A mentor and their student can talk | [`20260830143626_a_mentor_and_their_student_can_talk.sql`](20260830143626_a_mentor_and_their_student_can_talk.sql) |
| 167 | 2026-08-30 | A message from your mentor is something waiting for you | [`20260830144040_a_message_from_your_mentor_is_something_waiting_for_you.sql`](20260830144040_a_message_from_your_mentor_is_something_waiting_for_you.sql) |
| 168 | 2026-08-30 | A mentors notes are their own | [`20260830144759_a_mentors_notes_are_their_own.sql`](20260830144759_a_mentors_notes_are_their_own.sql) |
| 169 | 2026-08-31 | A mentoring message can carry a file | [`20260831033612_a_mentoring_message_can_carry_a_file.sql`](20260831033612_a_mentoring_message_can_carry_a_file.sql) |
| 170 | 2026-08-31 | The thread hands back the files too | [`20260831033651_the_thread_hands_back_the_files_too.sql`](20260831033651_the_thread_hands_back_the_files_too.sql) |
| 171 | 2026-09-09 | A guard that cannot answer must refuse | [`20260909143200_a_guard_that_cannot_answer_must_refuse.sql`](20260909143200_a_guard_that_cannot_answer_must_refuse.sql) |
| 172 | 2026-09-09 | Pin the search path and bar the results view | [`20260909143444_pin_the_search_path_and_bar_the_results_view.sql`](20260909143444_pin_the_search_path_and_bar_the_results_view.sql) |
| 173 | 2026-09-09 | Nothing is readable before signing in | [`20260909144505_nothing_is_readable_before_signing_in.sql`](20260909144505_nothing_is_readable_before_signing_in.sql) |
| 174 | 2026-09-09 | Decide once who is asking not once per row | [`20260909145040_decide_once_who_is_asking_not_once_per_row.sql`](20260909145040_decide_once_who_is_asking_not_once_per_row.sql) |
| 175 | 2026-09-09 | Ask whether i am a lecturer before asking about every row | [`20260909145158_ask_whether_i_am_a_lecturer_before_asking_about_every_row.sql`](20260909145158_ask_whether_i_am_a_lecturer_before_asking_about_every_row.sql) |
| 176 | 2026-09-09 | A failed course has to be repeatable | [`20260909150732_a_failed_course_has_to_be_repeatable.sql`](20260909150732_a_failed_course_has_to_be_repeatable.sql) |
| 177 | 2026-09-09 | Count enrolments where the rows are | [`20260909151251_count_enrolments_where_the_rows_are.sql`](20260909151251_count_enrolments_where_the_rows_are.sql) |
| 178 | 2026-09-09 | A lecturers row is not everyones to read | [`20260909152838_a_lecturers_row_is_not_everyones_to_read.sql`](20260909152838_a_lecturers_row_is_not_everyones_to_read.sql) |
| 179 | 2026-09-10 | A question is not a list of required words | [`20260910124210_a_question_is_not_a_list_of_required_words.sql`](20260910124210_a_question_is_not_a_list_of_required_words.sql) |
| 180 | 2026-09-10 | Do not stem what is already a stem | [`20260910125744_do_not_stem_what_is_already_a_stem.sql`](20260910125744_do_not_stem_what_is_already_a_stem.sql) |
| 181 | 2026-09-10 | Two functions that could not see the marks they add up | [`20260910135709_two_functions_that_could_not_see_the_marks_they_add_up.sql`](20260910135709_two_functions_that_could_not_see_the_marks_they_add_up.sql) |
| 182 | 2026-09-10 | The assistant can see attendance minors and medicals | [`20260910142309_the_assistant_can_see_attendance_minors_and_medicals.sql`](20260910142309_the_assistant_can_see_attendance_minors_and_medicals.sql) |
| 183 | 2026-09-11 | Tell a student what is wrong before they ask | [`20260911073917_tell_a_student_what_is_wrong_before_they_ask.sql`](20260911073917_tell_a_student_what_is_wrong_before_they_ask.sql) |
| 184 | 2026-09-11 | Say how many lectures it takes to get back | [`20260911074133_say_how_many_lectures_it_takes_to_get_back.sql`](20260911074133_say_how_many_lectures_it_takes_to_get_back.sql) |
| 185 | 2026-09-11 | One formula decides which academic year a sitting is | [`20260911130916_one_formula_decides_which_academic_year_a_sitting_is.sql`](20260911130916_one_formula_decides_which_academic_year_a_sitting_is.sql) |
| 186 | 2026-09-11 | A head of department may watch enrolment without touching it | [`20260911134016_a_head_of_department_may_watch_enrolment_without_touching_it.sql`](20260911134016_a_head_of_department_may_watch_enrolment_without_touching_it.sql) |
| 187 | 2026-09-11 | Count a windows enrolments by the batch sitting it | [`20260911134225_count_a_windows_enrolments_by_the_batch_sitting_it.sql`](20260911134225_count_a_windows_enrolments_by_the_batch_sitting_it.sql) |
| 188 | 2026-09-11 | Ask which batch is in this semester once not seven thousand times | [`20260911135540_ask_which_batch_is_in_this_semester_once_not_seven_thousand_times.sql`](20260911135540_ask_which_batch_is_in_this_semester_once_not_seven_thousand_times.sql) |
| 189 | 2026-09-11 | A student with no department yet still belongs to someone | [`20260911142226_a_student_with_no_department_yet_still_belongs_to_someone.sql`](20260911142226_a_student_with_no_department_yet_still_belongs_to_someone.sql) |
| 190 | 2026-09-11 | The grade is entered and the grade point follows from it | [`20260911143737_the_grade_is_entered_and_the_grade_point_follows_from_it.sql`](20260911143737_the_grade_is_entered_and_the_grade_point_follows_from_it.sql) |
| 191 | 2026-09-11 | Let the head publish and derive the grade point before the cap reads it | [`20260911143949_let_the_head_publish_and_derive_the_grade_point_before_the_cap_reads_it.sql`](20260911143949_let_the_head_publish_and_derive_the_grade_point_before_the_cap_reads_it.sql) |
| 192 | 2026-09-11 | Submitting a sheet is for the people whose sheet it is | [`20260911145306_submitting_a_sheet_is_for_the_people_whose_sheet_it_is.sql`](20260911145306_submitting_a_sheet_is_for_the_people_whose_sheet_it_is.sql) |
| 193 | 2026-09-11 | A place to record that something happened to you | [`20260911150158_a_place_to_record_that_something_happened_to_you.sql`](20260911150158_a_place_to_record_that_something_happened_to_you.sql) |
| 194 | 2026-09-11 | Tell people what changed where it changed | [`20260911150327_tell_people_what_changed_where_it_changed.sql`](20260911150327_tell_people_what_changed_where_it_changed.sql) |
| 195 | 2026-09-11 | Send the head of department somewhere they can actually go | [`20260911150707_send_the_head_of_department_somewhere_they_can_actually_go.sql`](20260911150707_send_the_head_of_department_somewhere_they_can_actually_go.sql) |
| 196 | 2026-09-11 | Publish notifications so they arrive when they happen | [`20260911184343_publish_notifications_so_they_arrive_when_they_happen.sql`](20260911184343_publish_notifications_so_they_arrive_when_they_happen.sql) |
| 197 | 2026-09-13 | A notice board that knows who each notice is for | [`20260913131722_a_notice_board_that_knows_who_each_notice_is_for.sql`](20260913131722_a_notice_board_that_knows_who_each_notice_is_for.sql) |
| 198 | 2026-09-13 | Who may publish a notice and who may read one | [`20260913131808_who_may_publish_a_notice_and_who_may_read_one.sql`](20260913131808_who_may_publish_a_notice_and_who_may_read_one.sql) |
| 199 | 2026-09-13 | Notice documents and the feed that knows what is yours | [`20260913131903_notice_documents_and_the_feed_that_knows_what_is_yours.sql`](20260913131903_notice_documents_and_the_feed_that_knows_what_is_yours.sql) |
| 200 | 2026-09-13 | One notice with everything a reader needs | [`20260913132322_one_notice_with_everything_a_reader_needs.sql`](20260913132322_one_notice_with_everything_a_reader_needs.sql) |
| 201 | 2026-09-13 | Ask who the reader is once not once per notice | [`20260913134010_ask_who_the_reader_is_once_not_once_per_notice.sql`](20260913134010_ask_who_the_reader_is_once_not_once_per_notice.sql) |
| 202 | 2026-09-13 | A department owns a course notice whoever teaches it | [`20260913134213_a_department_owns_a_course_notice_whoever_teaches_it.sql`](20260913134213_a_department_owns_a_course_notice_whoever_teaches_it.sql) |
| 203 | 2026-09-13 | A policy that re reads the row cannot see the row being inserted | [`20260913144704_a_policy_that_re_reads_the_row_cannot_see_the_row_being_inserted.sql`](20260913144704_a_policy_that_re_reads_the_row_cannot_see_the_row_being_inserted.sql) |
| 204 | 2026-09-13 | The notices menu item never carried a badge | [`20260913145725_the_notices_menu_item_never_carried_a_badge.sql`](20260913145725_the_notices_menu_item_never_carried_a_badge.sql) |
| 205 | 2026-09-13 | Opening a notice is how its badge clears | [`20260913145808_opening_a_notice_is_how_its_badge_clears.sql`](20260913145808_opening_a_notice_is_how_its_badge_clears.sql) |
| 206 | 2026-09-13 | Say which category the unread notices are in | [`20260913151440_say_which_category_the_unread_notices_are_in.sql`](20260913151440_say_which_category_the_unread_notices_are_in.sql) |
| 207 | 2026-09-13 | A badge for a conversation that ended can never be cleared | [`20260913163027_a_badge_for_a_conversation_that_ended_can_never_be_cleared.sql`](20260913163027_a_badge_for_a_conversation_that_ended_can_never_be_cleared.sql) |
| 208 | 2026-09-13 | One response is enough to show feedback analytics | [`20260913163700_one_response_is_enough_to_show_feedback_analytics.sql`](20260913163700_one_response_is_enough_to_show_feedback_analytics.sql) |
| 209 | 2026-09-19 | Ask the semester question once per batch not once per student | [`20260919141541_ask_the_semester_question_once_per_batch_not_once_per_student.sql`](20260919141541_ask_the_semester_question_once_per_batch_not_once_per_student.sql) |
| 210 | 2026-09-19 | Count attendance in the database not the browser | [`20260919143408_count_attendance_in_the_database_not_the_browser.sql`](20260919143408_count_attendance_in_the_database_not_the_browser.sql) |
| 211 | 2026-09-19 | Ask who the caller is once per query not once per row | [`20260919144538_ask_who_the_caller_is_once_per_query_not_once_per_row.sql`](20260919144538_ask_who_the_caller_is_once_per_query_not_once_per_row.sql) |
| 212 | 2026-09-19 | Index the foreign keys that are actually looked up | [`20260919144603_index_the_foreign_keys_that_are_actually_looked_up.sql`](20260919144603_index_the_foreign_keys_that_are_actually_looked_up.sql) |
| 213 | 2026-09-19 | One register whoever marks it | [`20260919163729_one_register_whoever_marks_it.sql`](20260919163729_one_register_whoever_marks_it.sql) |
| 214 | 2026-09-19 | Attendance offerings name the batch column | [`20260919163813_attendance_offerings_name_the_batch_column.sql`](20260919163813_attendance_offerings_name_the_batch_column.sql) |
| 215 | 2026-09-20 | The minors as the handbook describes them | [`20260920095437_the_minors_as_the_handbook_describes_them.sql`](20260920095437_the_minors_as_the_handbook_describes_them.sql) |
| 216 | 2026-09-20 | An offering says whether it is this semester | [`20260920101028_an_offering_says_whether_it_is_this_semester.sql`](20260920101028_an_offering_says_whether_it_is_this_semester.sql) |
| 217 | 2026-09-20 | A feedback round carries its own dates and cohort | [`20260920104731_a_feedback_round_carries_its_own_dates_and_cohort.sql`](20260920104731_a_feedback_round_carries_its_own_dates_and_cohort.sql) |
| 218 | 2026-09-20 | A result belongs to the delivery it was earned in | [`20260920111604_a_result_belongs_to_the_delivery_it_was_earned_in.sql`](20260920111604_a_result_belongs_to_the_delivery_it_was_earned_in.sql) |
| 219 | 2026-09-20 | Internal helpers are not for callers | [`20260920113249_internal_helpers_are_not_for_callers.sql`](20260920113249_internal_helpers_are_not_for_callers.sql) |
| 220 | 2026-09-20 | A minor is a name two tables have to agree on | [`20260920141344_a_minor_is_a_name_two_tables_have_to_agree_on.sql`](20260920141344_a_minor_is_a_name_two_tables_have_to_agree_on.sql) |
| 221 | 2026-09-20 | A lecturer shapes the form for their own course | [`20260920141531_a_lecturer_shapes_the_form_for_their_own_course.sql`](20260920141531_a_lecturer_shapes_the_form_for_their_own_course.sql) |
| 222 | 2026-09-20 | Group the editor sections by key alone | [`20260920141655_group_the_editor_sections_by_key_alone.sql`](20260920141655_group_the_editor_sections_by_key_alone.sql) |
| 223 | 2026-09-20 | Deleting a course may not take records with it | [`20260920144241_deleting_a_course_may_not_take_records_with_it.sql`](20260920144241_deleting_a_course_may_not_take_records_with_it.sql) |
| 224 | 2026-09-20 | Sections can be renamed by whoever owns them | [`20260920145911_sections_can_be_renamed_by_whoever_owns_them.sql`](20260920145911_sections_can_be_renamed_by_whoever_owns_them.sql) |
| 225 | 2026-09-20 | A course form becomes its own the moment it is edited | [`20260920152046_a_course_form_becomes_its_own_the_moment_it_is_edited.sql`](20260920152046_a_course_form_becomes_its_own_the_moment_it_is_edited.sql) |
| 226 | 2026-09-20 | The student answers the form their course holds | [`20260920152137_the_student_answers_the_form_their_course_holds.sql`](20260920152137_the_student_answers_the_form_their_course_holds.sql) |
| 227 | 2026-09-20 | Copy the template row by row | [`20260920152234_copy_the_template_row_by_row.sql`](20260920152234_copy_the_template_row_by_row.sql) |
| 228 | 2026-09-20 | A repeated course counts once | [`20260920160144_a_repeated_course_counts_once.sql`](20260920160144_a_repeated_course_counts_once.sql) |
| 229 | 2026-09-20 | Settle repeats without fighting the resit cap | [`20260920160237_settle_repeats_without_fighting_the_resit_cap.sql`](20260920160237_settle_repeats_without_fighting_the_resit_cap.sql) |
| 230 | 2026-09-20 | A superseded attempt derives no grade point | [`20260920160439_a_superseded_attempt_derives_no_grade_point.sql`](20260920160439_a_superseded_attempt_derives_no_grade_point.sql) |
| 231 | 2026-09-20 | Attendance is counted per delivery | [`20260920191539_attendance_is_counted_per_delivery.sql`](20260920191539_attendance_is_counted_per_delivery.sql) |
| 232 | 2026-09-20 | The academic record counts a repeat once | [`20260920191948_the_academic_record_counts_a_repeat_once.sql`](20260920191948_the_academic_record_counts_a_repeat_once.sql) |
| 233 | 2026-09-20 | The academic record in one query | [`20260920192022_the_academic_record_in_one_query.sql`](20260920192022_the_academic_record_in_one_query.sql) |
| 234 | 2026-09-20 | The academic record rounds a numeric | [`20260920192101_the_academic_record_rounds_a_numeric.sql`](20260920192101_the_academic_record_rounds_a_numeric.sql) |
| 235 | 2026-09-20 | The assistant can tell the attempts apart | [`20260920192351_the_assistant_can_tell_the_attempts_apart.sql`](20260920192351_the_assistant_can_tell_the_attempts_apart.sql) |
| 236 | 2026-09-20 | Admin attendance alerts follow the delivery | [`20260920192508_admin_attendance_alerts_follow_the_delivery.sql`](20260920192508_admin_attendance_alerts_follow_the_delivery.sql) |
| 237 | 2026-09-20 | Staff overviews count a repeat once | [`20260920192551_staff_overviews_count_a_repeat_once.sql`](20260920192551_staff_overviews_count_a_repeat_once.sql) |
| 238 | 2026-09-20 | The admin student list counts a repeat once | [`20260920192647_the_admin_student_list_counts_a_repeat_once.sql`](20260920192647_the_admin_student_list_counts_a_repeat_once.sql) |
| 239 | 2026-09-20 | The mentee overview without the leftover scaffolding | [`20260920192925_the_mentee_overview_without_the_leftover_scaffolding.sql`](20260920192925_the_mentee_overview_without_the_leftover_scaffolding.sql) |
| 240 | 2026-09-21 | A window that never opened can be taken back | [`20260921065412_a_window_that_never_opened_can_be_taken_back.sql`](20260921065412_a_window_that_never_opened_can_be_taken_back.sql) |
| 241 | 2026-09-21 | A mentee who passed the repeat has passed | [`20260921074255_a_mentee_who_passed_the_repeat_has_passed.sql`](20260921074255_a_mentee_who_passed_the_repeat_has_passed.sql) |
| 242 | 2026-09-21 | Department wide teaching is the heads to see | [`20260921074546_department_wide_teaching_is_the_heads_to_see.sql`](20260921074546_department_wide_teaching_is_the_heads_to_see.sql) |
| 243 | 2026-09-21 | The attendance detail returns the sessions it gathered | [`20260921105257_the_attendance_detail_returns_the_sessions_it_gathered.sql`](20260921105257_the_attendance_detail_returns_the_sessions_it_gathered.sql) |
| 244 | 2026-09-21 | A register that was marked is a delivery | [`20260921105425_a_register_that_was_marked_is_a_delivery.sql`](20260921105425_a_register_that_was_marked_is_a_delivery.sql) |
| 245 | 2026-09-27 | The backups have served their purpose | [`20260927052807_the_backups_have_served_their_purpose.sql`](20260927052807_the_backups_have_served_their_purpose.sql) |
| 246 | 2026-09-27 | A signed out caller calls nothing | [`20260927052832_a_signed_out_caller_calls_nothing.sql`](20260927052832_a_signed_out_caller_calls_nothing.sql) |
| 247 | 2026-09-27 | Pgvector lives in extensions and every search path is pinned | [`20260927052924_pgvector_lives_in_extensions_and_every_search_path_is_pinned.sql`](20260927052924_pgvector_lives_in_extensions_and_every_search_path_is_pinned.sql) |
| 248 | 2026-09-27 | A lecturer keeps their own profile and photo | [`20260927121354_a_lecturer_keeps_their_own_profile_and_photo.sql`](20260927121354_a_lecturer_keeps_their_own_profile_and_photo.sql) |
| 249 | 2026-09-27 | A department admin sees the faculty wide feedback round | [`20260927122940_a_department_admin_sees_the_faculty_wide_feedback_round.sql`](20260927122940_a_department_admin_sees_the_faculty_wide_feedback_round.sql) |
| 250 | 2026-09-27 | An admin keeps their own profile and photo | [`20260927142650_an_admin_keeps_their_own_profile_and_photo.sql`](20260927142650_an_admin_keeps_their_own_profile_and_photo.sql) |
| 251 | 2026-09-27 | A removed photo leaves the bucket too | [`20260927143058_a_removed_photo_leaves_the_bucket_too.sql`](20260927143058_a_removed_photo_leaves_the_bucket_too.sql) |
| 252 | 2026-09-30 | A notification says which department it comes from | [`20260930170758_a_notification_says_which_department_it_comes_from.sql`](20260930170758_a_notification_says_which_department_it_comes_from.sql) |
| 253 | 2026-09-30 | The assistant reads the faculty website | [`20260930182749_the_assistant_reads_the_faculty_website.sql`](20260930182749_the_assistant_reads_the_faculty_website.sql) |
| 254 | 2026-09-30 | Enable pg net for the website schedule | [`20260930184132_enable_pg_net_for_the_website_schedule.sql`](20260930184132_enable_pg_net_for_the_website_schedule.sql) |
| 255 | 2026-09-30 | The faculty website is read every night | [`20260930185937_the_faculty_website_is_read_every_night.sql`](20260930185937_the_faculty_website_is_read_every_night.sql) |
| 256 | 2026-09-30 | The website search prefers sections matching more of the question | [`20260930190944_the_website_search_prefers_sections_matching_more_of_the_question.sql`](20260930190944_the_website_search_prefers_sections_matching_more_of_the_question.sql) |
| 257 | 2026-10-01 | A minor is the study plan the faculty publishes | [`20261001055233_a_minor_is_the_study_plan_the_faculty_publishes.sql`](20261001055233_a_minor_is_the_study_plan_the_faculty_publishes.sql) |
| 258 | 2026-10-01 | A course is enrolled in the year of the semester offering it | [`20261001061923_a_course_is_enrolled_in_the_year_of_the_semester_offering_it.sql`](20261001061923_a_course_is_enrolled_in_the_year_of_the_semester_offering_it.sql) |
| 259 | 2026-10-01 | A minor project is a semester 6 course and a semester 7 course | [`20261001062618_a_minor_project_is_a_semester_6_course_and_a_semester_7_course.sql`](20261001062618_a_minor_project_is_a_semester_6_course_and_a_semester_7_course.sql) |
| 260 | 2026-10-01 | A removed student lets go of feedback and reviews | [`20261001182050_a_removed_student_lets_go_of_feedback_and_reviews.sql`](20261001182050_a_removed_student_lets_go_of_feedback_and_reviews.sql) |
| 261 | 2026-10-01 | The super admin sees every batch | [`20261001182254_the_super_admin_sees_every_batch.sql`](20261001182254_the_super_admin_sees_every_batch.sql) |
| 262 | 2026-10-01 | What removing a batch would take with it | [`20261001182311_what_removing_a_batch_would_take_with_it.sql`](20261001182311_what_removing_a_batch_would_take_with_it.sql) |
| 263 | 2026-10-01 | A batch records can be kept before it goes | [`20261001182327_a_batch_records_can_be_kept_before_it_goes.sql`](20261001182327_a_batch_records_can_be_kept_before_it_goes.sql) |
| 264 | 2026-10-01 | A new batch is divided into departments later | [`20261001183210_a_new_batch_is_divided_into_departments_later.sql`](20261001183210_a_new_batch_is_divided_into_departments_later.sql) |
| 265 | 2026-10-02 | Accounts are invited reset and deactivated | [`20261002082754_accounts_are_invited_reset_and_deactivated.sql`](20261002082754_accounts_are_invited_reset_and_deactivated.sql) |
| 266 | 2026-10-02 | An account without a password has not been set up | [`20261002083150_an_account_without_a_password_has_not_been_set_up.sql`](20261002083150_an_account_without_a_password_has_not_been_set_up.sql) |
| 267 | 2026-10-28 | A course taught over two semesters is graded once | [`20261028113540_a_course_taught_over_two_semesters_is_graded_once.sql`](20261028113540_a_course_taught_over_two_semesters_is_graded_once.sql) |
| 268 | 2026-10-28 | A result still reports its credits as credits | [`20261028114641_a_result_still_reports_its_credits_as_credits.sql`](20261028114641_a_result_still_reports_its_credits_as_credits.sql) |
