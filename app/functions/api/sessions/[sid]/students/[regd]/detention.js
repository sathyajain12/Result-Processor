import { json, readJson, HttpError } from "../../../../../_lib/http.js";
import { first, run, audit } from "../../../../../_lib/db.js";
import { requireRole } from "../../../../../_lib/auth.js";

// The reason a student is detained, as recorded by the office. It is shown beside the portal's own explanation
// (worked out from the batch data) in Completeness, Issues and on the student's page.
export async function onRequestPut({ env, request, params, data }) {
  requireRole(data.user, "operator");
  const reason = String((await readJson(request)).reason || "").trim();
  if (!reason) throw new HttpError(400, "Write the reason, or remove it instead");
  if (reason.length > 500) throw new HttpError(400, "Keep the reason under 500 characters");
  const s = await first(env.DB, "SELECT regd_no FROM students WHERE session_id = ? AND regd_no = ?", params.sid, params.regd);
  if (!s) throw new HttpError(404, `${params.regd} is not in this session`);
  await run(env.DB, `INSERT INTO detention_reasons (session_id, regd_no, reason, updated_by) VALUES (?,?,?,?)
    ON CONFLICT (session_id, regd_no) DO UPDATE SET reason = excluded.reason, updated_by = excluded.updated_by, updated_at = datetime('now')`,
    params.sid, params.regd, reason, data.user.email);
  await audit(env.DB, data.user.email, params.sid, "detention-reason", params.regd, { reason });
  return json({ ok: true });
}

export async function onRequestDelete({ env, params, data }) {
  requireRole(data.user, "operator");
  await run(env.DB, "DELETE FROM detention_reasons WHERE session_id = ? AND regd_no = ?", params.sid, params.regd);
  await audit(env.DB, data.user.email, params.sid, "detention-reason-removed", params.regd, null);
  return json({ ok: true });
}
