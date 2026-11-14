import { json } from "../../../../_lib/http.js";
import { all, parseJson } from "../../../../_lib/db.js";

export async function onRequestGet({ env, params }) {
  const rows = await all(env.DB, "SELECT id, started_at, finished_at, triggered_by, status, engine_version, summary FROM runs WHERE session_id = ? ORDER BY started_at DESC LIMIT 50", params.sid);
  return json(rows.map(r => ({ id: r.id, startedAt: r.started_at, finishedAt: r.finished_at, by: r.triggered_by, status: r.status, engineVersion: r.engine_version, summary: parseJson(r.summary) })));
}
