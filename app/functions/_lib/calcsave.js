import { HttpError } from "./http.js";
import { first, run } from "./db.js";
import { requireRole } from "./auth.js";
import { assertOpen } from "./lock.js";

// Shared by the calc/ endpoints the browser saves a Compute through: only operators, only an open session, and only a
// run of this session that is still being saved (or, for an unchanged Compute, the latest finished run).
export async function saving(env, params, data, runId, { allowDone = false } = {}) {
  requireRole(data.user, "operator");
  const db = env.DB;
  await assertOpen(db, params.sid);
  if (!runId) throw new HttpError(400, "runId is required");
  const r = await first(db, "SELECT id, status, summary FROM runs WHERE id = ? AND session_id = ?", runId, params.sid);
  if (!r) throw new HttpError(404, "This Compute was not found; run Compute again");
  if (r.status === "failed" || (r.status === "done" && !allowDone)) throw new HttpError(409, "This Compute is no longer being saved; run Compute again");
  return { db, runRow: r };
}

// A run left half-saved (the browser closed mid-way) is marked failed after this long, so it never counts.
export const STALE_MINUTES = 15;
export const clearStale = (db, sessionId) => run(db,
  `UPDATE runs SET status = 'failed', finished_at = datetime('now'), summary = '{"error":"Not finished: the page was closed or lost its connection while saving"}'
   WHERE session_id = ? AND status = 'running' AND started_at < datetime('now', ?)`, sessionId, `-${STALE_MINUTES} minutes`);
