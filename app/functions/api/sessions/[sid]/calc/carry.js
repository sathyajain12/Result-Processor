import { json, readJson, HttpError } from "../../../../_lib/http.js";
import { first } from "../../../../_lib/db.js";
import { saving } from "../../../../_lib/calcsave.js";
import { RESULT_COLUMNS } from "../../../../../shared/compute-core.js";

// Step 2a of saving a Compute: results that did not change (same fingerprint as in the latest run) are copied into the
// new run by the database, so the browser only sends the ones that changed (step 2b, results.js). The Regd Nos go in as
// one JSON value that the database unpacks; the Worker does no per-row work.
export const MAX_CARRY = 500;
const COLS = [...RESULT_COLUMNS, "row_hash"].join(", ");
export async function onRequestPost({ env, params, request, data }) {
  const body = await readJson(request);
  const { db } = await saving(env, params, data, body.runId);
  const regdNos = Array.isArray(body.regdNos) ? body.regdNos : [];
  if (!regdNos.length || regdNos.length > MAX_CARRY || regdNos.some(r => typeof r !== "string")) throw new HttpError(400, `Send 1 to ${MAX_CARRY} Regd Nos at a time`);
  const from = await first(db, "SELECT id FROM runs WHERE id = ? AND session_id = ? AND status = 'done'", body.from, params.sid);
  if (!from) throw new HttpError(409, "The results to copy from are gone; run Compute again");
  const res = await db.prepare(`INSERT OR REPLACE INTO student_results (run_id, session_id, ${COLS})
      SELECT ?, session_id, ${COLS} FROM student_results WHERE run_id = ? AND regd_no IN (SELECT value FROM json_each(?))`)
    .bind(body.runId, from.id, JSON.stringify(regdNos)).run();
  return json({ carried: res.meta?.changes ?? null });
}
