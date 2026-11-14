-- The fetched rows of each Marks Statement as the sheet shows them (the old CIE / ESE Aggregate Sheets):
-- marks, percent and num. points from the sheet's ciePercent/cieNP (esePercent/eseNP) columns, and the
-- programme and semester from columns A and B. Replaced on every fetch of that sheet.
-- marks, percent and num_points have no declared type so numbers and letters (A, L) are kept as written.
CREATE TABLE marksheet_rows (
  session_id   TEXT NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
  component    TEXT NOT NULL CHECK (component IN ('CIE', 'ESE')),
  sheet_key    TEXT NOT NULL,
  regd_no      TEXT NOT NULL,
  course_code  TEXT NOT NULL,
  campus       TEXT,
  marks,
  percent,
  num_points,
  programme    TEXT,
  semester     TEXT,
  row_no       INTEGER,
  PRIMARY KEY (session_id, component, sheet_key, regd_no)
);
CREATE INDEX marksheet_rows_list ON marksheet_rows (session_id, component, course_code, regd_no);
