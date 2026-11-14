import { json, readJson, HttpError } from "../../../../_lib/http.js";
import { all } from "../../../../_lib/db.js";
import { requireRole } from "../../../../_lib/auth.js";
import { batchStatements } from "../../../../_lib/compute.js";
import { saving } from "../../../../_lib/calcsave.js";

// Step 3: the stored batches (GET), so the browser can work out which changed, then those changes (POST).
export async function onRequestGet({ env, params, data }) {
  requireRole(data.user, "operator");
  return json({ batches: await all(env.DB, "SELECT id, key, run_id, stats FROM batches WHERE session_id = ?", params.sid) });
}

export async function onRequestPost({ env, params, request, data }) {
  const body = await readJson(request);
  const { db } = await saving(env, params, data, body.runId, { allowDone: true });
  const upserts = Array.isArray(body.upserts) ? body.upserts : [];
  if (upserts.length > 150) throw new HttpError(400, "Send at most 150 batches at a time");
  if (upserts.length) await db.batch(batchStatements(db, params.sid, body.runId, upserts));
  return json({ saved: upserts.length });
}
