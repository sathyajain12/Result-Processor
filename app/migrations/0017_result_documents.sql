-- Result Sheet and Failure List: each programme's full name and degree from the CMF / SMF, and the Failure List
-- details the office fills in on the page.
CREATE TABLE programme_details (
  session_id  TEXT NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,
  name        TEXT,
  short_name  TEXT,
  degree      TEXT,
  PRIMARY KEY (session_id, code)
);

-- Per campus, because the same paper is taught by different people on different campuses.
CREATE TABLE failure_list_papers (
  session_id  TEXT NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
  campus      TEXT NOT NULL,
  paper_code  TEXT NOT NULL,
  taught_by   TEXT,          -- NULL: use the teacher on the CIE mark sheet
  qp_setter   TEXT,
  examiner    TEXT,          -- NULL: use the teacher on the ESE mark sheet
  updated_by  TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (session_id, campus, paper_code)
);

CREATE TABLE failure_list_students (
  session_id           TEXT NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
  regd_no              TEXT NOT NULL,
  previous_university  TEXT,
  previous_cgpa        TEXT,
  updated_by           TEXT NOT NULL,
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (session_id, regd_no)
);
