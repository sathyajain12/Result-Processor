import { json, readJson, HttpError } from "../../../_lib/http.js";
import { all, first, run as exec, audit, parseJson } from "../../../_lib/db.js";
import { requireRole } from "../../../_lib/auth.js";
import { latestRun } from "../../../_lib/compute.js";
import { approvalMap, tally, batchStage } from "../../../_lib/state.js";
import { canSee } from "../../../../shared/tabs.js";

export async function onRequestGet({ env, params, data }) {
  const db = env.DB;
  const session = await first(db, "SELECT * FROM exam_sessions WHERE id = ?", params.sid);
  if (!session) throw new HttpError(404, "Session not found");

  const sources = await all(db, "SELECT * FROM sources WHERE session_id = ?", params.sid);
  const markSheets = Object.fromEntries((await all(db, "SELECT DISTINCT component FROM marksheet_masters WHERE session_id = ?", params.sid)).map(r => [r.component, true]));
  const baseSession = session.base_session_id ? await first(db, "SELECT id, name FROM exam_sessions WHERE id = ?", session.base_session_id) : null;
  const run = await latestRun(db, params.sid);
  // Recorded when each source was loaded or each sheet fetched. Counting the marks table instead cost about 30,000 rows read per page load.
  const loaded = kind => sources.find(s => s.kind === kind)?.row_count ?? null;
  const sheetMarks = Object.keys(markSheets).length
    ? Object.fromEntries((await all(db, "SELECT component, COALESCE(SUM(marks_count), 0) AS n FROM marksheets WHERE session_id = ? GROUP BY component", params.sid)).map(r => [r.component, r.n]))
    : {};
  const counts = {
    students: loaded("SMF") ?? (await first(db, "SELECT COUNT(*) AS n FROM students WHERE session_id = ?", params.sid)).n,
    courses: loaded("CMF") ?? (await first(db, "SELECT COUNT(*) AS n FROM courses WHERE session_id = ?", params.sid)).n,
    cie: markSheets.CIE ? sheetMarks.CIE ?? 0 : loaded("CIE") ?? 0,
    ese: markSheets.ESE ? sheetMarks.ESE ?? 0 : loaded("ESE") ?? 0
  };

  // Every page loads this, and Cloudflare's free plan allows each request only 10 ms of CPU. So the database counts each
  // batch's results; only students who have an approval are read one by one, to tell approved from changed since approval.
  let batches = [];
  // The batch list belongs to the Batches tab: someone without it gets the session without it.
  if (run && canSee(data.user, "batches")) {
    const approvals = await approvalMap(db, params.sid);
    const counts = new Map((await all(db, `SELECT batch_key, SUM(state = 'Withheld') AS withheld, SUM(state <> 'Withheld' AND releasable = 0) AS held,
      SUM(releasable = 1) AS releasable FROM student_results WHERE run_id = ? GROUP BY batch_key`, run.id)).map(r => [r.batch_key, r]));
    const approvedRows = [];
    const regds = [...approvals.keys()];
    for (let i = 0; i < regds.length; i += 90) {
      const part = regds.slice(i, i + 90);
      approvedRows.push(...await all(db, `SELECT regd_no, batch_key, state, releasable, digest FROM student_results WHERE run_id = ? AND releasable = 1
        AND regd_no IN (${part.map(() => "?").join(",")})`, run.id, ...part));
    }
    const approvedByBatch = new Map();
    for (const r of approvedRows) (approvedByBatch.get(r.batch_key) || approvedByBatch.set(r.batch_key, []).get(r.batch_key)).push(r);
    batches = (await all(db, "SELECT id, key, stats FROM batches WHERE session_id = ? AND run_id = ? ORDER BY programme, semester, batch", params.sid, run.id)).map(b => {
      const stats = parseJson(b.stats, {});
      const n = counts.get(b.key) || { withheld: 0, held: 0, releasable: 0 };
      const a = tally(approvedByBatch.get(b.key) || [], approvals);   // approved or changed, among the releasable
      const t = { ready: n.releasable - a.approved - a.changed, approved: a.approved, changed: a.changed, held: n.held, withheld: n.withheld };
      const c = { ...stats, ...t };
      return { id: b.id, ...c, stage: batchStage(c) };
    });
  }

  return json({
    id: session.id, name: session.name, status: session.status, closedAt: session.closed_at, closedBy: session.closed_by, closeReason: session.close_reason,
    cycleId: session.cycle_id, kind: session.kind, markSheets, baseSessionId: baseSession?.id ?? null, baseSessionName: baseSession?.name ?? null, thresholds: parseJson(session.thresholds),
    counts,
    sources: sources.map(s => ({
      kind: s.kind, spreadsheetId: s.spreadsheet_id, sheetName: s.sheet_name, lastSyncedAt: s.last_synced_at,
      lastSyncedBy: s.last_synced_by, rowCount: s.row_count, warnings: parseJson(s.warnings, [])
    })),
    run: run ? { id: run.id, startedAt: run.started_at, by: run.triggered_by, engineVersion: run.engine_version, summary: parseJson(run.summary) } : null,
    batches
  });
}

export async function onRequestPut({ env, request, params, data }) {
  requireRole(data.user, "admin");
  const db = env.DB;
  const session = await first(db, "SELECT * FROM exam_sessions WHERE id = ?", params.sid);
  if (!session) throw new HttpError(404, "Session not found");
  const body = await readJson(request);
  if (!("cycleId" in body) && !("name" in body)) throw new HttpError(400, "Send a new name or cycleId");
  // Rename: only the display name changes; the session's id (and so its links) stays the same.
  if ("name" in body) {
    const name = String(body.name || "").trim();
    if (name.length < 3) throw new HttpError(400, "A session name needs at least 3 characters");
    await exec(db, "UPDATE exam_sessions SET name = ? WHERE id = ?", name, session.id);
    await audit(db, data.user.email, session.id, "rename-session", session.id, { from: session.name, to: name });
  }
  if ("cycleId" in body) {
    const cycleId = body.cycleId || null;
    if (cycleId && !(await first(db, "SELECT id FROM exam_cycles WHERE id = ?", cycleId))) throw new HttpError(400, `Cycle ${cycleId} not found`);
    await exec(db, "UPDATE exam_sessions SET cycle_id = ? WHERE id = ?", cycleId, session.id);
    await audit(db, data.user.email, session.id, "move-session", session.id, { from: session.cycle_id, to: cycleId });
  }
  return json({ ok: true });
}
