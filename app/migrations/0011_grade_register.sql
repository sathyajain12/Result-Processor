-- Grade register: the results processing team uploads the result workbook (Consolidated Result + FinalOutput),
-- the publishing team generates the register (port of test_excel_processor_workingV4.py) and forwards it,
-- and the checking team checks each student against the Marks Statements.

-- Teams a person belongs to, comma separated: results, publishing, checking. Admins can act for every team.
ALTER TABLE users ADD COLUMN teams TEXT NOT NULL DEFAULT '';

-- One row per uploaded workbook. A corrected upload is a new version; the latest one is the register.
CREATE TABLE grade_registers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    TEXT NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
  version       INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'generated', 'checking', 'checked', 'superseded')),
  file_name     TEXT,
  papers        INTEGER NOT NULL DEFAULT 0,
  students      INTEGER NOT NULL DEFAULT 0,
  warnings      TEXT,                  -- JSON list, from upload and generate
  uploaded_by   TEXT NOT NULL,
  uploaded_at   TEXT NOT NULL DEFAULT (datetime('now')),
  generated_by  TEXT,
  generated_at  TEXT,
  forwarded_by  TEXT,
  forwarded_at  TEXT,
  completed_at  TEXT,
  UNIQUE (session_id, version)
);

-- Consolidated Result rows: the 12 columns the script keeps, as uploaded (no declared type keeps numbers and letters).
CREATE TABLE grade_register_papers (
  register_id  INTEGER NOT NULL REFERENCES grade_registers(id) ON DELETE CASCADE,
  row_no       INTEGER NOT NULL,
  regd_no      TEXT NOT NULL,
  paper_code   TEXT,
  cie_marks, cie_pct, cie_np, ese_marks, ese_pct, ese_np, comb_pct, comb_np, credits, credit_np,
  PRIMARY KEY (register_id, row_no)
);
CREATE INDEX grade_register_papers_student ON grade_register_papers (register_id, regd_no);

-- One row per student: the FinalOutput values, and (after generate) the totals added up from the paper rows.
CREATE TABLE grade_register_students (
  register_id     INTEGER NOT NULL REFERENCES grade_registers(id) ON DELETE CASCADE,
  regd_no         TEXT NOT NULL,
  in_final        INTEGER NOT NULL DEFAULT 0,
  sum_credits,                          -- FinalOutput "Sum of Credits"
  sum_credit_np,                        -- FinalOutput "Sum of (Credit * COMB NP)"
  published_gpa,
  letter_grade,
  calc_credits    REAL,                 -- added up from the paper rows at generate
  calc_credit_np  REAL,
  digest          TEXT,                 -- of the student's rows, to carry checks over to a corrected upload
  PRIMARY KEY (register_id, regd_no)
);

-- The checking team's verdict per student.
CREATE TABLE grade_register_checks (
  register_id  INTEGER NOT NULL REFERENCES grade_registers(id) ON DELETE CASCADE,
  regd_no      TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('ok', 'flagged')),
  comment      TEXT,
  checked_by   TEXT NOT NULL,
  checked_at   TEXT NOT NULL DEFAULT (datetime('now')),
  carried      INTEGER NOT NULL DEFAULT 0,   -- 1 when copied from the previous version (rows unchanged)
  PRIMARY KEY (register_id, regd_no)
);
