PRAGMA foreign_keys = ON;

CREATE TABLE users (
  email       TEXT PRIMARY KEY,
  name        TEXT,
  role        TEXT NOT NULL CHECK (role IN ('admin', 'operator', 'viewer')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE np_tables (
  code  TEXT NOT NULL,
  ll    REAL NOT NULL,
  np    TEXT NOT NULL,
  PRIMARY KEY (code, ll)
);

CREATE TABLE grade_tables (
  code       TEXT NOT NULL,
  ll         REAL NOT NULL,
  ul         REAL NOT NULL,
  letter     TEXT NOT NULL,
  qualifier  TEXT NOT NULL,
  PRIMARY KEY (code, ll)
);

CREATE TABLE weightage_categories (
  category  INTEGER PRIMARY KEY,
  cie       REAL NOT NULL,
  ese       REAL NOT NULL
);

CREATE TABLE programmes (
  code             TEXT PRIMARY KEY,
  name             TEXT,
  pass_category    INTEGER NOT NULL DEFAULT 1,
  cie_np           TEXT NOT NULL DEFAULT 'I-A',
  ese_np           TEXT NOT NULL DEFAULT 'I-A',
  comb_np          TEXT NOT NULL DEFAULT 'I-A',
  grade_table      TEXT,
  customised       INTEGER NOT NULL DEFAULT 0,
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by       TEXT
);

CREATE TABLE exam_sessions (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  thresholds  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  created_by  TEXT
);

CREATE TABLE sources (
  session_id      TEXT NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('CIE', 'ESE', 'CMF', 'SMF', 'PREV')),
  spreadsheet_id  TEXT,
  sheet_name      TEXT,
  last_synced_at  TEXT,
  last_synced_by  TEXT,
  row_count       INTEGER,
  checksum        TEXT,
  warnings        TEXT,
  PRIMARY KEY (session_id, kind)
);

CREATE TABLE courses (
  session_id      TEXT NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
  code            TEXT NOT NULL,
  base_code       TEXT NOT NULL,
  title           TEXT,
  programmes      TEXT NOT NULL,
  semester        TEXT,
  batches         TEXT,
  category        TEXT,
  credits         REAL,
  cie_max         REAL,
  ese_max         REAL,
  cie_weight      REAL,
  ese_weight      REAL,
  calc_type       INTEGER,
  course_type     TEXT,
  teaching_dept   TEXT,
  sequence        TEXT,
  PRIMARY KEY (session_id, code)
);
CREATE INDEX courses_base ON courses (session_id, base_code);

CREATE TABLE students (
  session_id   TEXT NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
  regd_no      TEXT NOT NULL,
  name         TEXT,
  campus       TEXT,
  programme    TEXT,
  semester     TEXT,
  batch        TEXT,
  sem_credits  REAL,
  electives    TEXT,
  PRIMARY KEY (session_id, regd_no)
);
CREATE INDEX students_batch ON students (session_id, programme, semester, batch);

CREATE TABLE previous_semesters (
  session_id   TEXT NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
  regd_no      TEXT NOT NULL,
  semester_no  INTEGER NOT NULL,
  credit_np    REAL,
  credits      REAL,
  gpa          REAL,
  PRIMARY KEY (session_id, regd_no, semester_no)
);

CREATE TABLE marks (
  session_id   TEXT NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
  regd_no      TEXT NOT NULL,
  paper_code   TEXT NOT NULL,
  component    TEXT NOT NULL CHECK (component IN ('CIE', 'ESE')),
  raw          TEXT,
  first_seen   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (session_id, regd_no, paper_code, component)
);

CREATE TABLE mark_changes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
  regd_no     TEXT NOT NULL,
  paper_code  TEXT NOT NULL,
  component   TEXT NOT NULL,
  old_raw     TEXT,
  new_raw     TEXT,
  changed_at  TEXT NOT NULL DEFAULT (datetime('now')),
  sync_id     TEXT
);
CREATE INDEX mark_changes_student ON mark_changes (session_id, regd_no);

CREATE TABLE overrides (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('accept', 'exclude-paper', 'skip-validation', 'exclude-student', 'student-batch', 'course-field')),
  code        TEXT,
  batch_key   TEXT,
  regd_no     TEXT,
  paper_code  TEXT,
  field       TEXT,
  value       TEXT,
  reason      TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_by  TEXT,
  revoked_at  TEXT
);
CREATE INDEX overrides_active ON overrides (session_id, revoked_at);

CREATE TABLE runs (
  id              TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
  started_at      TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at     TEXT,
  triggered_by    TEXT,
  engine_version  TEXT,
  policy          TEXT,
  summary         TEXT,
  status          TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'failed'))
);
CREATE INDEX runs_session ON runs (session_id, started_at);

CREATE TABLE batches (
  session_id  TEXT NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
  id          INTEGER NOT NULL,
  key         TEXT NOT NULL,
  programme   TEXT,
  semester    TEXT,
  batch       TEXT,
  run_id      TEXT,
  stats       TEXT,
  PRIMARY KEY (session_id, id),
  UNIQUE (session_id, key)
);

CREATE TABLE student_results (
  run_id          TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  session_id      TEXT NOT NULL,
  regd_no         TEXT NOT NULL,
  batch_key       TEXT NOT NULL,
  state           TEXT NOT NULL,
  releasable      INTEGER NOT NULL,
  sum_credits     REAL,
  sum_credit_np   REAL,
  calculated_gpa  REAL,
  published_gpa   TEXT,
  letter_grade    TEXT,
  qualifier       TEXT,
  is_absent       INTEGER,
  failed_courses  TEXT,
  reasons         TEXT,
  digest          TEXT NOT NULL,
  papers          TEXT NOT NULL,
  PRIMARY KEY (run_id, regd_no)
);
CREATE INDEX student_results_batch ON student_results (run_id, batch_key);

CREATE TABLE exceptions (
  session_id  TEXT NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  run_id      TEXT NOT NULL,
  code        TEXT NOT NULL,
  severity    TEXT NOT NULL,
  batch_key   TEXT,
  regd_no     TEXT,
  paper_code  TEXT,
  course_code TEXT,
  message     TEXT NOT NULL,
  details     TEXT,
  accepted    INTEGER NOT NULL DEFAULT 0,
  first_seen  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (session_id, key)
);
CREATE INDEX exceptions_batch ON exceptions (session_id, batch_key, severity);

CREATE TABLE exception_notes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL,
  key         TEXT NOT NULL,
  note        TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE approvals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
  batch_key   TEXT NOT NULL,
  run_id      TEXT NOT NULL,
  action      TEXT NOT NULL CHECK (action IN ('approve', 'revoke')),
  regd_nos    TEXT NOT NULL,
  note        TEXT,
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX approvals_batch ON approvals (session_id, batch_key);

CREATE TABLE published_results (
  session_id    TEXT NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
  regd_no       TEXT NOT NULL,
  version       INTEGER NOT NULL,
  run_id        TEXT NOT NULL,
  digest        TEXT NOT NULL,
  result        TEXT NOT NULL,
  published_by  TEXT NOT NULL,
  published_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (session_id, regd_no, version)
);

CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT NOT NULL DEFAULT (datetime('now')),
  actor      TEXT NOT NULL,
  session_id TEXT,
  action     TEXT NOT NULL,
  entity     TEXT,
  detail     TEXT
);
CREATE INDEX audit_session ON audit_log (session_id, at);
