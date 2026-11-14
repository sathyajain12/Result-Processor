import { POLICY, STATUS, CALC_TYPE } from "./constants.js";
import { isNum, isBlank } from "./math.js";
import { buildCourseIndex, resolveCourse, programmesMatch, isCohortProgramme } from "./course.js";
import { computePaper } from "./paper.js";
import { computeStudent, STUDENT_STATE } from "./student.js";
import { applyGrace, gracePoolOf, isPostgraduate } from "./grace.js";

export const SEVERITY = Object.freeze({ BLOCK: "block", WARN: "warn", INFO: "info" });

export const EXCEPTION = Object.freeze({
  LEFT_STUDENT: "LEFT_STUDENT",
  NOT_IN_SMF: "NOT_IN_SMF",
  NO_MARKS: "NO_MARKS",
  NO_CMF_FOR_BATCH: "NO_CMF_FOR_BATCH",
  COURSE_NOT_RECEIVED: "COURSE_NOT_RECEIVED",
  COURSE_PARTIAL: "COURSE_PARTIAL",
  BATCH_REROUTED: "BATCH_REROUTED",
  BATCH_AMBIGUOUS: "BATCH_AMBIGUOUS",
  UNKNOWN_PAPER: "UNKNOWN_PAPER",
  MARK_MISSING: "MARK_MISSING",
  MARK_INVALID: "MARK_INVALID",
  MARK_ZERO: "MARK_ZERO",
  MARK_LOW: "MARK_LOW",
  COURSE_MISMATCH: "COURSE_MISMATCH",
  WEIGHTAGE_INVALID: "WEIGHTAGE_INVALID",
  WEIGHTAGE_NONSTANDARD: "WEIGHTAGE_NONSTANDARD",
  CREDIT_MISMATCH: "CREDIT_MISMATCH",
  PAPER_EXCLUDED: "PAPER_EXCLUDED",
  MARK_ABOVE_MAX: "MARK_ABOVE_MAX",
  MARK_UNEXPECTED: "MARK_UNEXPECTED",
  SUPP_NO_BASE_RESULT: "SUPP_NO_BASE_RESULT",
  SUPP_NOTHING_REAPPEARED: "SUPP_NOTHING_REAPPEARED",
  SUPP_PAPER_NOT_IN_BASE: "SUPP_PAPER_NOT_IN_BASE",
  SUPP_REAPPEAR_PASSED: "SUPP_REAPPEAR_PASSED",
  SUPP_CREDITS_CHANGED: "SUPP_CREDITS_CHANGED",
  SUPP_BATCH_DIFFERS: "SUPP_BATCH_DIFFERS",
  GRACE_APPLIED: "GRACE_APPLIED",
  GRACE_NOT_AVAILABLE: "GRACE_NOT_AVAILABLE",
  GRACE_NO_COURSE_TYPE: "GRACE_NO_COURSE_TYPE"
});

export const DEFAULT_THRESHOLDS = Object.freeze({ lowMarkRatio: 0.2 });

const SPECIAL = new Set(["DSE", "ELECTIVE", "IDM", "SEC", "AEC", "MDC", "VBC", "VOC", "SSC"]);
const parts = s => String(s || "").split("/").map(p => p.trim()).filter(Boolean);

