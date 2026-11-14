// Compute, the part that needs no database: turn stored rows into the engine's inputs, grade everything, and prepare what
// is saved. The server (functions/_lib/compute.js) and the browser (src/lib/compute.js) both use it, so a Compute gives the
// same results wherever it runs. Cloudflare's free plan allows a request only 10 ms of CPU, so on the live site the grading
// runs in the browser and the server only hands out the rows and saves the results, in small pieces.
import {
  processSession, mergeSupplementary, compactPaper, buildReference, computeCgpa, supplementaryGrace, isPostgraduate, POLICY, ENGINE_VERSION, STUDENT_STATE,
  sldOverrides
} from "../../engine/src/index.js";
import { effectiveThresholds } from "../functions/_lib/thresholds.js";

export { ENGINE_VERSION };
export const SUPP_POLICY = Object.freeze({ ...POLICY.DEFAULT, expectFromCmf: false });
export const policyFor = kind => (kind === "supplementary" ? SUPP_POLICY : POLICY.DEFAULT);

const parseJson = (v, fallback = null) => {
  if (v === null || v === undefined || v === "") return fallback;
  try { return JSON.parse(v); } catch { return fallback; }
};
const toRaw = v => (v === null || v === undefined ? null : v !== "" && !isNaN(Number(v)) ? Number(v) : v);

// A problem with what is loaded (no SMF, no CMF, nothing approved to build on): the server answers 400 with it.
export class InputError extends Error {
  constructor(message) { super(message); this.status = 400; }
}

// The rows each part is read with, in this order, so the engine sees students, papers and courses in the same order
// wherever Compute runs (the order papers arrive in is the order they are stored in).
export const QUERIES = {
  np: "SELECT code, ll, np FROM np_tables ORDER BY code, ll",
  grade: "SELECT code, ll, ul, letter, qualifier FROM grade_tables ORDER BY code, ll",
  weightage: "SELECT category, cie, ese FROM weightage_categories ORDER BY category",
  programmes: "SELECT code, pass_category, cie_np, ese_np, comb_np, grade_table, customised FROM programmes ORDER BY code",
  courses: `SELECT code, base_code, title, programmes, semester, batches, category, credits, cie_max, ese_max, cie_weight, ese_weight, calc_type,
    course_type, sequence, teaching_dept FROM courses WHERE session_id = ? ORDER BY code`,
  students: "SELECT regd_no, name, campus, programme, semester, batch, sem_credits, electives FROM students WHERE session_id = ? ORDER BY regd_no",
  marks: "SELECT regd_no, paper_code, component, raw FROM marks WHERE session_id = ? ORDER BY regd_no, paper_code, component",
  markEdits: "SELECT regd_no, paper_code, field, value FROM overrides WHERE session_id = ? AND type = 'mark' AND revoked_at IS NULL ORDER BY id",
  sld: `SELECT course_code, component, max_marks, regd_nos FROM marksheets
    WHERE session_id = ? AND regd_nos IS NOT NULL AND max_marks > 0 AND UPPER(course_code) LIKE '%SLD%' ORDER BY key`,
  overrides: `SELECT id, type, code, batch_key, regd_no, paper_code, field, value, reason FROM overrides
    WHERE session_id = ? AND revoked_at IS NULL AND type NOT IN ('mark', 'student-field') ORDER BY id`,
  previous: "SELECT regd_no, semester_no, credit_np, credits, gpa FROM previous_semesters WHERE session_id = ? ORDER BY regd_no, semester_no"
};

export function referenceTables({ np, grade, weightage, programmes }) {
  const npTables = {};
  for (const r of np) (npTables[r.code] ||= []).push({ ll: r.ll, np: isNaN(Number(r.np)) ? r.np : Number(r.np) });
  const gradeTables = {};
  for (const r of grade) (gradeTables[r.code] ||= []).push({ ll: r.ll, ul: r.ul, lg: r.letter, qa: r.qualifier });
  const weightageMap = Object.fromEntries(weightage.map(r => [String(r.category), { cie: r.cie, ese: r.ese }]));
  const programmeMap = Object.fromEntries(programmes.map(p => [p.code, {
    passCategory: p.pass_category, cieNP: p.cie_np, eseNP: p.ese_np, combNP: p.comb_np, gradeTable: p.grade_table, customised: !!p.customised
  }]));
  return { npTables, gradeTables, weightage: weightageMap, programmes: programmeMap };
}

export function previousMap(rows) {
  const previous = {};
  for (const p of rows) (previous[p.regd_no] ||= []).push({ semesterNo: p.semester_no, creditNP: p.credit_np, credits: p.credits, gpa: p.gpa });
  return previous;
}

