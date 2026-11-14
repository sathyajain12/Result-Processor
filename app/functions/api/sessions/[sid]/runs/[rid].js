import { json, HttpError } from "../../../../_lib/http.js";
import { all, first } from "../../../../_lib/db.js";

export async function onRequestGet({ env, params, request }) {
  const against = new URL(request.url).searchParams.get("against");
  const db = env.DB;
  const base = against ? await first(db, "SELECT id FROM runs WHERE id = ? AND session_id = ?", against, params.sid)
    : await first(db, "SELECT id FROM runs WHERE session_id = ? AND status = 'done' AND started_at < (SELECT started_at FROM runs WHERE id = ?) ORDER BY started_at DESC LIMIT 1", params.sid, params.rid);
  if (!base) throw new HttpError(404, "No earlier run to compare with");
  const cols = "regd_no, state, releasable, published_gpa, letter_grade, digest, batch_key";
  const a = new Map((await all(db, `SELECT ${cols} FROM student_results WHERE run_id = ?`, base.id)).map(r => [r.regd_no, r]));
  const b = await all(db, `SELECT ${cols} FROM student_results WHERE run_id = ?`, params.rid);
  const names = new Map((await all(db, "SELECT regd_no, name FROM students WHERE session_id = ?", params.sid)).map(s => [s.regd_no, s.name]));
  const changes = [];
  for (const r of b) {
    const o = a.get(r.regd_no);
    if (o && o.digest === r.digest) continue;
    changes.push({ regdNo: r.regd_no, name: names.get(r.regd_no), batchKey: r.batch_key,
      before: o ? { state: o.state, releasable: !!o.releasable, gpa: o.published_gpa, letterGrade: o.letter_grade } : null,
      after: { state: r.state, releasable: !!r.releasable, gpa: r.published_gpa, letterGrade: r.letter_grade } });
  }
  return json({ base: base.id, run: params.rid, changes });
}
