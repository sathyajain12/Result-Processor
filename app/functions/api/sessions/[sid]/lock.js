import { json, readJson, HttpError } from "../../../_lib/http.js";
import { first, run, audit } from "../../../_lib/db.js";
import { requireRole } from "../../../_lib/auth.js";

export async function onRequestPost({ env, request, params, data }) {
  requireRole(data.user, "admin");
  const body = await readJson(request);
  const lock = !!body.locked;
  const session = await first(env.DB, "SELECT id, status FROM exam_sessions WHERE id = ?", params.sid);
  if (!session) throw new HttpError(404, "Session not found");
  if ((session.status === "closed") === lock) throw new HttpError(409, `Session is already ${lock ? "locked" : "unlocked"}`);
  const reason = (body.reason || "").trim() || null;
  if (lock) {
    await run(env.DB, "UPDATE exam_sessions SET status = 'closed', closed_at = datetime('now'), closed_by = ?, close_reason = ? WHERE id = ?", data.user.email, reason, session.id);
  } else {
    await run(env.DB, "UPDATE exam_sessions SET status = 'open', closed_at = NULL, closed_by = NULL, close_reason = NULL WHERE id = ?", session.id);
  }
  await audit(env.DB, data.user.email, session.id, lock ? "lock" : "unlock", session.id, reason ? { reason } : null);
  return json({ ok: true, status: lock ? "closed" : "open" });
}
