import { json, readJson, HttpError } from "../../../../_lib/http.js";
import { requireRole } from "../../../../_lib/auth.js";
import { exceptionStatements } from "../../../../_lib/compute.js";
import { saving } from "../../../../_lib/calcsave.js";

// Step 4: the stored issues a page at a time (GET ?after=<key>), so the browser can work out which appeared, changed or
// went away; then those changes in pieces (POST { runId, inserts, updates, deletes }).
const PAGE = 600;
export async function onRequestGet({ env, params, request, data }) {
  requireRole(data.user, "operator");
  const after = new URL(request.url).searchParams.get("after") || "";
  const rows = await env.DB.prepare(`SELECT key, severity, message, details, accepted FROM exceptions WHERE session_id = ? AND key > ?
    ORDER BY key LIMIT ?`).bind(params.sid, after, PAGE).raw();
  return json({ fields: ["key", "severity", "message", "details", "accepted"], rows, next: rows.length === PAGE ? rows[rows.length - 1][0] : null });
}

export async function onRequestPost({ env, params, request, data }) {
  const body = await readJson(request);
  const { db } = await saving(env, params, data, body.runId, { allowDone: true });
  const change = { inserts: body.inserts || [], updates: body.updates || [], deletes: body.deletes || [] };
  const n = change.inserts.length + change.updates.length + change.deletes.length;
  if (n > 60) throw new HttpError(400, "Send at most 60 issue changes at a time");
  if (n) await db.batch(exceptionStatements(db, params.sid, body.runId, change));
  return json({ saved: n });
}
