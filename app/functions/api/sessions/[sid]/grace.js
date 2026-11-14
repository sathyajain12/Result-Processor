import { json, HttpError } from "../../../_lib/http.js";
import { all, first } from "../../../_lib/db.js";
import { latestRun } from "../../../_lib/compute.js";
import { approvalMap, studentStatus } from "../../../_lib/state.js";

// The Gracing page: every graced paper in the latest run, one row per paper, with the student's grace pool; and the papers
// that were close enough to grace but the pool could not cover (GRACE_NOT_AVAILABLE issues).
// Cloudflare's free plan allows a request 10 ms of CPU, so the database unpacks the stored papers and picks out the graced
// ones (json_each), and each row is sent as a list of values (FIELDS order).
const FIELDS = ["regdNo", "batchKey", "name", "campus", "programme", "semester", "paperCode", "title", "credits",
  "cie", "cieMax", "ese", "eseMax", "kind", "marks", "gracedMarks", "fromPct", "toPct", "eseFromPct", "eseToPct", "combPct",
  "pool", "used", "left", "status", "batchId"];
const REFUSED_FIELDS = ["regdNo", "batchKey", "name", "campus", "programme", "semester", "paperCode", "message", "needed", "left", "batchId"];

export async function onRequestGet({ env, params }) {
  const db = env.DB;
  if (!(await first(db, "SELECT id FROM exam_sessions WHERE id = ?", params.sid))) throw new HttpError(404, "Session not found");
  const run = await latestRun(db, params.sid);
  if (!run) return json({ run: null, rows: [], refused: [] });

  const [rows, refused, batches, approvals] = await Promise.all([
    db.prepare(`SELECT r.regd_no, r.batch_key, s.name, s.campus, s.programme, s.semester,
        json_extract(p.value, '$.paperCode'), json_extract(p.value, '$.title'), json_extract(p.value, '$.credits'),
        json_extract(p.value, '$.cie'), json_extract(p.value, '$.course.cieMax'), json_extract(p.value, '$.ese'), json_extract(p.value, '$.course.eseMax'),
        json_extract(p.value, '$.grace.kind'), json_extract(p.value, '$.grace.marks'), json_extract(p.value, '$.grace.gracedMarks'),
        json_extract(p.value, '$.grace.fromPct'), json_extract(p.value, '$.grace.toPct'), json_extract(p.value, '$.grace.eseFromPct'),
        json_extract(p.value, '$.grace.eseToPct'), json_extract(p.value, '$.combPct'),
        json_extract(r.reasons, '$.grace.pool'), json_extract(r.reasons, '$.grace.used'), json_extract(r.reasons, '$.grace.left'),
        r.state, r.releasable, r.digest
      FROM student_results r JOIN json_each(r.papers) p LEFT JOIN students s ON s.session_id = ? AND s.regd_no = r.regd_no
      WHERE r.run_id = ? AND json_extract(p.value, '$.grace') IS NOT NULL`).bind(params.sid, run.id).raw(),
    db.prepare(`SELECT e.regd_no, e.batch_key, s.name, s.campus, s.programme, s.semester, e.paper_code, e.message,
        json_extract(e.details, '$.needed'), json_extract(e.details, '$.left')
      FROM exceptions e LEFT JOIN students s ON s.session_id = e.session_id AND s.regd_no = e.regd_no
      WHERE e.session_id = ? AND e.code = 'GRACE_NOT_AVAILABLE'`).bind(params.sid).raw(),
    all(db, "SELECT id, key FROM batches WHERE session_id = ?", params.sid),
    approvalMap(db, params.sid)
  ]);
  const batchId = new Map(batches.map(b => [b.key, b.id]));
  // state, releasable and digest give where the result stands (with its approval); they are replaced by that status.
  for (const r of rows) {
    const [state, releasable, digest] = r.splice(24, 3);
    r.push(studentStatus({ regd_no: r[0], state, releasable, digest }, approvals.get(r[0])), batchId.get(r[1]) ?? null);
  }
  for (const r of refused) r.push(batchId.get(r[1]) ?? null);
  return json({ run: { id: run.id, startedAt: run.started_at }, fields: FIELDS, rows, refusedFields: REFUSED_FIELDS, refused });
}
