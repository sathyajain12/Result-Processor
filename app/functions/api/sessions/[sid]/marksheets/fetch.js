import { json, readJson, HttpError } from "../../../../_lib/http.js";
import { first, run, audit } from "../../../../_lib/db.js";
import { requireRole } from "../../../../_lib/auth.js";
import { fetchBatch, refreshList } from "../../../../_lib/marksheets.js";

// One step of a manual fetch of CIE or ESE marks. The first call starts a run (and re-lists that component's folders /
// course masters); the page keeps calling with the runId until nothing is left. Sheets already fetched are skipped:
// the morning check re-reads those once a day for corrections.
// Only the first call counts what is left (the page works out the rest); later calls just say whether any are left,
// because counting read every due sheet on every step.
export async function onRequestPost({ env, request, params, data }) {
  requireRole(data.user, "operator");
  const db = env.DB;
  const body = await readJson(request).catch(() => ({}));
  const component = body.component === "CIE" || body.component === "ESE" ? body.component : null;
  let runRow = body.runId ? await first(db, "SELECT * FROM marksheet_runs WHERE id = ? AND session_id = ?", Number(body.runId), params.sid) : null;
  if (body.runId && !runRow) throw new HttpError(404, "Fetch run not found");
  let listed = null;
  if (!runRow) {
    listed = await refreshList(env, params.sid, component);   // new Marks Statements in the folders, new rows in the course masters
    const res = await run(db, "INSERT INTO marksheet_runs (session_id, trigger, by, component) VALUES (?, 'manual', ?, ?)", params.sid, data.user.email, component);
    runRow = await first(db, "SELECT * FROM marksheet_runs WHERE id = ?", res.meta.last_row_id);
  }
  if (listed) {
    const { n, skipped } = await first(db, `SELECT SUM(status <> 'fetched') AS n, SUM(status = 'fetched') AS skipped FROM marksheets
      WHERE session_id = ? AND in_master = 1 AND spreadsheet_id IS NOT NULL${component ? " AND component = ?" : ""}`, params.sid, ...(component ? [component] : []));
    return json({ runId: runRow.id, checked: 0, fetched: 0, changed: 0, errors: 0, remaining: n ?? 0, skipped: skipped ?? 0, listed });
  }
  const limit = Math.max(1, Math.min(40, Number(body.limit) || 6));
  const r = await fetchBatch(env, params.sid, { limit, runId: runRow.id, before: runRow.started_at, component: runRow.component, skipFetched: true, exactRemaining: false });
  if (r.remaining === 0) {
    await run(db, "UPDATE marksheet_runs SET finished_at = datetime('now') WHERE id = ?", runRow.id);
    const done = await first(db, "SELECT * FROM marksheet_runs WHERE id = ?", runRow.id);
    await audit(db, data.user.email, params.sid, "fetch-marksheets", String(runRow.id), { component: runRow.component, checked: done.checked, fetched: done.fetched, changed: done.changed, errors: done.errors });
  }
  return json({ runId: runRow.id, ...r, ...(listed ? { listed } : {}) });
}