export const batchKey = (programme, semester, batch) => `${programme}|${semester}|${batch ?? ""}`;
export const normalizePaperCode = code => String(code ?? "").trim().replace(/_IHA$/i, "");
export const isPhdPaper = code => String(code).toUpperCase().includes("PPHD");
export const isNptel = code => /^[a-z]{2,4}\d{2}_/i.test(code) || /\([a-z]{2,4}\d{2}_/i.test(code);

export function courseGroup(code) {
  return String(code)
    .split("(")[0]
    .replace(/(?:-(?:Arts|Science))?-Sem-[IVX]+-.*$/, "")
    .replace(/-[A-Z][A-Z.]*(?:\/[A-Z][A-Z.-]*)+$/i, "")
    .trim();
}

export function normalizeMark(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const s = String(raw).trim();
  if (s === "") return null;
  const u = s.toUpperCase();
  if (u === "A" || u === "AB") return "A";
  if (u === "L") return "L";
  const n = Number(s);
  return Number.isFinite(n) ? n : s;
}

const hasMarks = c => (isNum(c.cieMax) && c.cieMax > 0) || (isNum(c.eseMax) && c.eseMax > 0);

const courseBatches = c => (Array.isArray(c.batches) ? c.batches : isBlank(c.batch) ? [] : [String(c.batch)]);
const batchMatches = (c, batch) => { const b = courseBatches(c); return !b.length || b.includes(String(batch ?? "")); };

function resolveBatch(student, courses) {
  const forProgSem = courses.filter(c => c.semester === student.semester && !isCohortProgramme(c.programmes) && programmesMatch(c.programmes, student.programme));
  if (!forProgSem.length) return { batch: student.batch, status: "none" };
  if (forProgSem.some(c => batchMatches(c, student.batch))) return { batch: student.batch, status: "exact" };
  const batches = [...new Set(forProgSem.flatMap(courseBatches))];
  if (batches.length === 1) return { batch: batches[0], status: "rerouted" };
  return { batch: student.batch, status: "ambiguous", batches };
}

// An elective (DSE, IDM, SEC…) is expected only from students who chose it. The SMF names it by its own code, such as
// "UBBA-703(imb26_mg236)", while the CMF may list it as "UBBA-703(imb26_mg236)-Arts-Sem-VII-IDM" when the code repeats.
const chose = (student, c) => Array.isArray(student.electives) && (student.electives.includes(c.code) || (!!c.baseCode && student.electives.includes(c.baseCode)));
const isElective = c => SPECIAL.has(String(c.category || "").toUpperCase());

function expectedGroups(student, batch, courses) {
  const groups = new Map();
  for (const c of courses) {
    if (c.semester !== student.semester || !hasMarks(c)) continue;
    if (!batchMatches(c, batch)) continue;
    if (!programmesMatch(c.programmes, student.programme)) continue;
    if (isElective(c) && !chose(student, c)) continue;
    const g = courseGroup(c.code);
    if (!groups.has(g)) groups.set(g, { group: g, options: [], cohort: false });
    const entry = groups.get(g);
    entry.options.push(c);
    if (isCohortProgramme(c.programmes)) entry.cohort = true;
  }
  return groups;
}

// Courses with no CIE or ESE at all (non-credit): they never have marks, but the student's Grade register still lists them.
export function nonCreditCourses(student, batch, courses) {
  return courses.filter(c => c.semester === student.semester && !hasMarks(c) && batchMatches(c, batch)
    && !/SWAYAM NC/i.test(c.teachingDept || "") && programmesMatch(c.programmes, student.programme)
    && (!isElective(c) || chose(student, c)));
}

// Why a student was treated as detained (or could not be placed): their SMF batch has no courses in the CMF for their
// programme and semester, so the course list of another batch has to be used.
function batchExplanation(student, toBatches) {
  const from = String(student.batch ?? "").trim();
  const where = `${student.programme} Sem ${student.semester}`;
  const head = from ? `The CMF has no ${where} courses for batch ${from} (the student's batch in the SMF)` : `The student has no batch in the SMF`;
  if (toBatches.length !== 1) return `${head}; it lists ${where} courses for batches ${toBatches.join(", ")}, so the batch the student is studying with has to be chosen`;
  const to = toBatches[0];
  const gap = Number(to) - Number(from);
  const why = !from || !Number.isFinite(gap) ? "" : gap > 0
    ? `, ${gap} year${gap === 1 ? "" : "s"} after the student's batch: repeating the semester (detained) or returning after a break`
    : gap < 0 ? `, earlier than the student's batch: check the batch in the SMF` : "";
  return `${head}; the only ${where} batch in the CMF is ${to}${why}. Treated as detained: that batch's course list is used`;
}

function checkWeightages(courses, reference, raise) {
  const blocked = new Set();
  for (const c of courses) {
    if (c.calcType !== CALC_TYPE.CIE_AND_ESE) continue;
    const explicit = isNum(c.cieWeight) && isNum(c.eseWeight);
    if (!explicit && !reference.weightage?.[String(c.weightageCategory)]) {
      blocked.add(c.code);
      raise(EXCEPTION.WEIGHTAGE_INVALID, SEVERITY.BLOCK, { courseCode: c.code }, `${c.code} has no CIE/ESE weightage`);
    } else if (explicit && Math.round((c.cieWeight + c.eseWeight) * 100) !== 100) {
      blocked.add(c.code);
      raise(EXCEPTION.WEIGHTAGE_INVALID, SEVERITY.BLOCK, { courseCode: c.code },
        `${c.code} weightage ${Math.round(c.cieWeight * 100)}/${Math.round(c.eseWeight * 100)} does not total 100`);
    } else if (explicit) {
      // Expected splits: 50/50, B.Ed 30/70, and SWAYAM/NPTEL courses (codes like noc26_cs144, ugc26_ge10, ini26_ag04) 25/75 or 30/70.
      const bed = parts(c.programmes).some(p => /^BED/i.test(p.replace(/[\s.-]/g, "")));
      const swayam = /[a-z]{2,4}\d{2}_[a-z]{2,3}\d{1,4}/i.test(c.code);
      const allowed = bed ? [[0.3, 0.7]] : swayam ? [[0.25, 0.75], [0.3, 0.7]] : [[0.5, 0.5]];
      if (!allowed.some(([ec, ee]) => Math.abs(c.cieWeight - ec) < 1e-9 && Math.abs(c.eseWeight - ee) < 1e-9)) {
        raise(EXCEPTION.WEIGHTAGE_NONSTANDARD, SEVERITY.WARN, { courseCode: c.code },
          `${c.code} uses ${Math.round(c.cieWeight * 100)}/${Math.round(c.eseWeight * 100)}; expected ${allowed.map(([a, b]) => `${a * 100}/${b * 100}`).join(" or ")}`);
      }
    }
  }
  return blocked;
}

export function processSession({
  reference, students, cie = [], ese = [], overrides = [],
  policy = POLICY.DEFAULT, thresholds = DEFAULT_THRESHOLDS, batchFilter = null, gracePool = null
}) {
  const exceptions = [];
  const raise = (code, severity, scope, message, details = {}) =>
    exceptions.push({ code, severity, batchKey: null, regdNo: null, paperCode: null, courseCode: null, ...scope, message, details });

  const courses = reference.courses.filter(c => !/SWAYAM NC/i.test(c.teachingDept || ""));
  const index = buildCourseIndex(courses);

  const byType = t => overrides.filter(o => o.type === t);
  const excludedPapers = new Map(byType("exclude-paper").map(o => [o.paperCode, o]));
  const skipValidation = new Map(byType("skip-validation").map(o => [o.paperCode, o]));
  const excludedStudents = new Map(byType("exclude-student").map(o => [o.regdNo, o]));
  const batchOverrides = new Map(byType("student-batch").map(o => [o.regdNo, String(o.value)]));
  const fieldOverrides = new Map();
  for (const o of byType("course-field")) {
    const k = `${o.regdNo}|${o.paperCode}`;
    fieldOverrides.set(k, { ...(fieldOverrides.get(k) || {}), [o.field]: o.value });
  }

  const marks = new Map();
  const left = new Map();
  const notInSmf = new Map();

  const ingest = (rows, component) => {
    for (const r of rows) {
      const regdNo = String(r.regdNo ?? "").trim();
      const paperCode = normalizePaperCode(r.paperCode);
      if (!regdNo || !paperCode) continue;
      const value = normalizeMark(r.raw);
      if (value === "L") {
        if (!left.has(regdNo)) left.set(regdNo, new Set());
        left.get(regdNo).add(paperCode);
        continue;
      }
      if (!students[regdNo]) {
        if (!notInSmf.has(regdNo)) notInSmf.set(regdNo, []);
        notInSmf.get(regdNo).push({ paperCode, component, value });
        continue;
      }
      if (!marks.has(regdNo)) marks.set(regdNo, new Map());
      const sm = marks.get(regdNo);
      if (!sm.has(paperCode)) sm.set(paperCode, { paperCode, cie: null, ese: null, hasCie: false, hasEse: false });
      const m = sm.get(paperCode);
      if (component === "CIE") { m.cie = value; m.hasCie = true; } else { m.ese = value; m.hasEse = true; }
    }
  };
  ingest(cie, "CIE");
  ingest(ese, "ESE");

  for (const [regdNo, papers] of left) {
    raise(EXCEPTION.LEFT_STUDENT, SEVERITY.INFO, { regdNo }, `Marked "L" (left) in ${[...papers].join(", ")} — excluded from results`, { papers: [...papers] });
  }
  for (const [regdNo, rows] of notInSmf) {
    raise(EXCEPTION.NOT_IN_SMF, SEVERITY.BLOCK, { regdNo }, `Marks received for ${rows.length} paper(s) but student is not in SMF`, { rows });
  }
  for (const [paperCode, o] of excludedPapers) {
    raise(EXCEPTION.PAPER_EXCLUDED, SEVERITY.INFO, { paperCode }, `Excluded for all students: ${o.reason || "no reason given"}`);
  }
  for (const [paperCode, o] of skipValidation) {
    raise(EXCEPTION.PAPER_EXCLUDED, SEVERITY.INFO, { paperCode }, `Validation skipped for all students: ${o.reason || "no reason given"}`);
  }

  const blockedCourses = checkWeightages(courses, reference, raise);

  const plans = [];
  for (const [regdNo, student] of Object.entries(students)) {
    if (left.has(regdNo) || excludedStudents.has(regdNo)) continue;
    const key = batchKey(student.programme, student.semester, student.batch);
    if (batchFilter && !batchFilter.includes(key)) continue;

    let effectiveBatch = student.batch;
    let batchStatus = "exact";
    if (batchOverrides.has(regdNo)) effectiveBatch = batchOverrides.get(regdNo);
    else {
      const rb = resolveBatch(student, courses);
      batchStatus = rb.status;
      if (rb.status === "rerouted") {
        effectiveBatch = rb.batch;
        raise(EXCEPTION.BATCH_REROUTED, SEVERITY.INFO, { batchKey: key, regdNo }, batchExplanation(student, [rb.batch]),
          { fromBatch: student.batch ?? "", toBatch: rb.batch, yearsLater: Number(rb.batch) - Number(student.batch) || null });
      } else if (rb.status === "ambiguous") {
        raise(EXCEPTION.BATCH_AMBIGUOUS, SEVERITY.BLOCK, { batchKey: key, regdNo }, batchExplanation(student, rb.batches),
          { fromBatch: student.batch ?? "", batches: rb.batches });
      }
    }

    const arrived = [];
    const covered = new Set();
    for (const m of marks.get(regdNo)?.values() || []) {
      covered.add(courseGroup(m.paperCode));
      if (excludedPapers.has(m.paperCode)) continue;
      const r = resolveCourse(index, m.paperCode, student);
      if (r.course) covered.add(courseGroup(r.course.code));
      arrived.push({ ...m, course: r.course, method: r.method });
    }

    plans.push({
      regdNo, student, key, effectiveBatch, batchStatus, arrived, covered,
      expected: policy.expectFromCmf === false ? new Map() : expectedGroups(student, effectiveBatch, courses)
    });
  }

  const batchStats = new Map();
  for (const p of plans) {
    if (!batchStats.has(p.key)) batchStats.set(p.key, { size: 0, noCmf: 0, groups: new Map() });
    const bs = batchStats.get(p.key);
    bs.size++;
    if (p.batchStatus === "none") bs.noCmf++;
    for (const [g, e] of p.expected) {
      if (!bs.groups.has(g)) bs.groups.set(g, { expectedFor: 0, arrivedFor: 0, cohort: e.cohort, options: e.options.map(o => o.code), missing: [] });
      const gs = bs.groups.get(g);
      gs.expectedFor++;
      if (p.covered.has(g)) gs.arrivedFor++; else gs.missing.push(p.regdNo);
    }
  }

  const blockedBatches = new Set();
  for (const [key, bs] of batchStats) {
    const [programme, semester] = key.split("|");
    if (bs.noCmf === bs.size) {
      blockedBatches.add(key);
      raise(EXCEPTION.NO_CMF_FOR_BATCH, SEVERITY.BLOCK, { batchKey: key }, `CMF has no courses for ${programme} Sem ${semester}`);
    }
    // Rule 1B: a course nobody in the batch has marks for holds the students not confirmed complete by their Sem-Credits
    // (finalizeSession), so a campus that does not take it can go ahead;
    // a partly arrived course is only a warning and no student is held for it.
    for (const [g, gs] of bs.groups) {
      if (gs.arrivedFor === gs.expectedFor || excludedPapers.has(g) || gs.cohort) continue;
      const details = { options: gs.options, arrived: gs.arrivedFor, expected: gs.expectedFor, missing: gs.missing };
      if (gs.arrivedFor === 0) {
        raise(EXCEPTION.COURSE_NOT_RECEIVED, SEVERITY.BLOCK, { batchKey: key, paperCode: g },
          `${g} is in the CMF for this batch but no marks have arrived for any student`, details);
      } else {
        raise(EXCEPTION.COURSE_PARTIAL, SEVERITY.WARN, { batchKey: key, paperCode: g },
          `${g} has marks for ${gs.arrivedFor} of ${gs.expectedFor} students`, details);
      }
    }
  }

  const results = [];
  for (const p of plans) {
    const { regdNo, student, key } = p;
    const papers = [...p.arrived];

    const noMarksAtAll = p.arrived.length === 0 && (marks.get(regdNo)?.size ?? 0) === 0;
    if (noMarksAtAll && p.expected.size) {
      raise(EXCEPTION.NO_MARKS, SEVERITY.BLOCK, { batchKey: key, regdNo }, `No CIE or ESE marks received for this student (${p.expected.size} papers expected)`);
    }

    const computed = [];
    for (const m of papers) {
      const scope = { batchKey: key, regdNo, paperCode: m.paperCode, courseCode: m.course?.code ?? null };
      const { course, method } = m;

      const skipping = skipValidation.has(m.paperCode);
      if (!course && !skipping) {
        raise(EXCEPTION.UNKNOWN_PAPER, SEVERITY.BLOCK, scope, `${m.paperCode} is not in the course master`);
      } else if (course && !skipping && !["programme-semester", "exact", "expected"].includes(method)) {
        const backlog = method === "programme-only";
        raise(EXCEPTION.COURSE_MISMATCH, SEVERITY.WARN, scope,
          backlog ? `${m.paperCode} graded with the Sem ${course.semester} course ${course.code} (student is in Sem ${student.semester})`
                  : `${m.paperCode} matched ${course.code}, which is not listed for ${student.programme}`, { method });
      }

      const skip = skipValidation.has(m.paperCode);
      const fo = fieldOverrides.get(`${regdNo}|${m.paperCode}`) || null;
      const result = computePaper({ cie: m.cie, ese: m.ese }, course, reference, skip ? { ...policy, invalidMark: "compute" } : policy, fo);

      if (course && blockedCourses.has(course.code)) {
        result.status = STATUS.ERROR;
        result.reasons.push("Course weightage is invalid");
      } else if (result.status === STATUS.PENDING && !noMarksAtAll) {
        raise(EXCEPTION.MARK_MISSING, SEVERITY.BLOCK, scope, `${m.paperCode}: ${result.reasons.join("; ")}${m.expectedOnly ? " — no marks at all for this paper" : ""}`);
      } else if (result.status === STATUS.ERROR && course) {
        raise(EXCEPTION.MARK_INVALID, SEVERITY.BLOCK, scope, `${m.paperCode}: ${result.reasons.join("; ")}`);
      }

      if (course && !skip && !isNptel(m.paperCode) && !isPhdPaper(m.paperCode)) {
        // The student's own maximum when there is one (an SLD paper, or an edit on the student page), else the CMF's.
        const own = (f, cmf) => (fo && isNum(fo[f]) ? fo[f] : cmf);
        for (const [comp, v, max, cmf] of [["CIE", m.cie, own("cieMax", course.cieMax), course.cieMax], ["ESE", m.ese, own("eseMax", course.eseMax), course.eseMax]]) {
          if (!isNum(v) || !isNum(max)) continue;
          if (max === 0 && v > 0) { raise(EXCEPTION.MARK_UNEXPECTED, SEVERITY.WARN, scope, `${comp} mark ${v} in ${m.paperCode}, but the CMF has no ${comp} for this course`); continue; }
          if (max <= 0) continue;
          if (v > max) { raise(EXCEPTION.MARK_ABOVE_MAX, SEVERITY.WARN, scope, `${comp} mark ${v} in ${m.paperCode} is above the ${max === cmf ? "CMF" : "student's"} maximum ${max}`); continue; }
          if (v === 0) raise(EXCEPTION.MARK_ZERO, SEVERITY.WARN, scope, `${comp} mark is 0 in ${m.paperCode}`);
          else if (v / max < thresholds.lowMarkRatio) raise(EXCEPTION.MARK_LOW, SEVERITY.WARN, scope, `${comp} mark ${v}/${max} in ${m.paperCode} is below ${thresholds.lowMarkRatio * 100}%`);
        }
      }

      computed.push({
        paperCode: m.paperCode, courseCode: course?.code ?? null, courseTitle: course?.title ?? null, course: course ?? null,
        resolution: method, expectedOnly: !!m.expectedOnly,
        cieRaw: m.cie, eseRaw: m.ese, overrides: fo, result
      });
    }

    // Grace comes before the student's result, so GPA and status use the graced papers. A supplementary says what is left to spend.
    const budget = gracePool ? gracePool(regdNo, computed) : null;
    const pool = gracePool ? budget?.pool ?? 0 : gracePoolOf(computed);
    const available = gracePool ? budget?.available ?? 0 : pool;
    const grace = applyGrace(computed, {
      available, reference,
      recompute: (paper, eseGraced) => computePaper({ cie: paper.cieRaw, ese: paper.eseRaw, eseGraced }, paper.course, reference,
        skipValidation.has(paper.paperCode) ? { ...policy, invalidMark: "compute" } : policy, paper.overrides)
    });
    const paperScope = paper => ({ batchKey: key, regdNo, paperCode: paper.paperCode, courseCode: paper.courseCode });
    const addTo = isPostgraduate(student.programme, reference.programmes?.[student.programme]?.passCategory) ? " Add the grace to E1, or to TEB if there was a third evaluation." : "";
    for (const { paper, left } of grace.graced) {
      const g = paper.grace;
      const how = g.kind === "COMB" ? `COMB ${g.fromPct}% to ${g.toPct}%, with ESE ${g.eseFromPct}% to ${g.eseToPct}%` : `ESE ${g.fromPct}% to ${g.toPct}%`;
      raise(EXCEPTION.GRACE_APPLIED, SEVERITY.INFO, paperScope(paper), `Graced +${g.marks} on ${paper.paperCode}: ${how}. Pool ${available}, ${left} left.${addTo}`, { ...g, pool, available, left });
    }
    for (const { paper, needed, left } of grace.refused) {
      raise(EXCEPTION.GRACE_NOT_AVAILABLE, SEVERITY.INFO, paperScope(paper), `${paper.paperCode} needs ${needed} grace mark${needed === 1 ? "" : "s"}, but ${left ? `only ${left} of the pool of ${available} is` : `none of the pool of ${pool} is`} left, so it fails`, { needed, left, pool, available });
    }
    for (const paper of grace.noType) {
      raise(EXCEPTION.GRACE_NO_COURSE_TYPE, SEVERITY.WARN, paperScope(paper), `${paper.paperCode} is close enough to pass for gracing, but the CMF gives no Course Type, so it was not graced. Grace applies only to Theory papers`);
    }

    let s = computeStudent(student, computed, reference, { semCredits: student.semCredits ?? null });
    if (s.state === STUDENT_STATE.WITHHELD) {
      // Credits short because papers the student takes (from the CMF, electives from the SMF) have no marks yet: that is
      // a wait for marks, not a credit mismatch. The student is held with a missing-marks issue per paper instead.
      const waiting = [...p.expected.values()].filter(e => !p.covered.has(e.group) && !excludedPapers.has(e.group));
      const creditsOf = e => { const cs = [...new Set(e.options.map(o => o.credits))]; return cs.length === 1 && isNum(cs[0]) ? cs[0] : null; };
      const credits = waiting.map(creditsOf);
      const short = credits.every(isNum) ? credits.reduce((n, c) => n + c, 0) : null;
      const nameOf = e => (e.options.length === 1 ? e.options[0].baseCode || e.options[0].code : e.group);
      if (waiting.length && short !== null && s.sumCredits + short === student.semCredits) {
        s = computeStudent(student, computed, reference, { semCredits: null });
        waiting.forEach((e, i) => {
          const options = e.options.length > 1 ? `, any of ${e.options.map(o => o.baseCode || o.code).join(", ")}` : "";
          raise(EXCEPTION.MARK_MISSING, SEVERITY.BLOCK, { batchKey: key, regdNo, paperCode: nameOf(e), courseCode: e.options.length === 1 ? e.options[0].code : null },
            `${nameOf(e)}: no marks received yet (${credits[i]} credits${options}); the result waits for them`, { waitingForMarks: true, credits: credits[i] });
        });
        s = { ...s, state: STUDENT_STATE.HELD, reasons: [`Marks not received yet for ${waiting.map(nameOf).join(", ")} (${short} credits)`, ...s.reasons] };
      } else {
        const note = waiting.length ? ` (no marks yet for ${waiting.map(nameOf).join(", ")})` : "";
        raise(EXCEPTION.CREDIT_MISMATCH, SEVERITY.BLOCK, { batchKey: key, regdNo }, `${s.reasons[0]}${note}`, { sumCredits: s.sumCredits, semCredits: student.semCredits, waiting: waiting.map(nameOf) });
      }
    }
    // Credits confirmed against the SMF Sem-Credits: lets the student go ahead past a course not received (finalizeSession).
    const creditsComplete = isNum(student.semCredits) && student.semCredits > 0 && s.sumCredits === student.semCredits;
    results.push({ ...s, creditsComplete, batchKey: key, effectiveBatch: p.effectiveBatch, papers: computed,
      grace: { pool, available, used: grace.used, left: grace.left, refused: grace.refused.length, ...(budget ? { usedBefore: budget.usedBefore, attempt: budget.attempt, terminal: budget.terminal } : {}) } });
  }

  return finalizeSession(results, exceptions, overrides);
}

// Marks accepted exceptions, works out which results are releasable and builds the per-batch stats.
// Shared by processSession and mergeSupplementary, which rebuilds results after merging.
export function finalizeSession(results, exceptions, overrides = []) {
  const accepted = new Set(overrides.filter(o => o.type === "accept").map(o => `${o.code}|${o.batchKey ?? ""}|${o.regdNo ?? ""}|${o.paperCode ?? ""}`));
  for (const e of exceptions) {
    e.accepted = accepted.has(`${e.code}|${e.batchKey ?? ""}|${e.regdNo ?? ""}|${e.paperCode ?? ""}`);
  }

  // A batch-level block holds the whole batch, except Rule 1B's "course not received" (no marks anywhere in the batch for a
  // CMF course): that holds only the students not confirmed complete. A student whose credits add up to the SMF Sem-Credits
  // without the course does not take it (often another campus teaches it), so they go ahead; a student who needs it is short
  // of credits and already pending for it, and one with no Sem-Credits to check against stays held.
  const blockingByStudent = new Map();
  const blockingByBatch = new Map();
  const courseHolds = new Map();
  for (const e of exceptions) {
    if (e.severity !== SEVERITY.BLOCK || e.accepted) continue;
    if (e.regdNo) blockingByStudent.set(e.regdNo, (blockingByStudent.get(e.regdNo) || 0) + 1);
    else if (e.batchKey && e.code === EXCEPTION.COURSE_NOT_RECEIVED) courseHolds.set(e.batchKey, (courseHolds.get(e.batchKey) || 0) + 1);
    else if (e.batchKey) blockingByBatch.set(e.batchKey, (blockingByBatch.get(e.batchKey) || 0) + 1);
  }

  for (const r of results) {
    r.blocking = blockingByStudent.get(r.regdNo) || 0;
    r.batchBlocked = (blockingByBatch.get(r.batchKey) || 0) > 0 || ((courseHolds.get(r.batchKey) || 0) > 0 && !r.creditsComplete);
    r.releasable = r.state === STUDENT_STATE.RESULT && r.blocking === 0 && !r.batchBlocked;
  }

  const batches = [];
  for (const key of new Set(results.map(r => r.batchKey))) {
    const [programme, semester, batch] = key.split("|");
    const rs = results.filter(r => r.batchKey === key);
    const paperCount = rs.reduce((n, r) => n + r.papers.length, 0);
    const pending = rs.reduce((n, r) => n + r.papers.filter(p => p.result.status === STATUS.PENDING).length, 0);
    const released = rs.filter(r => r.releasable);
    batches.push({
      key, programme, semester, batch,
      students: rs.length,
      ready: released.length,
      held: rs.filter(r => !r.releasable && r.state !== STUDENT_STATE.WITHHELD).length,
      withheld: rs.filter(r => r.state === STUDENT_STATE.WITHHELD).length,
      passed: released.filter(r => typeof r.publishedGPA === "number").length,
      failed: released.filter(r => r.publishedGPA === "Fail").length,
      absent: released.filter(r => r.publishedGPA === "Absent").length,
      arrival: paperCount ? 1 - pending / paperCount : 0,
      // Blocked as a whole: a batch-level block, or a course not received that holds every student of the batch.
      blocked: (blockingByBatch.get(key) || 0) > 0 || ((courseHolds.get(key) || 0) > 0 && rs.every(r => !r.creditsComplete)),
      blocking: exceptions.filter(e => e.batchKey === key && e.severity === SEVERITY.BLOCK && !e.accepted).length,
      warnings: exceptions.filter(e => e.batchKey === key && e.severity === SEVERITY.WARN && !e.accepted).length,
      meanGpa: released.length ? released.reduce((n, r) => n + (typeof r.publishedGPA === "number" ? r.publishedGPA : 0), 0) / Math.max(1, released.filter(r => typeof r.publishedGPA === "number").length) : null,
      campuses: campusStats(rs)
    });
  }
  batches.sort((a, b) => a.key.localeCompare(b.key));

  return { batches, results, exceptions };
}

// A batch per campus (SMF Campus), so one campus whose marks are all in shows as ready while another is still waiting.
// ready: releasable; held: pending; arrival: the share of the campus's papers whose marks are in.
function campusStats(rs) {
  const by = new Map();
  for (const r of rs) {
    const name = String(r.campus ?? "").trim();
    if (!by.has(name)) by.set(name, { campus: name, students: 0, ready: 0, held: 0, withheld: 0, papers: 0, pendingPapers: 0 });
    const c = by.get(name);
    c.students++;
    if (r.releasable) c.ready++;
    else if (r.state === STUDENT_STATE.WITHHELD) c.withheld++;
    else c.held++;
    c.papers += r.papers.length;
    c.pendingPapers += r.papers.filter(p => p.result.status === STATUS.PENDING).length;
  }
  return [...by.values()].sort((a, b) => a.campus.localeCompare(b.campus))
    .map(({ papers, pendingPapers, ...c }) => ({ ...c, arrival: papers ? 1 - pendingPapers / papers : 0 }));
}
