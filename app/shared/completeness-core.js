// The completeness report (the Apps Script one, section by section), built from rows. The server builds it from the latest
// Compute as stored; the browser's "Check now" builds it from its own grading of the current marks (nothing saved).
// Batches are Programme | Semester | Batch, as in the sheet. A hard block keeps the students it affects pending (or the whole
// batch for batch-level problems); it does not stop the rest of the batch.
import { programmesMatch, isCohortProgramme } from "../../engine/src/index.js";
import { exceptionKey } from "./compute-core.js";

const NEEDS_CIE = new Set([1, 2, 3]);
const NEEDS_ESE = new Set([2, 4]);
const parseJson = (v, fallback = null) => {
  if (v === null || v === undefined || v === "") return fallback;
  try { return JSON.parse(v); } catch { return fallback; }
};

// A grading (engine output) as the rows the report reads, in the order the stored ones come in.
export function liveRows(out, batchIds) {
  const seen = new Set();
  const exceptions = [];
  for (const e of out.exceptions) {   // the same de-duplication as Compute's issue list
    const key = exceptionKey(e);
    if (seen.has(key)) continue;
    seen.add(key);
    exceptions.push({ code: e.code, severity: e.severity, batch_key: e.batchKey ?? null, regd_no: e.regdNo ?? null, paper_code: e.paperCode ?? null,
      course_code: e.courseCode ?? null, message: e.message, details: JSON.stringify(e.details || {}), accepted: e.accepted ? 1 : 0 });
  }
  const cmp = (a, b) => (a === b ? 0 : a === null ? -1 : b === null ? 1 : a < b ? -1 : 1);
  exceptions.sort((a, b) => cmp(a.batch_key, b.batch_key) || cmp(a.regd_no, b.regd_no) || cmp(a.paper_code, b.paper_code));
  const batches = out.batches.map(b => ({ id: batchIds.get(b.key) ?? null, key: b.key, programme: b.programme, semester: b.semester, batch: b.batch, stats: JSON.stringify(b) }))
    .sort((a, b) => cmp(a.key, b.key));
  const results = out.results.map(r => ({ regd_no: r.regdNo, batch_key: r.batchKey, state: r.state, releasable: r.releasable ? 1 : 0 }));
  return { exceptions, batches, results };
}

