import { STATUS, CALC_TYPE } from "./constants.js";
import { isNum, roundSheets } from "./math.js";
import { seriatimOrder } from "./course.js";

// One student's page of the Grade register, built from the processor's own stored result.
//   student    { regdNo, name, campus, programme, semester }
//   result     { publishedGPA, letterGrade, qualifier }
//   papers     the stored papers of the result (compactPaper)
//   courses    Map course code -> { title, courseType, category, sequence }
//   nonCredit  courses the student takes that have no marks at all (nonCreditCourses)
//   weightage  weightage category -> { cie, ese }, for courses with no CIE / ESE WTG of their own
//   grace      the result's grace totals (reasons.grace: pool, available, used, left, and for a supplementary usedBefore, attempt, terminal)
//   refused    papers close enough to grace that the pool could not cover: [{ paperCode, needed, left }] (GRACE_NOT_AVAILABLE issues)
// A paper's credits and credit points are earned only when it is passed.

const NONE = "--";
const text = v => { const s = String(v ?? "").trim(); return s === "" ? null : s; };
const asNum = v => (v === null || v === undefined || String(v).trim() === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const pct = x => Math.round(x * 10000) / 100;
const marksOf = x => roundSheets(x, 2);

// The CIE/ESE split the paper was graded with, worked out as computePaper does: a per-student edit, then the course's own
// weights, then its weightage category. "25/75", or null when none is known.
function weightsOf(p, weightage) {
  const c = { ...(p.course || {}), ...(p.overrides || {}) };
  const cie = asNum(c.cieWeight), ese = asNum(c.eseWeight);
  const w = cie !== null && ese !== null ? { cie, ese } : weightage?.[String(c.weightageCategory)] ?? null;
  return w && isNum(w.cie) && isNum(w.ese) ? w : null;
}
function weightageOf(p, weightage) {
  const w = weightsOf(p, weightage);
  return w ? `${pct(w.cie)}/${pct(w.ese)}` : null;
}

// The COMB % a graced paper had before its grace: the exact figure grace was decided on (combFromPct). Runs from before
// that was stored have it for COMB grace only; for ESE grace it is worked out as computePaper does, from the CIE % and
// the ESE % before grace (CIE 59%, ESE 37% at 50/50: 48). null when the weights are not known.
function combBefore(p, weightage) {
  const g = p.grace;
  if (isNum(g.combFromPct)) return g.combFromPct;
  if (g.kind === "COMB") return g.fromPct;
  const c = { ...(p.course || {}), ...(p.overrides || {}) };
  if (c.calcType === CALC_TYPE.ESE_ONLY) return roundSheets(g.eseFromPct ?? 0);
  if (c.calcType !== CALC_TYPE.CIE_AND_ESE) return null;
  const w = weightsOf(p, weightage);
  return w ? roundSheets((p.ciePct ?? 0) * w.cie + (g.eseFromPct ?? 0) * w.ese) : null;
}

function paperRow(p, courses, weightage, refused) {
  const meta = courses.get(p.courseCode) || courses.get(p.paperCode) || {};
  const passed = p.status === STATUS.PASS;
  const absent = p.status === STATUS.ABSENT;
  const credits = isNum(p.credits) ? p.credits : 0;
  const mark = v => (v === "A" ? "Ab" : v ?? null);
  // A component the course does not have (maximum 0, after any per-student edit) shows no marks, even when a sheet sent one:
  // a viva entered in both the CIE and the ESE sheet, on an ESE-only course, would otherwise print its mark under CIE too.
  // The stray mark is still kept and flagged ("CIE mark 28 in MTOC-108, but the CMF has no CIE"); it just is not printed.
  const own = { ...(p.course || {}), ...(p.overrides || {}) };
  const hasNo = k => own[k] === 0;
  const remarks = [];
  if (p.origin === "supp") remarks.push("Re-appeared");
  for (const [k, comp] of [["sldCieMax", "CIE"], ["sldEseMax", "ESE"]]) {
    if (p.overrides?.[k]) remarks.push(`SLD (${comp} out of ${p.overrides[k]})`);
  }
  if (p.grace) remarks.push(`Graced +${p.grace.marks} (${p.grace.kind})`);
  else if (refused.has(p.paperCode)) remarks.push("Not graced: pool short");
  if (absent) remarks.push("Absent");
  else if (p.status === STATUS.FAIL) remarks.push("Failed");
  return {
    courseCode: p.paperCode, title: p.title ?? meta.title ?? null, sequence: meta.sequence ?? null,
    type: text(meta.courseType), category: text(meta.category) === NONE ? null : text(meta.category), credits,
    weightage: weightageOf(p, weightage),
    cieMarks: hasNo("cieMax") ? null : mark(p.cie),
    // A graced ESE shows the marks the ESE % and COMB % were worked out from.
    eseMarks: p.grace ? p.grace.gracedMarks : hasNo("eseMax") ? null : mark(p.ese),
    ciePct: p.cie === "A" ? null : p.ciePct ?? null,
    esePct: p.eseComptPct ?? null,
    combPct: absent ? null : p.combPct ?? null,
    cieNp: p.cieNP ?? null, eseNp: p.eseNP ?? null,
    combNp: absent ? "Ab" : p.combNP ?? null,
    earnedCred: passed ? credits : 0,
    earnedPoints: passed && isNum(p.combNP) ? roundSheets(credits * p.combNP, 2) : 0,
    failed: !passed, ...(p.grace ? { graced: true } : {}),
    remarks: remarks.join(", ") || null
  };
}

// What the register says about the student's grace: each graced paper with what was raised and by how much, the papers the
// pool could not cover, and the pool itself. null when no paper was graced or refused. `order` lists course codes as the
// register does, so the papers come in the same order.
function gracingOf(papers, grace, refused, order, weightage) {
  const at = code => { const i = order.indexOf(code); return i < 0 ? order.length : i; };
  const graced = papers.filter(p => p.grace).sort((a, b) => at(a.paperCode) - at(b.paperCode)).map(p => {
    const g = p.grace;
    return {
      // The grace in points: how far the ESE (ESE grace) or COMB (COMB grace) was short of its pass mark. It costs that
      // share of the ESE maximum in marks: 3 points on an ESE out of 75 cost 2.25 marks.
      courseCode: p.paperCode, title: p.title ?? null, kind: g.kind, marks: g.marks, exactMarks: g.exactMarks ?? g.marks, points: marksOf(g.toPct - g.fromPct), passPct: g.toPct, shortPct: g.fromPct,
      eseMax: p.course?.eseMax ?? null, eseFrom: asNum(p.ese), eseTo: g.gracedMarks,
      esePctFrom: g.eseFromPct, esePctTo: g.eseToPct,
      combPctFrom: combBefore(p, weightage), combPctTo: g.kind === "COMB" ? g.toPct : p.combPct ?? null,
      combNp: p.combNP ?? null
    };
  });
  const notGraced = [...refused.values()].sort((a, b) => at(a.paperCode) - at(b.paperCode))
    .map(r => ({ courseCode: r.paperCode, needed: r.needed, left: r.left }));
  if (!graced.length && !notGraced.length) return null;
  const g = grace || {};
  return {
    pool: g.pool ?? null, available: g.available ?? g.pool ?? null,
    used: g.used ?? marksOf(graced.reduce((n, p) => n + p.marks, 0)), left: g.left ?? null,
    attempt: g.attempt ?? null, terminal: g.terminal ?? null, usedBefore: g.usedBefore ?? null,
    papers: graced, notGraced
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

export function registerEntry({ student, result, papers, courses, nonCredit = [], weightage = {}, grace = null, refused = [] }) {
  const listed = new Set(papers.flatMap(p => [p.paperCode, p.courseCode]));
  // Only papers that failed for want of grace: one that passed some other way (an override since) needs no note.
  const short = new Map(refused.filter(r => papers.some(p => p.paperCode === r.paperCode && !p.grace && p.status !== STATUS.PASS)).map(r => [r.paperCode, r]));
  const rows = [...papers.map(p => paperRow(p, courses, weightage, short)), ...nonCredit.filter(c => !listed.has(c.code)).map(nonCreditRow)]
    .sort((a, b) => seriatimOrder({ sequence: a.sequence, code: a.courseCode }, { sequence: b.sequence, code: b.courseCode }))
    .map(({ sequence, ...row }, i) => ({ sno: i + 1, ...row }));
  return {
    regdNo: student.regdNo, name: student.name, campus: student.campus, programme: student.programme, semester: student.semester,
    rows,
    gracing: gracingOf(papers, grace, short, rows.map(r => r.courseCode), weightage),
    summary: {
      sumEarnedCred: roundSheets(rows.reduce((n, r) => n + (r.earnedCred ?? 0), 0), 2),
      sumEarnedPoints: roundSheets(rows.reduce((n, r) => n + (r.earnedPoints ?? 0), 0), 2),
      semesterGpa: result.publishedGPA ?? null,
      letterGrade: result.letterGrade || null,
      qualGrade: result.qualifier || null
    }
  };
}
