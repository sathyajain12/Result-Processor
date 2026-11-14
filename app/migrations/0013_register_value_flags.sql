-- The checking team flags individual values (a mark, percent, NP, credits, a total, the GPA or grade) with a comment.
-- paper_code is '' for a value on the student's summary row.
CREATE TABLE grade_register_flags (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  register_id  INTEGER NOT NULL REFERENCES grade_registers(id) ON DELETE CASCADE,
  regd_no      TEXT NOT NULL,
  paper_code   TEXT NOT NULL DEFAULT '',
  field        TEXT NOT NULL,
  value        TEXT,                 -- the value as it was when flagged
  comment      TEXT NOT NULL,
  flagged_by   TEXT NOT NULL,
  flagged_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (register_id, regd_no, paper_code, field)
);
