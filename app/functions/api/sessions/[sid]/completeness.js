import { json, HttpError } from "../../../_lib/http.js";
import { all, first } from "../../../_lib/db.js";
import { latestRun, evaluateSession } from "../../../_lib/compute.js";
import { buildReport, liveRows } from "../../../../shared/completeness-core.js";

// The completeness report from the latest Compute, as stored (built by shared/completeness-core.js).
//   ?part=extras   only what the browser's "Check now" adds to its own grading: overrides, detention reasons, batch ids
//   ?live=1        the check worked out here (a local server; on Cloudflare's free plan the browser does this)
export async function onRequestGet({ env, params, request }) {
  const db = env.DB;
  const session = await first(db, "SELECT * FROM exam_sessions WHERE id = ?", params.sid);
  if (!session) throw new HttpError(404, "Session not found");
  const url = new URL(request.url);
  const overridesQuery = () => all(db, "SELECT * FROM overrides WHERE session_id = ? AND revoked_at IS NULL AND type != 'accept' ORDER BY id", params.sid);
  const detentionQuery = () => all(db, "SELECT regd_no, reason, updated_by, updated_at FROM detention_reasons WHERE session_id = ?", params.sid);

  const part = url.searchParams.get("part");
  if (part === "extras") {
    const [overrides, detentionRows, batchIds, run] = await Promise.all([overridesQuery(), detentionQuery(),
      all(db, "SELECT id, key FROM batches WHERE session_id = ?", params.sid), latestRun(db, params.sid)]);
    return json({ overrides, detentionRows, batchIds, marksDirty: !!session.marks_dirty, lastComputedAt: run?.started_at ?? null, runId: run?.id ?? null });
  }
  // The stored report's own rows, a page at a time, for the browser to build the report (on the free plan this request
  // could not do it within 10 ms of CPU): the latest run's issues, results and batches.
  if (part === "exceptions" || part === "results" || part === "batches") {
    const runId = url.searchParams.get("runId");
    const after = url.searchParams.get("after") || "";
    if (part === "exceptions") {
      const fields = ["key", "code", "severity", "batch_key", "regd_no", "paper_code", "course_code", "message", "details", "accepted"];
      const rows = await db.prepare(`SELECT ${fields.join(", ")} FROM exceptions WHERE session_id = ? AND key > ? ORDER BY key LIMIT 500`).bind(params.sid, after).raw();
      return json({ fields, rows, next: rows.length === 500 ? rows[rows.length - 1][0] : null });
    }
    if (part === "results") {
      const fields = ["regd_no", "batch_key", "state", "releasable"];
      const rows = await db.prepare(`SELECT ${fields.join(", ")} FROM student_results WHERE run_id = ? AND regd_no > ? ORDER BY regd_no LIMIT 1000`).bind(runId, after).raw();
      return json({ fields, rows, next: rows.length === 1000 ? rows[rows.length - 1][0] : null });
    }
    return json({ rows: await all(db, "SELECT id, key, programme, semester, batch, stats FROM batches WHERE session_id = ? AND run_id = ? ORDER BY key", params.sid, runId) });
  }

  const live = url.searchParams.get("live") === "1";
  const run = await latestRun(db, params.sid);
  if (!live && !run) return json({ run: null, marksDirty: !!session.marks_dirty });

  // Every student's stored papers would be several MB to read and unpack: enough to run a request out of memory (a 503).
  // The report only needs each result's state, and which marks a batch needs comes from the course master.
  let rows;
  if (live) {
    const { out } = await evaluateSession(db, session);
    rows = liveRows(out, new Map((await all(db, "SELECT id, key FROM batches WHERE session_id = ?", params.sid)).map(b => [b.key, b.id])));
  } else {
    const [exceptions, batches, results] = await Promise.all([
      all(db, "SELECT * FROM exceptions WHERE session_id = ? ORDER BY batch_key, regd_no, paper_code", params.sid),
      all(db, "SELECT id, key, programme, semester, batch, stats FROM batches WHERE session_id = ? AND run_id = ? ORDER BY key", params.sid, run.id),
      all(db, "SELECT regd_no, batch_key, state, releasable FROM student_results WHERE run_id = ?", run.id)
    ]);
    rows = { exceptions, batches, results };
  }
  const [students, marks, courses, overrides, detentionRows] = await Promise.all([
    all(db, "SELECT regd_no, name, programme, semester, batch FROM students WHERE session_id = ?", params.sid),
    all(db, "SELECT regd_no, component, raw FROM marks WHERE session_id = ?", params.sid),
    all(db, "SELECT programmes, semester, batches, calc_type, cie_max, ese_max FROM courses WHERE session_id = ?", params.sid),
    overridesQuery(), detentionQuery()
  ]);
  // marksDirty: marks changed since the last Compute, so the stored report may be behind ("Check now" shows the current state).
  return json({
    run: live ? { live: true, checkedAt: new Date().toISOString(), lastComputedAt: run?.started_at ?? null } : { id: run.id, startedAt: run.started_at },
    marksDirty: !!session.marks_dirty, ...buildReport({ ...rows, students, marks, courses, overrides, detentionRows })
  });
}
