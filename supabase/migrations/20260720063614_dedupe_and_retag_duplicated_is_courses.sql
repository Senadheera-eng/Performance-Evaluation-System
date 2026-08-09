-- dedupe_and_retag_duplicated_is_courses
-- Applied 20260720063614
-- Exported from the live project; do not edit by hand.


-- Delete unreferenced duplicate rows for IS3171, IS3175, IS4161, IS4171
DELETE FROM courses WHERE id IN (
  '113fc666-e2b2-4043-80c5-903cb7c4dc5b',
  '968f2a37-4940-4ec3-b8fe-43e0faf523d8',
  '73ab8002-8ae2-4dcb-b34b-b62a9260825d',
  '7918cc44-e6a3-4944-8260-5cd2d8582089',
  '7bcb3f70-2199-4afd-9dfc-f0295e40b563',
  '75c8f7d6-be51-4c91-b546-518275b9093a',
  'bfe6e22c-a093-42d5-baca-c769e4b6ca61',
  'd24ca204-f2f9-4a9b-ba10-666a9dacc7e7',
  'f253f5b0-b773-478c-aa06-133012e4f57f',
  'df7879b5-1b60-4dcd-ae38-103bc4109b7c',
  'ffa510e9-5bf4-4dd1-b212-816849ad07ea',
  '5e67be3f-24ac-450a-9810-0d0416ae89db'
);

-- Retag the surviving canonical row for each course to Interdisciplinary Studies
UPDATE courses SET department = 'Interdisciplinary Studies'
WHERE id IN (
  '8034a3cd-8d62-4aef-b7e4-47d62931a2f7', -- IS3171
  '700c1bf1-1915-4bad-9d36-77cad54ed16a', -- IS3175
  'a1a03456-1cf2-46b0-84e0-3e6fca8b8308', -- IS4161
  '46581e4e-d731-4382-bd75-28b6d249b975'  -- IS4171
);
