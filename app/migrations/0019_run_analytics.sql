-- Analytics are worked out once, during Compute (in the browser: Cloudflare's free plan gives a request 10 ms of CPU, and
-- adding up every result's papers took about 50 ms), and stored with the run. The Analytics pages then only read them.
--   analytics        JSON { releasable, all } as the session Analytics page shows them
--   analytics_cycle  JSON cycle parts (counts and GPAs per programme) that a cycle's overview combines across sessions
ALTER TABLE runs ADD COLUMN analytics TEXT;
ALTER TABLE runs ADD COLUMN analytics_cycle TEXT;
