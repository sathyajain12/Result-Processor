import { json, readJson, HttpError } from "../../../../_lib/http.js";
import { first, run, audit } from "../../../../_lib/db.js";
import { requireRole } from "../../../../_lib/auth.js";
import { checkSheet } from "../../../../_lib/marksheets.js";

// Fetch one course's Marks Statement now ("Fetch now" on the Mark sheets page), for when its marks are needed before the
// next Fetch or morning check. The usual rules hold: marks are taken only once the sheet is certified (and validated, for
// ESE); otherwise only its status is refreshed. An already fetched sheet is read again, so later corrections come in too.
// It is recorded as a manual fetch of one sheet. One sheet is about 3 ms of CPU, inside the free plan's 10 ms.
export async function onRequestPost({ env, request, params, data }) {
  requireRole(data.user, "operator");
  const db = env.DB;
  const body = await readJson(request).catch(() => ({}));
  const sheet = await first(db, "SELECT * FROM marksheets WHERE session_id = ? AND key = ?", params.sid, String(body.key || ""));
  if (!sheet) throw new HttpError(404, "That sheet is not in this session");
  if (!sheet.in_master) throw new HttpError(400, `${sheet.course_code} is no longer in the course master`);
  if (!sheet.spreadsheet_id) throw new HttpError(400, `There is no Marks Statement file for ${sheet.course_code} yet`);

  const res = await run(db, "INSERT INTO marksheet_runs (session_id, trigger, by, component) VALUES (?, 'manual', ?, ?)", params.sid, data.user.email, sheet.component);
  const runId = res.meta.last_row_id;
  const r = await checkSheet(env, params.sid, sheet, runId);
  const error = r.status === "error" || r.status === "no_access" || r.status === "template";
  await run(db, "UPDATE marksheet_runs SET checked = ?, fetched = ?, changed = ?, errors = ?, finished_at = datetime('now') WHERE id = ?",
    r.retryLater ? 0 : 1, r.fetched ? 1 : 0, r.changes || 0, error ? 1 : 0, runId);
  if (r.retryLater) throw new HttpError(429, "Google's read limit was reached. Try again in a minute.");
  await audit(db, data.user.email, params.sid, "fetch-marksheet", sheet.key,
    { course: sheet.course_code, component: sheet.component, campus: sheet.campus, status: r.status, fetched: r.fetched, changes: r.changes, corrections: r.corrections });
  const after = await first(db, "SELECT marks_count, students, last_error FROM marksheets WHERE session_id = ? AND key = ?", params.sid, sheet.key);
  return json({ courseCode: sheet.course_code, component: sheet.component, campus: sheet.campus, status: r.status, fetched: r.fetched, changes: r.changes,
    corrections: r.corrections, marks: after?.marks_count ?? null, students: after?.students ?? null, error: r.error || after?.last_error || null });
}