// Rows: exceptions, batches, results (regd_no, batch_key, state, releasable), students, marks (regd_no, component, raw),
// courses (programmes, semester, batches, calc_type, cie_max, ese_max), overrides and detention reasons, as stored.
// The parts of the report that need every mark, student and course: Rule 1A, "No fetch data" and the students' names.
// They change only with the inputs, so Compute works them out once and stores them with the run (runs.arrival); opening
// the report then reads that one row instead of about 17,000 rows of marks, students and courses.
export function arrivalPart({ students, marks, courses }) {
  const name = new Map(students.map(s => [s.regd_no, s.name]));
  const keyOf = s => `${s.programme}|${s.semester}|${s.batch ?? ""}`;

  // ── Rule 1A / No fetch data: who appears in the CIE and ESE files at all ──
  const left = new Set(marks.filter(m => String(m.raw ?? "").trim().toUpperCase() === "L").map(m => m.regd_no));
  const inCie = new Set(), inEse = new Set(), cieWithMark = new Set(), eseWithMark = new Set();
  for (const m of marks) {
    const v = String(m.raw ?? "").trim().toUpperCase();
    // A student absent in one file is documented in the other too (they never sat that exam).
    if (m.component === "CIE") { inCie.add(m.regd_no); if (v === "A") inEse.add(m.regd_no); if (v && v !== "L") cieWithMark.add(m.regd_no); }
    else { inEse.add(m.regd_no); if (v === "A") inCie.add(m.regd_no); if (v && v !== "L") eseWithMark.add(m.regd_no); }
  }
  const byBatch = new Map();
  for (const s of students) {
    if (left.has(s.regd_no)) continue;
    const k = keyOf(s);
    (byBatch.get(k) || byBatch.set(k, []).get(k)).push(s.regd_no);
  }
  // Which components a batch's courses need, from the CMF: the programme's own courses for that semester and batch (or for
  // any batch when the CMF lists none for it, as for detained students; the engine places them the same way), plus the
  // shared cohort courses ("Fourth UG"…) for the batch. A programme with no CMF courses is left to Rule 0.
  const courseRows = courses.map(c => ({ ...c, batches: Array.isArray(c.batches) ? c.batches : parseJson(c.batches, []) }));
  const inBatch = (c, batch) => !c.batches.length || c.batches.includes(batch);
  const needsOf = k => {
    const [programme, semester, batch] = k.split("|");
    const forProgSem = courseRows.filter(c => c.semester === semester && programmesMatch(c.programmes, programme));
    const own = forProgSem.filter(c => !isCohortProgramme(c.programmes));
    if (!own.length) return null;
    const ownForBatch = own.filter(c => inBatch(c, batch));
    const list = [...(ownForBatch.length ? ownForBatch : own), ...forProgSem.filter(c => isCohortProgramme(c.programmes) && inBatch(c, batch))];
    return { cie: list.some(c => NEEDS_CIE.has(c.calc_type) && c.cie_max > 0), ese: list.some(c => NEEDS_ESE.has(c.calc_type) && c.ese_max > 0) };
  };
  const rule1a = [], noFetch = [];
  for (const [k, regds] of [...byBatch].sort(([a], [b]) => a.localeCompare(b))) {
    const missingCie = regds.filter(r => !inCie.has(r)), missingEse = regds.filter(r => !inEse.has(r));
    if (missingCie.length || missingEse.length) {
      rule1a.push({ batchKey: k, smf: regds.length, cie: regds.length - missingCie.length, ese: regds.length - missingEse.length,
        missingCie: missingCie.map(r => ({ regdNo: r, name: name.get(r) })), missingEse: missingEse.map(r => ({ regdNo: r, name: name.get(r) })) });
    }
    const n = needsOf(k);
    if (!n) continue;
    const noCie = n.cie && !regds.some(r => cieWithMark.has(r)), noEse = n.ese && !regds.some(r => eseWithMark.has(r));
    if (noCie || noEse) noFetch.push({ batchKey: k, missing: [noCie && "CIE", noEse && "ESE"].filter(Boolean) });
  }
  return { rule1a, noFetch, names: Object.fromEntries(name) };
}

