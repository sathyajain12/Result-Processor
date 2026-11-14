import { json, HttpError } from "../../../_lib/http.js";
import { all, first } from "../../../_lib/db.js";
import { latestRun } from "../../../_lib/compute.js";
import { approvalMap, studentStatus } from "../../../_lib/state.js";

// The Failures page: every failed or absent paper in the latest run, one row per paper, with the student's details.
// Cloudflare's free plan allows a request 10 ms of CPU, so the database unpacks the stored papers and picks out the
// failures (json_each), and each row is sent as a list of values (FIELDS order); the page groups them.
const FIELDS = ["regdNo", "batchKey", "name", "campus", "programme", "semester", "publishedGpa", "paperCode", "title", "paperStatus",
  "cie", "cieMax", "ciePct", "cieNP", "ese", "eseMax", "esePct", "eseNP", "combPct", "combNP", "credits", "status", "batchId"];

export async function onRequestGet({ env, params }) {
  const db = env.DB;
  if (!(await first(db, "SELECT id FROM exam_sessions WHERE id = ?", params.sid))) throw new HttpError(404, "Session not found");
  const run = await latestRun(db, params.sid);
  if (!run) return json({ run: null, rows: [] });

  const [rows, batches, approvals] = await Promise.all([
    db.prepare(`SELECT r.regd_no, r.batch_key, s.name, s.campus, s.programme, s.semester, r.published_gpa,
        json_extract(p.value, '$.paperCode'), json_extract(p.value, '$.title'), json_extract(p.value, '$.status'),
        json_extract(p.value, '$.cie'), json_extract(p.value, '$.course.cieMax'), json_extract(p.value, '$.ciePct'), json_extract(p.value, '$.cieNP'),
        json_extract(p.value, '$.ese'), json_extract(p.value, '$.course.eseMax'), json_extract(p.value, '$.eseComptPct'), json_extract(p.value, '$.eseNP'),
        json_extract(p.value, '$.combPct'), json_extract(p.value, '$.combNP'), json_extract(p.value, '$.credits'),
        r.state, r.releasable, r.digest
      FROM student_results r JOIN json_each(r.papers) p LEFT JOIN students s ON s.session_id = ? AND s.regd_no = r.regd_no
      WHERE r.run_id = ? AND json_extract(p.value, '$.status') IN ('Fails', 'Absent')`).bind(params.sid, run.id).raw(),
    all(db, "SELECT id, key FROM batches WHERE session_id = ?", params.sid),
    approvalMap(db, params.sid)
  ]);
  const batchId = new Map(batches.map(b => [b.key, b.id]));
  // state, releasable and digest give where the result stands (with its approval); they are replaced by that status.
  for (const r of rows) {
    const [state, releasable, digest] = r.splice(21, 3);
    r.push(studentStatus({ regd_no: r[0], state, releasable, digest }, approvals.get(r[0])), batchId.get(r[1]) ?? null);
  }
  return json({ run: { id: run.id, startedAt: run.started_at }, fields: FIELDS, rows });
}
