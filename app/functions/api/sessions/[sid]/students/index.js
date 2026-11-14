import { json } from "../../../../_lib/http.js";
import { all } from "../../../../_lib/db.js";
import { latestRun } from "../../../../_lib/compute.js";

export async function onRequestGet({ env, params, request }) {
  const q = (new URL(request.url).searchParams.get("q") || "").trim();
  if (q.length < 2) return json([]);
  const run = await latestRun(env.DB, params.sid);
  const like = `%${q}%`;
  const rows = await all(env.DB, `
    SELECT s.regd_no, s.name, s.programme, s.semester, r.published_gpa, r.letter_grade, r.state, r.releasable,
           (SELECT id FROM batches b WHERE b.session_id = s.session_id AND b.key = r.batch_key) AS batch_id
    FROM students s LEFT JOIN student_results r ON r.regd_no = s.regd_no AND r.run_id = ?
    WHERE s.session_id = ? AND (s.regd_no LIKE ? OR s.name LIKE ?) ORDER BY s.name LIMIT 20`, run?.id ?? "", params.sid, like, like);
  return json(rows.map(r => ({ regdNo: r.regd_no, name: r.name, programme: r.programme, semester: r.semester, publishedGpa: r.published_gpa, letterGrade: r.letter_grade, state: r.state, releasable: !!r.releasable, batchId: r.batch_id })));
}
