-- Mark sheets can come from a Google Drive folder of Marks Statements instead of a course master
-- ('folder': spreadsheet_id then holds the folder id; its subfolders are walked too).
ALTER TABLE marksheet_masters ADD COLUMN kind TEXT NOT NULL DEFAULT 'master' CHECK (kind IN ('master', 'folder'));
