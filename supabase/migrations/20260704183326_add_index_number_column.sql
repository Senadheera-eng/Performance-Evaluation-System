-- add_index_number_column
-- Applied 20260704183326
-- Exported from the live project; do not edit by hand.

ALTER TABLE students ADD COLUMN IF NOT EXISTS index_number text;
