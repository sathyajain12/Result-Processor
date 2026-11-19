-- The CIE / ESE marks list's search finds the Regd Nos that begin with what was typed through this index, so a search
-- reads only the matching rows instead of every row of the component (about 10,000 a search, twice: page and count).
-- Course codes are found through marksheet_rows_list (session_id, component, course_code, regd_no).
CREATE INDEX IF NOT EXISTS marksheet_rows_regd ON marksheet_rows (session_id, component, regd_no);
