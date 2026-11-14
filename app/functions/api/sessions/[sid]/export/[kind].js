import { csv, HttpError } from "../../../../_lib/http.js";
import { all, first, parseJson } from "../../../../_lib/db.js";
import { latestRun } from "../../../../_lib/compute.js";
import { approvalMap, studentStatus } from "../../../../_lib/state.js";
import { integralRow } from "../../../../_lib/integral.js";

export async function onRequestGet({ env, params, request }) {
  const db = env.DB;
  const scope = new URL(request.url).searchParams.get("scope") || "releasable";
  const session = await first(db, "SELECT * FROM exam_sessions WHERE id = ?", params.sid);
  if (!session) throw new HttpError(404, "Session not found");

  // A standalone report: it needs no compute run.
  if (params.kind === "integral.csv") {
    const rows = (await all(db, "SELECT * FROM integral_items WHERE session_id = ? ORDER BY regd_no", params.sid)).map(integralRow);
    return csv([["Regd No", "INT1_NP", "INT2_NP", "INT3_NP", "INT4_NP", "INT5_NP", "Total", "Items"],
      ...rows.map(r => [r.regdNo, ...r.items, r.total.toFixed(2), r.count])], `${session.id}-integral-items.csv`);
  }

  const runRow = await latestRun(db, params.sid);
  if (!session || !runRow) throw new HttpError(404, "Nothing computed yet");

  const students = new Map((await all(db, "SELECT * FROM students WHERE session_id = ?", params.sid)).map(s => [s.regd_no, s]));
  const approvals = await approvalMap(db, params.sid);
  let rows = await all(db, "SELECT * FROM student_results WHERE run_id = ? ORDER BY batch_key, regd_no", runRow.id);
  rows = rows.filter(r => {
    const st = studentStatus(r, approvals.get(r.regd_no));
    if (scope === "all") return true;
    if (scope === "approved") return st === "approved";
    return r.releasable || r.state === "Withheld";
  });
  const stem = `${session.id}-${params.kind.replace(/\.csv$/, "")}-${scope}`;

  if (params.kind === "final.csv") {
    const supp = session.kind === "supplementary";
    const out = [["Program", "Campus", "Semester", "Regd No", "Name", "Total Paper", "Calculated GPA", "Sum of Credits", "Sum of (Credit * COMB NP)", "Published GPA", "LetterGrade", "QA", "Is Absent?", "Witheld case", "Failed Course", "Status",
      ...(supp ? ["Result type", "Replaced papers"] : [])]];
    for (const r of rows) {
      const s = students.get(r.regd_no) || {};
      const papers = parseJson(r.papers, []);
      out.push([s.programme, s.campus, s.semester, r.regd_no, s.name, papers.length, r.calculated_gpa, r.sum_credits, r.sum_credit_np,
        r.published_gpa, r.letter_grade, r.qualifier, r.is_absent, r.state === "Withheld" ? "WITHHELD" : "", r.failed_courses,
        studentStatus(r, approvals.get(r.regd_no)),
        ...(supp ? ["Supplementary", (parseJson(r.reasons, {}).supplementary?.replaced || []).join(", ")] : [])]);
    }
    return csv(out, `${stem}.csv`);
  }

  if (params.kind === "failures.csv") {
    const out = [["S.No.", "Exam", "Course-Programme", "Course-Semester", "Student-Semester", "Programme", "Campus", "Semester", "Regd No", "Name", "Absent?", "Paper Code", "Course Category", "Paper Title", "CIE %", "ESE %", "COMB %"]];
    const courses = new Map((await all(db, "SELECT code, programmes, semester, category FROM courses WHERE session_id = ?", params.sid)).map(c => [c.code, c]));
    let n = 0;
    for (const r of rows) {
      const s = students.get(r.regd_no) || {};
      for (const p of parseJson(r.papers, [])) {
        if (p.status !== "Fails" && p.status !== "Absent") continue;
        const c = courses.get(p.courseCode) || {};
        out.push([++n, session.name, c.programmes, c.semester, s.semester, s.programme, s.campus, s.semester, r.regd_no, s.name,
          p.status === "Absent" ? 1 : 0, p.paperCode, c.category, p.title, p.ciePct, p.eseComptPct, p.combPct]);
      }
    }
    return csv(out, `${stem}.csv`);
  }

  if (params.kind === "digilocker.csv") {
    const N = 14;
    const head = ["Regd No", "Programme", "Name", "LetterGrade", "Semester", "P/F/W Status", "Published GPA"];
    const blocks = ["NM", "", "_CIE_NP", "_ESE_NP", "_GRADE_POINTS", "_CREDIT", "_CREDIT_POINTS", "_TYPE"];
    for (const b of blocks) for (let i = 1; i <= N; i++) head.push(b === "NM" ? `SUB${i}NM` : `SUB${i}${b}`);
    for (let i = 1; i <= N; i++) head.push(`CC${i}`);
    const out = [head];
    for (const r of rows) {
      const s = students.get(r.regd_no) || {};
      const papers = parseJson(r.papers, []).slice(0, N);
      const pfw = r.state === "Withheld" ? "Withheld" : r.published_gpa === "Fail" ? "Fail" : r.published_gpa === "Absent" ? "Absent" : "Pass";
      const line = [r.regd_no, s.programme, s.name, r.letter_grade, s.semester, pfw, r.published_gpa];
      const pick = {
        NM: p => p.title, "": p => p.paperCode, _CIE_NP: p => p.cieNP, _ESE_NP: p => p.eseNP, _GRADE_POINTS: p => p.combNP,
        _CREDIT: p => p.credits, _CREDIT_POINTS: p => (typeof p.combNP === "number" ? p.combNP * p.credits : ""), _TYPE: p => p.course?.calcType
      };
      for (const b of blocks) for (let i = 0; i < N; i++) line.push(papers[i] ? pick[b](papers[i]) : "");
      for (let i = 0; i < N; i++) line.push(papers[i] ? papers[i].courseCode : "");
      out.push(line);
    }
    return csv(out, `${stem}.csv`);
  }

  if (params.kind === "cgpa.csv") {
    const out = [["Regd No", "Name", "Programme", "Campus", "Batch", "Current Semester", "Previous Semesters", "CURR_CRxNP", "CURR_CREDS", "CURR_GPA", "TOTAL_CRxNP", "TOTAL_CREDS", "CGPA", "Letter Grade", "QA", "Status", "Reason"]];
    for (const r of rows) {
      const s = students.get(r.regd_no) || {};
      const c = parseJson(r.reasons, {}).cgpa || { status: "WITHHELD", reason: "No result for current semester" };
      out.push([r.regd_no, s.name, s.programme, s.campus, s.batch, s.semester, (c.prior || []).map(p => `S${p.semesterNo}:${p.gpa ?? ""}`).join(" "),
        r.sum_credit_np, r.sum_credits, r.published_gpa, c.totalCreditNP, c.totalCredits, c.cgpa, c.letterGrade, c.qualifier, c.status, c.reason]);
    }
    return csv(out, `${stem}.csv`);
  }

  if (params.kind === "exceptions.csv") {
    const ex = await all(db, "SELECT * FROM exceptions WHERE session_id = ? ORDER BY severity, code, batch_key, regd_no", params.sid);
    const out = [["Severity", "Type", "Batch", "Regd No", "Name", "Paper", "Message", "Accepted", "First seen"]];
    for (const e of ex) out.push([e.severity, e.code, e.batch_key, e.regd_no, students.get(e.regd_no)?.name, e.paper_code, e.message, e.accepted ? "yes" : "", e.first_seen]);
    return csv(out, `${session.id}-exceptions.csv`);
  }

  throw new HttpError(404, `Unknown export ${params.kind}`);
}
