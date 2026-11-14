import { json, readJson, HttpError } from "../../../../../_lib/http.js";
import { all, first, run, audit } from "../../../../../_lib/db.js";
import { requireRole } from "../../../../../_lib/auth.js";
import { latestRun } from "../../../../../_lib/compute.js";
import { approvalMap, studentStatus } from "../../../../../_lib/state.js";

export async function onRequestPost({ env, request, params, data }) {
  requireRole(data.user, "admin");
  const body = await readJson(request).catch(() => ({}));
  const action = body.action === "revoke" ? "revoke" : "approve";
  const db = env.DB;
  const batch = await first(db, "SELECT * FROM batches WHERE session_id = ? AND id = ?", params.sid, Number(params.bid));
  if (!batch) throw new HttpError(404, "Batch not found");
  const latest = await latestRun(db, params.sid);
  if (!latest || latest.id !== batch.run_id) throw new HttpError(409, "Results changed since this page loaded — refresh and review again");

  const rows = await all(db, "SELECT regd_no, state, releasable, digest FROM student_results WHERE run_id = ? AND batch_key = ?", latest.id, batch.key);
  const approvals = await approvalMap(db, params.sid);
  const only = Array.isArray(body.regdNos) && body.regdNos.length ? new Set(body.regdNos) : null;

  const targets = rows.filter(r => {
    if (only && !only.has(r.regd_no)) return false;
    const st = studentStatus(r, approvals.get(r.regd_no));
    return action === "approve" ? st === "ready" || st === "changed" : st === "approved";
  });
  if (!targets.length) throw new HttpError(400, action === "approve" ? "Nothing to approve in this batch" : "Nothing to revoke");

  const list = targets.map(r => ({ regdNo: r.regd_no, digest: r.digest }));
  await run(db, "INSERT INTO approvals (session_id, batch_key, run_id, action, regd_nos, note, created_by) VALUES (?,?,?,?,?,?,?)",
    params.sid, batch.key, latest.id, action, JSON.stringify(list), body.note || null, data.user.email);
  await audit(db, data.user.email, params.sid, action, batch.key, { count: list.length, note: body.note });
  return json({ action, count: list.length });
}
