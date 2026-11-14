-- The office's reason a student is detained (attendance shortage, failed semester, medical, gap year, ...), per session.
CREATE TABLE detention_reasons (
  session_id  TEXT NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
  regd_no     TEXT NOT NULL,
  reason      TEXT NOT NULL,
  updated_by  TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (session_id, regd_no)
);
