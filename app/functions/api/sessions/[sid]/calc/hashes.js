import { json, HttpError } from "../../../../_lib/http.js";
import { first } from "../../../../_lib/db.js";
import { requireRole } from "../../../../_lib/auth.js";

// For saving a Compute: the latest run's result fingerprints (Regd No, row_hash), in pages by Regd No, so the browser can
// tell which students' results changed. A result saved before fingerprints existed has none and counts as changed.
const PAGE = 2000;
export async function onRequestGet({ env, params, request, data }) {
  requireRole(data.user, "operator");
  const url = new URL(request.url);
  const runId = url.searchParams.get("runId");
  const after = url.searchParams.get("after") || "";
  if (!runId) throw new HttpError(400, "runId is required");
  if (!(await first(env.DB, "SELECT id FROM runs WHERE id = ? AND session_id = ?", runId, params.sid))) throw new HttpError(404, "Run not found");
  const rows = await env.DB.prepare("SELECT regd_no, row_hash FROM student_results WHERE run_id = ? AND regd_no > ? ORDER BY regd_no LIMIT ?")
    .bind(runId, after, PAGE).raw();
  return json({ fields: ["regdNo", "hash"], rows, next: rows.length === PAGE ? rows[rows.length - 1][0] : null });
}
