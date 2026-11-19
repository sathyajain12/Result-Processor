-- Morning summary: a correction (a mark a teacher changed after it was fetched) ticked as reviewed by the office.
-- One row per reviewed correction; unticking deletes it. Each tick or untick is also in the audit log.
CREATE TABLE IF NOT EXISTS correction_reviews (
  change_id    INTEGER PRIMARY KEY,   -- mark_changes.id
  session_id   TEXT NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
  reviewed_by  TEXT NOT NULL,
  reviewed_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
