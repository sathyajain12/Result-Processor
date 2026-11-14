import { json, HttpError } from "../../../../_lib/http.js";
import { all, first, parseJson } from "../../../../_lib/db.js";
import { latestRun, explainPaper, loadReferenceTables } from "../../../../_lib/compute.js";
import { approvalMap, studentStatus } from "../../../../_lib/state.js";

export async function onRequestGet({ env, params }) {
  const db = env.DB;
  const sid = params.sid, regd = params.regd;
  const student = await first(db, "SELECT * FROM students WHERE session_id = ? AND regd_no = ?", sid, regd);
  if (!student) throw new HttpError(404, `Student ${regd} is not in the SMF for this session`);
  const run = await latestRun(db, sid);
  const row = run ? await first(db, "SELECT * FROM student_results WHERE run_id = ? AND regd_no = ?", run.id, regd) : null;

  const tables = await loadReferenceTables(db);
  const papers = row ? parseJson(row.papers, []).map(p => ({ ...p, trace: explainPaper(p, tables) })) : [];

  const session = await first(db, "SELECT kind, base_session_id FROM exam_sessions WHERE id = ?", sid);
  const [history, changes, sheetMarks, exceptions, overrides, batch, baseSession, reappearedIn] = await Promise.all([
    all(db, `SELECT r.id, r.started_at, s.state, s.published_gpa, s.letter_grade, s.digest
             FROM runs r CROSS JOIN student_results s ON s.run_id = r.id AND s.regd_no = ? WHERE r.session_id = ? ORDER BY r.started_at`, regd, sid),
    all(db, "SELECT * FROM mark_changes WHERE session_id = ? AND regd_no = ? ORDER BY id DESC", sid, regd),
    all(db, "SELECT paper_code, component, raw FROM marks WHERE session_id = ? AND regd_no = ?", sid, regd),
    all(db, "SELECT * FROM exceptions WHERE session_id = ? AND regd_no = ?", sid, regd),
    all(db, "SELECT * FROM overrides WHERE session_id = ? AND (regd_no = ? OR (regd_no IS NULL AND paper_code IN (SELECT paper_code FROM marks WHERE session_id = ? AND regd_no = ?))) ORDER BY id DESC", sid, regd, sid, regd),
    row ? first(db, "SELECT id FROM batches WHERE session_id = ? AND key = ?", sid, row.batch_key) : null,
    session?.base_session_id ? first(db, "SELECT id, name FROM exam_sessions WHERE id = ?", session.base_session_id) : null,
    all(db, `SELECT s.id, s.name FROM exam_sessions s JOIN students st ON st.session_id = s.id
             WHERE s.base_session_id = ? AND st.regd_no = ? ORDER BY s.created_at`, sid, regd)
  ]);

  const timeline = [];
  let lastDigest = null;
  for (const h of history) {
    if (h.digest === lastDigest) continue;
    timeline.push({ runId: h.id, at: h.started_at, state: h.state, publishedGpa: h.published_gpa, letterGrade: h.letter_grade });
    lastDigest = h.digest;
  }

  const approvals = await approvalMap(db, sid);
  const detention = await first(db, "SELECT reason, updated_by, updated_at FROM detention_reasons WHERE session_id = ? AND regd_no = ?", sid, regd);
  const extra = row ? parseJson(row.reasons, {}) : {};

  return json({
    student: { regdNo: student.regd_no, name: student.name, campus: student.campus, programme: student.programme, semester: student.semester, batch: student.batch, semCredits: student.sem_credits, electives: parseJson(student.electives, null) },
    batchId: batch?.id ?? null,
    result: row ? {
      state: row.state, releasable: !!row.releasable, status: studentStatus(row, approvals.get(regd)),
      sumCredits: row.sum_credits, sumCreditNP: row.sum_credit_np, calculatedGpa: row.calculated_gpa, publishedGpa: row.published_gpa,
      letterGrade: row.letter_grade, qualifier: row.qualifier, failedCourses: row.failed_courses, isAbsent: row.is_absent,
      reasons: extra.reasons || [], cgpa: extra.cgpa || null, effectiveBatch: extra.effectiveBatch, grace: extra.grace || null, runId: run.id, runAt: run.started_at,
      supplementary: extra.supplementary ? { ...extra.supplementary, baseSessionName: baseSession?.name ?? null } : null,
      approval: approvals.get(regd) || null
    } : null,
    papers,
    timeline,
    markChanges: changes.map(c => ({ paperCode: c.paper_code, component: c.component, from: c.old_raw, to: c.new_raw, at: c.changed_at })),
    exceptions: exceptions.map(e => ({ key: e.key, code: e.code, severity: e.severity, paperCode: e.paper_code, message: e.message, accepted: !!e.accepted })),
    detentionReason: detention ? { reason: detention.reason, by: detention.updated_by, at: detention.updated_at } : null,
    overrides: overrides.map(o => ({ id: o.id, type: o.type, paperCode: o.paper_code, field: o.field, value: o.value, sheetValue: o.sheet_value, reason: o.reason, by: o.created_by, at: o.created_at, revokedAt: o.revoked_at })),
    // Active edits made on this page, keyed for the UI: "mark|PAPER|CIE", "course|PAPER|credits", "student|semCredits".
    edits: Object.fromEntries(overrides.filter(o => !o.revoked_at && o.regd_no === regd && ["mark", "course-field", "student-field"].includes(o.type)).map(o => [
      o.type === "mark" ? `mark|${o.paper_code}|${o.field}` : o.type === "course-field" ? `course|${o.paper_code}|${o.field}` : `student|${o.field}`,
      { id: o.id, value: o.value, sheetValue: o.sheet_value, reason: o.reason, by: o.created_by, at: o.created_at }
    ])),
    sheetMarks: Object.fromEntries(sheetMarks.map(m => [`${m.paper_code}|${m.component}`, m.raw])),
    kind: session?.kind || "regular",
    baseSession,
    reappearedIn,
  });
}
