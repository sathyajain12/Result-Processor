-- Supplementary sessions: a supplementary session builds on one regular session's published results and publishes its own.
ALTER TABLE exam_sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'regular' CHECK (kind IN ('regular', 'supplementary'));
ALTER TABLE exam_sessions ADD COLUMN base_session_id TEXT REFERENCES exam_sessions(id);
CREATE INDEX exam_sessions_base ON exam_sessions (base_session_id);
