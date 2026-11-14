-- Examination cycles group exam sessions (e.g. "April 2026" → ESE Regular, Supplementary, Re-evaluation).
-- Grouping only: each session keeps its own sources, marks, runs and publications.
CREATE TABLE exam_cycles (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  created_by  TEXT
);

ALTER TABLE exam_sessions ADD COLUMN cycle_id TEXT REFERENCES exam_cycles(id) ON DELETE SET NULL;
CREATE INDEX exam_sessions_cycle ON exam_sessions (cycle_id);
