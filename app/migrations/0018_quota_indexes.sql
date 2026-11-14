-- Spend the daily D1 limits where they matter. Writes are the tightest limit, so this drops an index that added a write for every
-- student on every Compute; a batch page reads a little more instead. It adds one that only changes when an issue does, which
-- saves scanning every issue on each student page.
DROP INDEX IF EXISTS student_results_batch;
CREATE INDEX IF NOT EXISTS exceptions_student ON exceptions (session_id, regd_no);
