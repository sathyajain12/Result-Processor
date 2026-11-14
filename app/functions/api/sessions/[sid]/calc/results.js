import { json, readJson, HttpError } from "../../../../_lib/http.js";
import { resultStatement } from "../../../../_lib/compute.js";
import { RESULT_COLUMNS } from "../../../../../shared/compute-core.js";
import { saving } from "../../../../_lib/calcsave.js";

// Step 2b: saves one page of results (each a list of values in RESULT_COLUMNS order), with their fingerprints (hashes, in the
// same order). Saving a page again replaces it. Unchanged results are copied by carry.js instead.
export const MAX_ROWS = 20;
export async function onRequestPost({ env, params, request, data }) {
  const body = await readJson(request);
  const { db } = await saving(env, params, data, body.runId);
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length || rows.length > MAX_ROWS) throw new HttpError(400, `Send 1 to ${MAX_ROWS} results at a time`);
  if (rows.some(r => !Array.isArray(r) || r.length !== RESULT_COLUMNS.length)) throw new HttpError(400, "Each result needs every column");
  const hashes = Array.isArray(body.hashes) && body.hashes.length === rows.length && body.hashes.every(h => /^[0-9a-f]{32}$/.test(h)) ? body.hashes : null;
  await db.batch(rows.map((r, i) => resultStatement(db, body.runId, params.sid, r, hashes ? hashes[i] : null)));
  return json({ saved: rows.length });
}
