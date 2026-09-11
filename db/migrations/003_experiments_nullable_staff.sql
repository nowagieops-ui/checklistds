-- Management logs in with a shared PIN, not an individual marketers row, so
-- an experiment logged by management has no real staff_id to attribute it
-- to. created_by_staff_id was NOT NULL in 002_growth_os.sql; loosen it here
-- rather than editing that already-applied migration.
ALTER TABLE experiments MODIFY COLUMN created_by_staff_id INT NULL;
