import { json, readJson, requireFields } from "../../../../_lib/http.js";
import { all, run } from "../../../../_lib/db.js";
import { requireRole } from "../../../../_lib/auth.js";

export async function onRequestGet({ env, params, request }) {
  const key = new URL(request.url).searchParams.get("key");
  return json(await all(env.DB, "SELECT note, created_by AS by, created_at AS at FROM exception_notes WHERE session_id = ? AND key = ? ORDER BY id", params.sid, key));
}

export async function onRequestPost({ env, params, request, data }) {
  requireRole(data.user, "operator");
  const body = await readJson(request);
  requireFields(body, ["key", "note"]);
  await run(env.DB, "INSERT INTO exception_notes (session_id, key, note, created_by) VALUES (?,?,?,?)", params.sid, body.key, body.note.trim(), data.user.email);
  return json({ ok: true }, 201);
}
