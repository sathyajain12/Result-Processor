import { json, readJson, HttpError } from "../../../../_lib/http.js";
import { all, audit, batchInsert } from "../../../../_lib/db.js";
import { requireRole } from "../../../../_lib/auth.js";

// Morning summary: tick (or untick) corrections as reviewed. Body: { ids: [mark_changes.id…], reviewed: true|false, runId }.
// Only corrections of this session are touched. Recorded in the audit log as "review-corrections".
const MAX = 1000;

export async function onRequestPost({ env, params, request, data }) {
  requireRole(data.user, "operator");
  const db = env.DB;
  const body = await readJson(request).catch(() => null);
  const ids = [...new Set((Array.isArray(body?.ids) ? body.ids : []).map(Number).filter(n => Number.isInteger(n) && n > 0))];
  if (!ids.length) throw new HttpError(400, "Send the corrections to tick");
  if (ids.length > MAX) throw new HttpError(400, `At most ${MAX} corrections at a time`);
  const reviewed = body.reviewed !== false;

  const valid = [];
  for (let i = 0; i < ids.length; i += 90) {
    const part = ids.slice(i, i + 90);
    valid.push(...(await all(db, `SELECT id FROM mark_changes WHERE session_id = ? AND id IN (${part.map(() => "?").join(",")})`, params.sid, ...part)).map(r => r.id));
  }
  if (!valid.length) throw new HttpError(404, "Those corrections are not in this session");

  await batchInsert(db, valid.map(id => reviewed
    ? db.prepare("INSERT INTO correction_reviews (change_id, session_id, reviewed_by) VALUES (?, ?, ?) ON CONFLICT (change_id) DO NOTHING").bind(id, params.sid, data.user.email)
    : db.prepare("DELETE FROM correction_reviews WHERE change_id = ? AND session_id = ?").bind(id, params.sid)));
  await audit(db, data.user.email, params.sid, "review-corrections", body.runId ? `morning check ${Number(body.runId)}` : null, { reviewed, count: valid.length, ids: valid });
  return json({ ok: true, reviewed, count: valid.length });
}
