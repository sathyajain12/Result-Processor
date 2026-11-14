import { json, HttpError } from "../../../_lib/http.js";
import { all, first } from "../../../_lib/db.js";
import { latestRun } from "../../../_lib/compute.js";
import { approvalMap, studentStatus } from "../../../_lib/state.js";

// The FinalOutput sheet: one row per student from the latest run, every batch.
// Cloudflare's free plan allows a request 10 ms of CPU, so the database joins the student details and picks out the first
// reason, and each row is sent as a list of values (FIELDS order); the page names and sorts them.
const FIELDS = ["regdNo", "batchKey", "state", "releasable", "sumCredits", "sumCreditNP", "calculatedGpa", "publishedGpa", "letterGrade", "qualifier",
  "isAbsent", "failedCourses", "totalPapers", "reason", "name", "campus", "programme", "semester", "status", "batchId"];

export async function onRequestGet({ env, params }) {
  const db = env.DB;
  if (!(await first(db, "SELECT id FROM exam_sessions WHERE id = ?", params.sid))) throw new HttpError(404, "Session not found");
  const run = await latestRun(db, params.sid);
  if (!run) return json({ run: null, rows: [] });

  const [rows, batches, approvals] = await Promise.all([
    db.prepare(`SELECT r.regd_no, r.batch_key, r.state, r.releasable, r.sum_credits, r.sum_credit_np, r.calculated_gpa, r.published_gpa, r.letter_grade,
        r.qualifier, r.is_absent, r.failed_courses, json_array_length(r.papers), json_extract(r.reasons, '$.reasons[0]'),
        s.name, s.campus, s.programme, s.semester, r.digest
      FROM student_results r LEFT JOIN students s ON s.session_id = ? AND s.regd_no = r.regd_no WHERE r.run_id = ?`).bind(params.sid, run.id).raw(),
    all(db, "SELECT id, key FROM batches WHERE session_id = ?", params.sid),
    approvalMap(db, params.sid)
  ]);
  const batchId = new Map(batches.map(b => [b.key, b.id]));
  // Where each result stands needs its approval; the digest is replaced by that status, and the batch's id is added.
  for (const r of rows) {
    const digest = r[18];
    r[18] = studentStatus({ regd_no: r[0], state: r[2], releasable: r[3], digest }, approvals.get(r[0]));
    r.push(batchId.get(r[1]) ?? null);
  }
  return json({ run: { id: run.id, startedAt: run.started_at }, fields: FIELDS, rows });
}
