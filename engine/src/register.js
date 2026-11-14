import { STATUS } from "./constants.js";
import { isNum, roundSheets } from "./math.js";
import { seriatimOrder } from "./course.js";

// One student's page of the Grade register, built from the processor's own stored result.
//   student    { regdNo, name, campus, programme, semester }
//   result     { publishedGPA, letterGrade, qualifier }
//   papers     the stored papers of the result (compactPaper)
//   courses    Map course code -> { title, courseType, category, sequence }
//   nonCredit  courses the student takes that have no marks at all (nonCreditCourses)
//   weightage  weightage category -> { cie, ese }, for courses with no CIE / ESE WTG of their own
// A paper's credits and credit points are earned only when it is passed.

const NONE = "--";
const text = v => { const s = String(v ?? "").trim(); return s === "" ? null : s; };
const asNum = v => (v === null || v === undefined || String(v).trim() === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const pct = x => Math.round(x * 10000) / 100;

// The CIE/ESE split the paper was graded with, worked out as computePaper does: a per-student edit, then the course's own
// weights, then its weightage category. "25/75", or null when none is known.
function weightageOf(p, weightage) {
  const c = { ...(p.course || {}), ...(p.overrides || {}) };
  const cie = asNum(c.cieWeight), ese = asNum(c.eseWeight);
  const w = cie !== null && ese !== null ? { cie, ese } : weightage?.[String(c.weightageCategory)] ?? null;
  return w && isNum(w.cie) && isNum(w.ese) ? `${pct(w.cie)}/${pct(w.ese)}` : null;
}

function paperRow(p, courses, weightage) {
  const meta = courses.get(p.courseCode) || courses.get(p.paperCode) || {};
  const passed = p.status === STATUS.PASS;
  const absent = p.status === STATUS.ABSENT;
  const credits = isNum(p.credits) ? p.credits : 0;
  const mark = v => (v === "A" ? "Ab" : v ?? null);
  const remarks = [];
  if (p.origin === "supp") remarks.push("Re-appeared");
  for (const [k, comp] of [["sldCieMax", "CIE"], ["sldEseMax", "ESE"]]) {
    if (p.overrides?.[k]) remarks.push(`SLD (${comp} out of ${p.overrides[k]})`);
  }
  if (p.grace) remarks.push(`Graced +${p.grace.marks}`);
  if (absent) remarks.push("Absent");
  else if (p.status === STATUS.FAIL) remarks.push("Failed");
  return {
    courseCode: p.paperCode, title: p.title ?? meta.title ?? null, sequence: meta.sequence ?? null,
    type: text(meta.courseType), category: text(meta.category) === NONE ? null : text(meta.category), credits,
    weightage: weightageOf(p, weightage),
    cieMarks: mark(p.cie),
    // A graced ESE shows the marks the ESE % and COMB % were worked out from.
    eseMarks: p.grace ? p.grace.gracedMarks : mark(p.ese),
    ciePct: p.cie === "A" ? null : p.ciePct ?? null,
    esePct: p.eseComptPct ?? null,
    combPct: absent ? null : p.combPct ?? null,
    cieNp: p.cieNP ?? null, eseNp: p.eseNP ?? null,
    combNp: absent ? "Ab" : p.combNP ?? null,
    earnedCred: passed ? credits : 0,
    earnedPoints: passed && isNum(p.combNP) ? roundSheets(credits * p.combNP, 2) : 0,
    failed: !passed,
    remarks: remarks.join(", ") || null
  };
}

function nonCreditRow(c) {
  return {
    courseCode: c.code, title: c.title ?? null, sequence: c.sequence ?? null,
    type: text(c.courseType), category: text(c.category) === NONE ? null : text(c.category), credits: isNum(c.credits) ? c.credits : 0,
    weightage: null,
    cieMarks: null, eseMarks: null, ciePct: null, esePct: null, combPct: null, cieNp: null, eseNp: null, combNp: null,
    earnedCred: null, earnedPoints: null, failed: false, remarks: null
  };
}

// A search for one or more students. Commas, semicolons and new lines separate them, so a name can keep its spaces;
// Regd Nos can also be separated by spaces.
export function searchTerms(q, limit = 20) {
  const terms = String(q ?? "").split(/[,;\r\n]+/).map(t => t.trim()).filter(Boolean)
    .flatMap(t => (/^\d[\d\s]*$/.test(t) ? t.split(/\s+/) : [t]));
  return [...new Set(terms)].slice(0, limit);
}

export function registerEntry({ student, result, papers, courses, nonCredit = [], weightage = {} }) {
  const listed = new Set(papers.flatMap(p => [p.paperCode, p.courseCode]));
  const rows = [...papers.map(p => paperRow(p, courses, weightage)), ...nonCredit.filter(c => !listed.has(c.code)).map(nonCreditRow)]
    .sort((a, b) => seriatimOrder({ sequence: a.sequence, code: a.courseCode }, { sequence: b.sequence, code: b.courseCode }))
    .map(({ sequence, ...row }, i) => ({ sno: i + 1, ...row }));
  return {
    regdNo: student.regdNo, name: student.name, campus: student.campus, programme: student.programme, semester: student.semester,
    rows,
    summary: {
      sumEarnedCred: roundSheets(rows.reduce((n, r) => n + (r.earnedCred ?? 0), 0), 2),
      sumEarnedPoints: roundSheets(rows.reduce((n, r) => n + (r.earnedPoints ?? 0), 0), 2),
      semesterGpa: result.publishedGPA ?? null,
      letterGrade: result.letterGrade || null,
      qualGrade: result.qualifier || null
    }
  };
}
