import { json } from "../../../../_lib/http.js";
import { all, parseJson } from "../../../../_lib/db.js";

export async function onRequestGet({ env, params, request }) {
  const u = new URL(request.url).searchParams;
  const where = ["e.session_id = ?"];
  const args = [params.sid];
  if (u.get("severity")) { where.push("e.severity = ?"); args.push(u.get("severity")); }
  if (u.get("code")) { where.push("e.code = ?"); args.push(u.get("code")); }
  if (u.get("batch")) { where.push("e.batch_key = ?"); args.push(u.get("batch")); }
  if (u.get("accepted") !== "1") where.push("e.accepted = 0");
  if (u.get("q")) { where.push("(e.regd_no LIKE ? OR e.paper_code LIKE ? OR e.message LIKE ?)"); const l = `%${u.get("q")}%`; args.push(l, l, l); }

  const rows = await all(env.DB, `
    SELECT e.*, s.name AS student_name, b.id AS batch_id, d.reason AS detention_reason, d.updated_by AS detention_by, d.updated_at AS detention_at,
      (SELECT COUNT(*) FROM exception_notes n WHERE n.session_id = e.session_id AND n.key = e.key) AS notes
    FROM (SELECT * FROM exceptions e WHERE ${where.join(" AND ")}
      ORDER BY CASE e.severity WHEN 'block' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END, e.code, e.batch_key, e.regd_no LIMIT 1000) e
    LEFT JOIN students s ON s.session_id = e.session_id AND s.regd_no = e.regd_no
    LEFT JOIN batches b ON b.session_id = e.session_id AND b.key = e.batch_key
    LEFT JOIN detention_reasons d ON d.session_id = e.session_id AND d.regd_no = e.regd_no AND e.code IN ('BATCH_REROUTED', 'BATCH_AMBIGUOUS')
    ORDER BY CASE e.severity WHEN 'block' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END, e.code, e.batch_key, e.regd_no`, ...args);

  const counts = await all(env.DB, `SELECT code, severity, COUNT(*) n, SUM(accepted) accepted FROM exceptions WHERE session_id = ? GROUP BY code, severity ORDER BY severity, n DESC`, params.sid);

  return json({
    counts: counts.map(c => ({ code: c.code, severity: c.severity, open: c.n - (c.accepted || 0), accepted: c.accepted || 0 })),
    items: rows.map(e => ({
      key: e.key, code: e.code, severity: e.severity, batchKey: e.batch_key, batchId: e.batch_id, regdNo: e.regd_no, studentName: e.student_name,
      paperCode: e.paper_code, courseCode: e.course_code, message: e.message, details: parseJson(e.details, {}), accepted: !!e.accepted,
      firstSeen: e.first_seen, notes: e.notes,
      recordedReason: e.detention_reason ? { reason: e.detention_reason, by: e.detention_by, at: e.detention_at } : null
    }))
  });
}
