-- Locking a session: exam_sessions.status ('open' | 'closed') becomes enforced; these record who closed it and why.
ALTER TABLE exam_sessions ADD COLUMN closed_at TEXT;
ALTER TABLE exam_sessions ADD COLUMN closed_by TEXT;
ALTER TABLE exam_sessions ADD COLUMN close_reason TEXT;
