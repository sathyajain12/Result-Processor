import { json } from "../../../_lib/http.js";
import { all, parseJson } from "../../../_lib/db.js";

export async function onRequestGet({ env, params }) {
  const rows = await all(env.DB, "SELECT * FROM audit_log WHERE session_id = ? ORDER BY id DESC LIMIT 300", params.sid);
  return json(rows.map(r => ({ id: r.id, at: r.at, actor: r.actor, action: r.action, entity: r.entity, detail: parseJson(r.detail) })));
}
