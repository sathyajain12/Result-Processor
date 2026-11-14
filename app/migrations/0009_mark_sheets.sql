-- Mark sheets: the portal reads the course masters (never writes to them), lists every teacher's
-- Marks Statement, and fetches certified marks straight into the session. Replaces the Fetch CIE /
-- Fetch ESE scripts and their Tracking and Aggregate sheets.

-- Course master files linked to a session (one per campus for CIE, one for ESE).
CREATE TABLE marksheet_masters (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id      TEXT NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
  component       TEXT NOT NULL CHECK (component IN ('CIE', 'ESE')),
  campus          TEXT,
  spreadsheet_id  TEXT NOT NULL,
  sheet_name      TEXT,
  title           TEXT,
  last_read_at    TEXT,
  row_count       INTEGER,
  last_error      TEXT,
  created_by      TEXT,
  UNIQUE (session_id, component, spreadsheet_id)
);

-- One row per teacher's Marks Statement (the old Tracking Sheet), built from the course masters.
CREATE TABLE marksheets (
  session_id       TEXT NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
  key              TEXT NOT NULL,          -- component|campus|file id (or row number when no file)
  master_id        INTEGER,
  component        TEXT NOT NULL CHECK (component IN ('CIE', 'ESE')),
  campus           TEXT,
  programme        TEXT,
  course_code      TEXT,
  course_title     TEXT,
  course_type      TEXT,
  semester         TEXT,
  teacher_name     TEXT,
  teacher_email    TEXT,
  max_marks        REAL,
  due_date         TEXT,
  exam_date        TEXT,
  file_url         TEXT,
  spreadsheet_id   TEXT,
  in_master        INTEGER NOT NULL DEFAULT 1, -- 0 once the row disappears from the course master
  status           TEXT NOT NULL DEFAULT 'pending',
  certified        INTEGER,
  all_filled       INTEGER,
  validated        INTEGER,
  paper_code       TEXT,                   -- as written in the Marks Statement
  students         INTEGER,
  marks_count      INTEGER,
  regd_nos         TEXT,                   -- JSON: students whose marks came from this sheet last time
  last_checked_at  TEXT,
  last_fetched_at  TEXT,
  last_changes     INTEGER,
  last_error       TEXT,
  PRIMARY KEY (session_id, key)
);
CREATE INDEX marksheets_check ON marksheets (session_id, last_checked_at);

-- Each fetch run, manual or daily, with what it found.
CREATE TABLE marksheet_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
  trigger     TEXT NOT NULL CHECK (trigger IN ('manual', 'daily')),
  started_at  TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  checked     INTEGER NOT NULL DEFAULT 0,
  fetched     INTEGER NOT NULL DEFAULT 0,
  changed     INTEGER NOT NULL DEFAULT 0,
  errors      INTEGER NOT NULL DEFAULT 0,
  by          TEXT
);

-- 1 when fetched marks changed since the last compute (the daily run recomputes then).
ALTER TABLE exam_sessions ADD COLUMN marks_dirty INTEGER NOT NULL DEFAULT 0;
