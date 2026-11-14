-- CIE and ESE are fetched separately: each run records which one it covered (NULL = both, e.g. the morning check).
ALTER TABLE marksheet_runs ADD COLUMN component TEXT CHECK (component IN ('CIE', 'ESE'));
