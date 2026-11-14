import { json, HttpError } from "../../../../../_lib/http.js";
import { all, first, parseJson } from "../../../../../_lib/db.js";
import { latestRun } from "../../../../../_lib/compute.js";
import { approvalMap, studentStatus, tally, batchStage } from "../../../../../_lib/state.js";
import { aggregatePapers } from "../../../../../_lib/analytics.js";

export async function onRequestGet({ env, params }) {
  const db = env.DB;
  const batch = await first(db, "SELECT * FROM batches WHERE session_id = ? AND id = ?", params.sid, Number(params.bid));
  if (!batch) throw new HttpError(404, "Batch not found");
  const run = await latestRun(db, params.sid);
  if (!run) throw new HttpError(404, "No computed results yet");

  // Cloudflare's free plan allows a request 10 ms of CPU: the database unpacks the stored papers and reasons (json_each,
  // json_extract), so the server never parses each student's full result, and only this batch's students are read.
  const [rows, paperRows, students, exceptions, approvalsLog] = await Promise.all([
    all(db, `SELECT regd_no, state, releasable, sum_credits, calculated_gpa, published_gpa, letter_grade, qualifier, failed_courses, digest,
      json_extract(reasons, '$.reasons') AS reason_list, json_extract(reasons, '$.blocking') AS blocking, json_extract(reasons, '$.cgpa') AS cgpa
      FROM student_results WHERE run_id = ? AND batch_key = ? ORDER BY regd_no`, run.id, batch.key),
    db.prepare(`SELECT r.regd_no, json_extract(j.value, '$.paperCode'), json_extract(j.value, '$.courseCode'), json_extract(j.value, '$.title'),
      json_extract(j.value, '$.credits'), json_extract(j.value, '$.status'), json_extract(j.value, '$.combPct'), json_extract(j.value, '$.combNP'),
      json_extract(j.value, '$.ciePct'), json_extract(j.value, '$.eseComptPct')
      FROM student_results r, json_each(r.papers) j WHERE r.run_id = ? AND r.batch_key = ? ORDER BY r.regd_no, j.key`).bind(run.id, batch.key).raw(),
    all(db, `SELECT regd_no, name, campus FROM students WHERE session_id = ? AND regd_no IN
      (SELECT regd_no FROM student_results WHERE run_id = ? AND batch_key = ?)`, params.sid, run.id, batch.key),
    all(db, "SELECT * FROM exceptions WHERE session_id = ? AND batch_key = ? ORDER BY severity, code", params.sid, batch.key),
    all(db, "SELECT id, action, regd_nos, note, created_by, created_at FROM approvals WHERE session_id = ? AND batch_key = ? ORDER BY id DESC", params.sid, batch.key)
  ]);
  const approvals = await approvalMap(db, params.sid);
  const names = new Map(students.map(s => [s.regd_no, s]));

  const allPapers = [];
  const papersOf = new Map();
  for (const [regd, paperCode, courseCode, title, credits, status, combPct, combNP, ciePct, eseComptPct] of paperRows) {
    const p = { paperCode, courseCode, title, credits, status, combPct, combNP, ciePct, eseComptPct };
    allPapers.push(p);
    (papersOf.get(regd) || papersOf.set(regd, []).get(regd)).push(p);
  }
  const gradeDist = {};
  const list = rows.map(r => {
    const papers = papersOf.get(r.regd_no) || [];
    const status = studentStatus(r, approvals.get(r.regd_no));
    if (r.releasable) {
      const g = r.letter_grade || r.published_gpa;
      gradeDist[g] = (gradeDist[g] || 0) + 1;
    }
    const extra = { reasons: parseJson(r.reason_list, []), blocking: r.blocking, cgpa: parseJson(r.cgpa, null) };
    return {
      regdNo: r.regd_no, name: names.get(r.regd_no)?.name, campus: names.get(r.regd_no)?.campus,
      state: r.state, status, releasable: !!r.releasable, sumCredits: r.sum_credits, calculatedGpa: r.calculated_gpa,
      publishedGpa: r.published_gpa, letterGrade: r.letter_grade, qualifier: r.qualifier, failedCourses: r.failed_courses,
      reasons: extra.reasons || [], blocking: extra.blocking || 0, cgpa: extra.cgpa,
      papers: papers.map(p => ({ paperCode: p.paperCode, combPct: p.combPct, combNP: p.combNP, status: p.status }))
    };
  });

  const stats = parseJson(batch.stats, {});
  const c = { ...stats, ...tally(rows, approvals) };
  return json({
    id: batch.id, key: batch.key, programme: batch.programme, semester: batch.semester, batch: batch.batch,
    stage: batchStage(c), counts: c, runId: run.id, runAt: run.started_at,
    students: list,
    papers: aggregatePapers(allPapers).sort((a, b) => a.paperCode.localeCompare(b.paperCode)),
    gradeDistribution: gradeDist,
    exceptions: exceptions.map(e => ({ key: e.key, code: e.code, severity: e.severity, regdNo: e.regd_no, paperCode: e.paper_code, message: e.message, accepted: !!e.accepted, firstSeen: e.first_seen, details: parseJson(e.details, {}) })),
    approvals: approvalsLog.map(a => ({ id: a.id, action: a.action, count: parseJson(a.regd_nos, []).length, note: a.note, by: a.created_by, at: a.created_at }))
  });
}