// The rows read with QUERIES (as objects with the database's column names) to the engine's inputs.
export function buildInputs({ tables, courses, students, marks, markEdits, sld, overrides, previous, thresholds }) {
  const courseList = courses.map(c => ({
    code: c.code, baseCode: c.base_code, title: c.title, programmes: c.programmes, semester: c.semester,
    batches: parseJson(c.batches, []), category: c.category, credits: c.credits, cieMax: c.cie_max, eseMax: c.ese_max,
    cieWeight: c.cie_weight, eseWeight: c.ese_weight, calcType: c.calc_type, courseType: c.course_type, sequence: c.sequence, teachingDept: c.teaching_dept
  }));
  const reference = buildReference({ ...tables, courses: courseList });

  const studentMap = {};
  for (const s of students) {
    studentMap[s.regd_no] = {
      regdNo: s.regd_no, name: s.name, campus: s.campus, programme: s.programme, semester: s.semester,
      batch: s.batch, semCredits: s.sem_credits, electives: parseJson(s.electives, null)
    };
  }

  const cie = [], ese = [];
  for (const m of marks) (m.component === "CIE" ? cie : ese).push({ regdNo: m.regd_no, paperCode: m.paper_code, raw: toRaw(m.raw) });
  // Mark edits from the student page replace (or supply) the sheet's mark for that paper.
  for (const e of markEdits) {
    const list = e.field === "CIE" ? cie : ese;
    const row = list.find(m => m.regdNo === e.regd_no && m.paperCode === e.paper_code);
    if (row) row.raw = toRaw(e.value);
    else list.push({ regdNo: e.regd_no, paperCode: e.paper_code, raw: toRaw(e.value) });
  }

  // SLD Marks Statements set their own maximum for the students on them; any edit on the student page comes later and wins.
  const sldSheets = sld.map(s => ({ courseCode: s.course_code, component: s.component, maxMarks: s.max_marks, keys: parseJson(s.regd_nos, []) }));
  const overrideList = [...sldOverrides(sldSheets), ...overrides.map(o => ({
    id: o.id, type: o.type, code: o.code, batchKey: o.batch_key, regdNo: o.regd_no, paperCode: o.paper_code, field: o.field,
    value: o.value !== null && o.value !== "" && !isNaN(Number(o.value)) ? Number(o.value) : o.value, reason: o.reason
  }))];

  return { reference, students: studentMap, cie, ese, overrides: overrideList, previous: previousMap(previous), thresholds: effectiveThresholds(thresholds) };
}

// Grades everything. A supplementary needs `base` (each student's approved base result), its `attempt` number and,
// when it has no PREV of its own, the base session's (`basePrevious`).
export function evaluate(inputs, { kind = "regular", base = null, attempt = 1, basePrevious = null } = {}) {
  if (!Object.keys(inputs.students).length) throw new InputError("No students loaded — import the SMF first");
  if (!inputs.reference.courses.length) throw new InputError("No courses loaded — import the CMF first");
  const isSupp = kind === "supplementary";
  const policy = policyFor(kind);
  const { thresholds, previous: ownPrevious, ...sessionInputs } = inputs;
  let out, previous = ownPrevious, prevSource = "own";
  if (isSupp) {
    if (!base?.size) throw new InputError("Nothing is approved in the base session yet; approve its results before computing the supplementary");
    // Sem-Credits apply to the whole semester, which only exists after the merge.
    for (const s of Object.values(sessionInputs.students)) s.semCredits = null;
    const gracePool = regdNo => {
      const b = base.get(regdNo);
      if (!b) return null;
      const programme = inputs.students[regdNo].programme;
      return supplementaryGrace({ basePapers: b.papers, attempt, postgraduate: isPostgraduate(programme, inputs.reference.programmes[programme]?.passCategory) });
    };
    const suppOut = processSession({ ...sessionInputs, policy, gracePool, ...(thresholds ? { thresholds } : {}) });
    out = mergeSupplementary({ supp: suppOut, base, students: sessionInputs.students, reference: inputs.reference, overrides: inputs.overrides });
    // CGPA uses the supplementary PREV when one is loaded, otherwise the base session PREV (the semesters the regular result used).
    if (!Object.keys(ownPrevious).length && basePrevious) { previous = basePrevious; prevSource = "base"; }
  } else {
    out = processSession({ ...sessionInputs, ...(thresholds ? { thresholds } : {}) });
  }
  return { out, isSupp, policy, previous, prevSource };
}

// The approved base results a supplementary builds on, from the rows the base endpoint (or query) gives.
export function baseResults(rows, baseSessionId) {
  const base = new Map();
  for (const r of rows) {
    base.set(r.regd_no, {
      sessionId: baseSessionId, approvedAt: r.approved_at, approvedBy: r.approved_by, runId: r.run_id, digest: r.digest, batchKey: r.batch_key, sumCredits: r.sum_credits,
      publishedGPA: r.published_gpa !== null && !isNaN(Number(r.published_gpa)) ? Number(r.published_gpa) : r.published_gpa,
      papers: parseJson(r.papers, [])
    });
  }
  return base;
}

export async function sha256(text, length = 16) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("").slice(0, length);
}

// The columns of a saved result, in the order each row of `rows` gives them (run_id and session_id are added on saving).
export const RESULT_COLUMNS = ["regd_no", "batch_key", "state", "releasable", "sum_credits", "sum_credit_np", "calculated_gpa", "published_gpa",
  "letter_grade", "qualifier", "is_absent", "failed_courses", "reasons", "digest", "papers"];

