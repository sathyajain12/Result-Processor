-- Removing a person's access (People page). Anyone with an institute account who signs in is added as a viewer, so
-- deleting the row would not keep them out; instead the row stays, marked removed, and sign-in is refused until an admin
-- restores it. Their past actions stay in the audit log.
ALTER TABLE users ADD COLUMN removed_at TEXT;
ALTER TABLE users ADD COLUMN removed_by TEXT;
