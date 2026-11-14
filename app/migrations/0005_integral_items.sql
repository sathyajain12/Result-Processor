-- Integral Items report (port of populateIntegralItems). Kept apart from `sources`: it is a multi-file report that does not feed the engine.
CREATE TABLE integral_items (
  session_id   TEXT NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
  regd_no      TEXT NOT NULL,
  int1         TEXT,
  int2         TEXT,
  int3         TEXT,
  int4         TEXT,
  int5         TEXT,
  total        REAL NOT NULL,
  items        INTEGER NOT NULL,
  source_file  TEXT,
  PRIMARY KEY (session_id, regd_no)
);

CREATE TABLE integral_imports (
  session_id  TEXT PRIMARY KEY REFERENCES exam_sessions(id) ON DELETE CASCADE,
  loaded_at   TEXT,
  loaded_by   TEXT,
  files       TEXT,
  links       TEXT,
  warnings    TEXT,
  row_count   INTEGER
);