export const exceptionKey = e => [e.code, e.batchKey ?? "", e.regdNo ?? "", e.paperCode ?? "", e.courseCode ?? ""].join("|");

// Everything a Compute saves, worked out from the grading: the result rows (by Regd No), a fingerprint of them (equal
// fingerprints mean nothing changed, so nothing is saved), the batches, the issues and the summary.
export async function buildSave({ out, isSupp, previous, prevSource }, inputs) {
  const rows = [];
  for (const r of out.results) {
    const student = inputs.students[r.regdNo];
    const tableCode = inputs.reference.programmes[student.programme]?.gradeTable || "II-A";
    const cgpaResult = r.state === STUDENT_STATE.RESULT ? computeCgpa(r, previous[r.regdNo], inputs.reference, tableCode) : null;
    const cgpa = cgpaResult && isSupp ? { ...cgpaResult, prevSource } : cgpaResult;
    const papers = r.papers.map(compactPaper);
    // A supplementary result also depends on the base result it was built from, so a base correction makes it "changed".
    const digest = await sha256(JSON.stringify(isSupp
      ? [r.state, r.releasable, r.publishedGPA, r.letterGrade, r.sumCredits, papers.map(p => [p.paperCode, p.combNP, p.status, p.origin]), r.supplementary?.baseDigest ?? null]
      : [r.state, r.releasable, r.publishedGPA, r.letterGrade, r.sumCredits, papers.map(p => [p.paperCode, p.combNP, p.status])]));
    const extras = JSON.stringify({ reasons: r.reasons, blocking: r.blocking, batchBlocked: r.batchBlocked, cgpa, effectiveBatch: r.effectiveBatch, grace: r.grace ?? null, ...(isSupp ? { supplementary: r.supplementary } : {}) });
    rows.push([r.regdNo, r.batchKey, r.state, r.releasable ? 1 : 0, r.sumCredits, r.sumCreditNP, r.calculatedGPA,
      r.publishedGPA === null || r.publishedGPA === undefined ? null : String(r.publishedGPA), r.letterGrade || null, r.qualifier || null,
      r.isAbsent, r.failedCourses.join(", ") || null, extras, digest, JSON.stringify(papers)]);
  }
  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const fingerprint = await sha256(JSON.stringify(rows), 64);
  // One per result, in the same order: a result whose fingerprint matches the latest run's is copied, not sent again.
  const hashes = await Promise.all(rows.map(r => sha256(JSON.stringify(r), 32)));

  const batches = out.batches.map(b => ({ key: b.key, programme: b.programme, semester: b.semester, batch: b.batch, stats: JSON.stringify(b) }));

  const seen = new Set();
  const exceptions = [];
  for (const e of out.exceptions) {
    const key = exceptionKey(e);
    if (seen.has(key)) continue;
    seen.add(key);
    exceptions.push({ key, code: e.code, severity: e.severity, batchKey: e.batchKey ?? null, regdNo: e.regdNo ?? null, paperCode: e.paperCode ?? null,
      courseCode: e.courseCode ?? null, message: e.message, details: JSON.stringify(e.details || {}), accepted: e.accepted ? 1 : 0 });
  }

  const summary = {
    students: out.results.length,
    releasable: out.results.filter(r => r.releasable).length,
    held: out.results.filter(r => !r.releasable && r.state !== STUDENT_STATE.WITHHELD).length,
    withheld: out.results.filter(r => r.state === STUDENT_STATE.WITHHELD).length,
    batches: out.batches.length,
    blocking: out.exceptions.filter(e => e.severity === "block" && !e.accepted).length,
    warnings: out.exceptions.filter(e => e.severity === "warn" && !e.accepted).length
  };
  return { rows, hashes, fingerprint, batches, exceptions, summary };
}

// Which issues to add, change or remove, given the stored ones ({ key, severity, message, details, accepted }).
export function diffExceptions(stored, fresh) {
  const old = new Map(stored.map(e => [e.key, e]));
  const inserts = [], updates = [], deletes = [];
  const keep = new Set();
  for (const e of fresh) {
    keep.add(e.key);
    const o = old.get(e.key);
    if (!o) inserts.push(e);
    else if (o.severity !== e.severity || o.message !== e.message || o.details !== e.details || Number(o.accepted) !== e.accepted) updates.push(e);
  }
  for (const key of old.keys()) if (!keep.has(key)) deletes.push(key);
  return { inserts, updates, deletes };
}

// Which batches to write, given the stored ones ({ id, key, run_id, stats }); a batch keeps its id, a new one gets the next.
export function diffBatches(stored, fresh, runId) {
  const old = new Map(stored.map(b => [b.key, b]));
  let nextId = Math.max(0, ...stored.map(b => b.id)) + 1;
  const upserts = [];
  for (const b of fresh) {
    const o = old.get(b.key);
    if (o && o.run_id === runId && o.stats === b.stats) continue;
    upserts.push({ id: o?.id ?? nextId++, ...b });
  }
  return upserts;
}
