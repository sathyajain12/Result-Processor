-- The CIE / ESE marks list pages through a component's rows in this order. Without an index the database read and sorted
-- every row of the component for each page of 200; with it a page reads only the rows up to that page.
CREATE INDEX IF NOT EXISTS marksheet_rows_order ON marksheet_rows (session_id, component, programme, semester, course_code, campus, row_no, regd_no);
