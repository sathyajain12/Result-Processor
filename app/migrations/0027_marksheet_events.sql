-- Morning summary: what each fetch run changed, sheet by sheet. A row is written only when a sheet's status changes
-- (newly certified, reopened, lost access…) or its marks change, so a morning check that re-reads unchanged sheets writes
-- nothing here. The marks corrections themselves stay in mark_changes, tagged 'marksheet:<run id>'.
CREATE TABLE IF NOT EXISTS marksheet_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id   TEXT NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
  run_id       INTEGER NOT NULL,
  at           TEXT NOT NULL DEFAULT (datetime('now')),
  sheet_key    TEXT NOT NULL,
  component    TEXT,
  campus       TEXT,
  course_code  TEXT,
  from_status  TEXT,
  to_status    TEXT NOT NULL,
  added        INTEGER NOT NULL DEFAULT 0,
  changed      INTEGER NOT NULL DEFAULT 0,
  removed      INTEGER NOT NULL DEFAULT 0,
  error        TEXT
);
CREATE INDEX IF NOT EXISTS marksheet_events_run ON marksheet_events (run_id);

-- The summary lists one run's corrections; without this, finding them read every correction ever made in the session.
CREATE INDEX IF NOT EXISTS mark_changes_sync ON mark_changes (sync_id);
