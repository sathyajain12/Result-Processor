-- Editable student page: marks and student details can be overridden like course values.
-- SQLite cannot widen a CHECK constraint in place, so the overrides table is rebuilt.
-- sheet_value keeps what the source sheet said, so the page can show it and flag when the sheet changes.
CREATE TABLE overrides_new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('accept', 'exclude-paper', 'skip-validation', 'exclude-student', 'student-batch', 'course-field', 'mark', 'student-field')),
  code        TEXT,
  batch_key   TEXT,
  regd_no     TEXT,
  paper_code  TEXT,
  field       TEXT,
  value       TEXT,
  sheet_value TEXT,
  reason      TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_by  TEXT,
  revoked_at  TEXT
);
INSERT INTO overrides_new (id, session_id, type, code, batch_key, regd_no, paper_code, field, value, reason, created_by, created_at, revoked_by, revoked_at)
  SELECT id, session_id, type, code, batch_key, regd_no, paper_code, field, value, reason, created_by, created_at, revoked_by, revoked_at FROM overrides;
DROP TABLE overrides;
ALTER TABLE overrides_new RENAME TO overrides;
CREATE INDEX overrides_active ON overrides (session_id, revoked_at);
