-- How many CIE / ESE marks rows each sheet has per course, campus and programme: about 1,300 rows, against 14,500 rows of
-- marks. The marks tabs read their totals and filter lists from here; counting marksheet_rows itself read every row of the
-- component on each page load. Rebuilt for a sheet whenever its rows change (rowStatements in _lib/marksheets.js).
CREATE TABLE IF NOT EXISTS marksheet_row_groups (
  session_id  TEXT NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
  component   TEXT NOT NULL,
  sheet_key   TEXT NOT NULL,
  course_code TEXT NOT NULL,
  campus      TEXT,
  programme   TEXT,
  n           INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS marksheet_row_groups_sheet ON marksheet_row_groups (session_id, component, sheet_key);
INSERT INTO marksheet_row_groups (session_id, component, sheet_key, course_code, campus, programme, n)
  SELECT session_id, component, sheet_key, course_code, campus, programme, COUNT(*) FROM marksheet_rows
  GROUP BY session_id, component, sheet_key, course_code, campus, programme;
