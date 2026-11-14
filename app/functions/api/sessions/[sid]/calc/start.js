import { json, readJson, HttpError } from "../../../../_lib/http.js";
import { first } from "../../../../_lib/db.js";
import { requireRole } from "../../../../_lib/auth.js";
import { assertOpen } from "../../../../_lib/lock.js";
import { startRun } from "../../../../_lib/compute.js";
import { clearStale } from "../../../../_lib/calcsave.js";

// Step 1 of saving a Compute worked out in the browser. With the fingerprint of all its results: if the latest run holds
// exactly these, it stands (nothing to save but batches and issues); otherwise a new run is started for the results.
export async function onRequestPost({ env, params, request, data }) {
  requireRole(data.user, "operator");
  const db = env.DB;
  const session = await first(db, "SELECT id, kind FROM exam_sessions WHERE id = ?", params.sid);
  if (!session) throw new HttpError(404, "Session not found");
  await assertOpen(db, params.sid);
  const { fingerprint } = await readJson(request);
  if (!/^[0-9a-f]{64}$/.test(fingerprint || "")) throw new HttpError(400, "fingerprint is required");
  await clearStale(db, session.id);
  const busy = await first(db, "SELECT triggered_by FROM runs WHERE session_id = ? AND status = 'running' LIMIT 1", session.id);
  if (busy) throw new HttpError(409, `A Compute by ${busy.triggered_by || "someone"} is still being saved; try again in a minute`);
  const { unchanged, runId, latest } = await startRun(db, session, data.user.email, fingerprint);
  // previousRunId: the latest run, whose unchanged results the browser has copied (carry.js) rather than sending them again.
  return json({ unchanged, runId, previousRunId: unchanged ? null : latest?.id ?? null });
}