// The report. `arrival` is the stored arrivalPart of the run; without it (a run computed before it was stored, or "Check
// now") it is worked out from students, marks and courses. Pending counts come from `results` when given, else from the
// batch stats the same Compute stored.
export function buildReport({ exceptions, batches, results = null, students, marks, courses, overrides, detentionRows, arrival = null }) {
  const detentionReason = new Map(detentionRows.map(d => [d.regd_no, { reason: d.reason, by: d.updated_by, at: d.updated_at }]));
  const part = arrival ?? arrivalPart({ students, marks, courses });
  const name = new Map(Object.entries(part.names));
  const batchId = new Map(batches.map(b => [b.key, b.id]));
  const ex = e => ({
    code: e.code, severity: e.severity, batchKey: e.batch_key, batchId: batchId.get(e.batch_key) ?? null, regdNo: e.regd_no,
    name: e.regd_no ? name.get(e.regd_no) ?? null : null, paperCode: e.paper_code, courseCode: e.course_code,
    message: e.message, details: parseJson(e.details, {}), accepted: !!e.accepted
  });
  const pick = (...codes) => exceptions.filter(e => codes.includes(e.code)).map(ex);
  const rule1a = part.rule1a.map(r => ({ ...r, batchId: batchId.get(r.batchKey) ?? null }));
  const noFetch = part.noFetch.map(r => ({ ...r, batchId: batchId.get(r.batchKey) ?? null }));

  // ── Batch outcome: blocked batches cannot release anything; the rest are eligible ──
  let held = null;
  if (results) {
    held = new Map();
    for (const r of results) if (!r.releasable && r.state !== "Withheld") held.set(r.batch_key, (held.get(r.batch_key) || 0) + 1);
  }
  const blocked = [], eligible = [];
  for (const b of batches) {
    const stats = parseJson(b.stats, {});
    const batchBlocks = exceptions.filter(e => e.batch_key === b.key && !e.regd_no && e.severity === "block" && !e.accepted);
    const row = { batchKey: b.key, batchId: b.id, programme: b.programme, semester: b.semester, batch: b.batch, students: stats.students ?? 0,
      ready: stats.ready ?? 0, held: (held ? held.get(b.key) : stats.held) || 0, withheld: stats.withheld ?? 0 };
    // A course not received holds only the students not confirmed complete (see finalizeSession), so a batch where some can
    // go ahead (often a whole campus) is eligible, with the course named; it is blocked only when it holds everyone.
    const wholeBatch = stats.blocked ?? batchBlocks.length > 0;
    if (batchBlocks.length && wholeBatch) blocked.push({ ...row, reasons: [...new Set(batchBlocks.map(e => e.code))] });
    else {
      const notes = [];
      const missingCourses = batchBlocks.filter(e => e.code === "COURSE_NOT_RECEIVED").map(e => e.paper_code).filter(Boolean);
      if (missingCourses.length) notes.push(`No marks yet for ${missingCourses.join(", ")}: only students who take ${missingCourses.length === 1 ? "it" : "them"} wait`);
      if (exceptions.some(e => e.batch_key === b.key && e.code === "COURSE_PARTIAL" && !e.accepted)) notes.push("Partial course arrival");
      const camp = (stats.campuses || []).filter(c => c.campus);
      const readyCamps = camp.filter(c => c.held === 0 && c.ready > 0).map(c => c.campus);
      if (camp.length > 1 && readyCamps.length && readyCamps.length < camp.length) notes.push(`Ready to process for ${readyCamps.join(", ")}; ${camp.filter(c => !readyCamps.includes(c.campus)).map(c => c.campus).join(", ")} still pending`);
      if (row.held) notes.push(`${row.held} student${row.held === 1 ? "" : "s"} pending`);
      if (row.withheld) notes.push(`${row.withheld} withheld`);
      eligible.push({ ...row, status: notes.length ? notes.join(", ") : "All checks passed" });
    }
  }

  return {
    overrides: overrides.map(o => ({ id: o.id, type: o.type, regdNo: o.regd_no, name: o.regd_no ? name.get(o.regd_no) ?? null : null, paperCode: o.paper_code,
      field: o.field, value: o.value, reason: o.reason, by: o.created_by, at: o.created_at })),
    rule0: pick("NO_CMF_FOR_BATCH"),
    rule1a,
    noFetch,
    rule1bHard: pick("COURSE_NOT_RECEIVED"),
    rule1bWarn: pick("COURSE_PARTIAL"),
    rule2Hard: pick("MARK_MISSING", "MARK_INVALID"),
    rule2Warn: pick("MARK_ZERO", "MARK_LOW"),
    rule3aHard: pick("WEIGHTAGE_INVALID"),
    rule3aWarn: pick("WEIGHTAGE_NONSTANDARD"),
    rule3bHard: [],
    rule3bWarn: pick("MARK_ABOVE_MAX", "MARK_UNEXPECTED"),
    blocked,
    eligible,
    detained: pick("BATCH_REROUTED", "BATCH_AMBIGUOUS").map(e => ({ ...e, recordedReason: detentionReason.get(e.regdNo) || null })),
    other: pick("NOT_IN_SMF", "UNKNOWN_PAPER", "CREDIT_MISMATCH", "COURSE_MISMATCH", "LEFT_STUDENT", "PAPER_EXCLUDED")
  };
}
