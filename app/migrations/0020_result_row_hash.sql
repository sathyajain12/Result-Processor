-- A fingerprint of each saved result (sha256 of the whole row, as the browser saves it). A new Compute compares its results
-- with the latest run's fingerprints and sends only the students whose result changed; the database copies the rest
-- from the latest run. Results saved before this column existed have none, so the first Compute after it saves them all.
ALTER TABLE student_results ADD COLUMN row_hash TEXT;
