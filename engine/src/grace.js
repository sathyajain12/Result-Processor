import { STATUS, CALC_TYPE } from "./constants.js";
import { isNum, roundSheets } from "./math.js";
import { seriatimOrder } from "./course.js";

// Grace marks. A student gets a pool of 1% of the total ESE maximum of the semester's papers, spent in seriatim on failed
// Theory papers less than 4 points below a pass mark: the Gracing Policy's "> 36% and < 40%" at a pass mark of 40.
// A paper takes one kind of grace, and only if it then passes:
//   ESE grace   ESE is raised to its pass mark; costs the ESE shortfall.
//   COMB grace  ESE is raised, a whole mark at a time, to the lowest mark at which the paper passes (COMB rounded as the
//               sheets do), CIE untouched; costs the COMB shortfall. Only
//               where the ESE passes or is itself in that range.
// The range and the shortfall use the exact percentages of the marks (35 out of 75 is 46.67%, not the 47% the marks
// sheets show), to two decimals; whether a paper passes still goes by the sheets' rounded percentages. A shortfall is
// in percentage points and costs that share of the paper's ESE maximum, in actual marks: 3.33 points on an ESE out of 75
// cost 2.5 marks. Grace is then given in whole marks, rounded up so the pass mark is still reached: 2.5 becomes 3, and
// ESE grace raises the ESE by that many marks (35 to 38 out of 75, 50.67%). The pool itself keeps its decimals (3.25).

const BELOW = 4;   // "> 36%" at a pass mark of 40
// Whole marks, rounded up; the exact cost is worked out to two decimals first, so 2.00 stays 2.
const wholeMarks = x => Math.ceil(marksOf(x) - 1e-9);
const marksOf = x => roundSheets(x, 2);
const effective = p => (p.overrides ? { ...p.course, ...p.overrides } : p.course);

const hasEse = c => (c?.calcType === CALC_TYPE.CIE_AND_ESE || c?.calcType === CALC_TYPE.ESE_ONLY) && isNum(c.eseMax) && c.eseMax > 0;
const isTheory = c => /^(t|th|theory)$/i.test(String(c?.courseType ?? "").trim());
const typeBlank = c => String(c?.courseType ?? "").trim() === "";

// The lowest percentage a grade-point table does not fail.
function tablePass(tables, code) {
  const row = (tables?.[code] || []).find(r => isNum(r.ll) && r.np !== "Fails");
  return row ? row.ll : null;
}

export function passMarks(course, reference) {
  const ese = tablePass(reference.npTables, course.eseNP);
  const table = tablePass(reference.npTables, course.combNP);
  const category = course.passCategory === 2 ? 50 : course.passCategory === 1 ? 40 : 0;
  return { ese, comb: table === null ? (category || null) : Math.max(table, category) };
}

const inWindow = (value, pass) => isNum(value) && isNum(pass) && value < pass && value > pass - BELOW;

// The exact percentages of a paper's marks, to two decimals: CIE, ESE, and COMB from them with the paper's weights.
function exactPcts(p, c, reference) {
  const of = (marks, max) => (isNum(marks) && isNum(max) && max > 0 ? (marks / max) * 100 : null);
  const cie = of(p.cieRaw, c.cieMax), ese = of(p.eseRaw, c.eseMax);
  const weights = isNum(c.cieWeight) && isNum(c.eseWeight) ? { cie: c.cieWeight, ese: c.eseWeight } : reference.weightage?.[String(c.weightageCategory)] ?? null;
  const comb = c.calcType === CALC_TYPE.ESE_ONLY ? ese
    : c.calcType === CALC_TYPE.CIE_AND_ESE && weights && isNum(ese) ? (cie ?? 0) * weights.cie + ese * weights.ese : null;
  return { ese: isNum(ese) ? marksOf(ese) : null, comb: isNum(comb) ? marksOf(comb) : null };
}

const seriatim = (a, b) => seriatimOrder({ sequence: a.course?.sequence, code: a.paperCode }, { sequence: b.course?.sequence, code: b.paperCode });

// 1% of the ESE maximum of the semester's papers. Works on computed or stored papers. Viva and project papers count
// towards the pool even though they are never graced; internal-only and non-credit papers have no ESE and do not.
export function gracePoolOf(papers) {
  const total = papers.reduce((sum, p) => { const c = effective(p); return hasEse(c) ? sum + c.eseMax : sum; }, 0);
  return marksOf(total / 100);
}

// PG, professional and Pre-Ph.D programmes: E1/E2 evaluation, and the first supplementary is the terminal one.
export function isPostgraduate(programme, passCategory) {
  if (passCategory === 2 || passCategory === 3) return true;
  const p = String(programme ?? "").toUpperCase().replace(/[\s.-]/g, "");
  return /^BED/.test(p) || /PPHD|PREPH/.test(p);
}

// What a supplementary attempt has to spend. The terminal attempt (UG second, PG and professional first) gets the full
// pool afresh; an earlier attempt gets what the regular exam left, and nothing if that was used up.
export function supplementaryGrace({ basePapers, postgraduate, attempt }) {
  const pool = gracePoolOf(basePapers);
  const usedBefore = marksOf(basePapers.reduce((sum, p) => sum + (p.grace?.marks ?? 0), 0));
  const terminal = attempt >= (postgraduate ? 1 : 2);
  return { pool, usedBefore: terminal ? 0 : usedBefore, available: terminal ? pool : Math.max(0, marksOf(pool - usedBefore)), attempt, terminal };
}

function raiseEseForComb(p, course, comb, exact, recompute) {
  if (!isNum(course.eseMax) || course.eseMax <= 0) return null;
  const shortfall = marksOf(comb - exact.comb);
  // The lowest ESE, a whole mark at a time above the one obtained, at which the paper passes: COMB reaches its pass mark
  // as the sheets round it, and the ESE passes too. CIE 52, ESE 42 at 50/50 is COMB 47; ESE 47 gives COMB 49.5, which
  // the sheets round to 50, so the ESE becomes 47 (not the 48 that makes COMB exactly 50).
  for (let k = 1; p.eseRaw + k <= course.eseMax; k++) {
    const gracedMarks = marksOf(p.eseRaw + k);
    const trial = recompute(p, gracedMarks);
    if (trial.status === STATUS.PASS) return { trial, eseToPct: marksOf((gracedMarks / course.eseMax) * 100), gracedMarks, shortfall };
  }
  return null;
}

// Grades graced papers in place. `recompute(paper, eseGraced)` re-runs computePaper for a paper with a graced ESE.
// Returns the pool totals plus the papers graced, the ones the pool could not cover, and borderline papers with no Course Type.
export function applyGrace(papers, { available, reference, recompute }) {
  let left = marksOf(available);
  const graced = [], refused = [], noType = [];

  for (const p of [...papers].sort(seriatim)) {
    const c = effective(p);
    const r = p.result;
    if (!hasEse(c) || r.status !== STATUS.FAIL || !isNum(p.eseRaw)) continue;
    if (c.calcType === CALC_TYPE.CIE_AND_ESE && isNum(c.cieMax) && c.cieMax > 0 && !isNum(p.cieRaw)) continue;

    const pass = passMarks(c, reference);
    const exact = exactPcts(p, c, reference);
    const eseIn = inWindow(exact.ese, pass.ese);
    // COMB grace only where the ESE itself passes or is within the range: an ESE further below its pass mark stays failed,
    // even when raising it would bring COMB up (CIE 40%, ESE 34: COMB 37, but the ESE is 6 short).
    const eseWithin = !isNum(pass.ese) || (isNum(exact.ese) && exact.ese > pass.ese - BELOW);
    const combIn = c.calcType === CALC_TYPE.CIE_AND_ESE && eseWithin && inWindow(exact.comb, pass.comb);
    if (!eseIn && !combIn) continue;
    if (!isTheory(c)) { if (typeBlank(c)) noType.push(p); continue; }

    const options = [];
    if (eseIn) {
      const exactMarks = marksOf((marksOf(pass.ese - exact.ese) * c.eseMax) / 100);
      const marks = wholeMarks(exactMarks);
      const gracedMarks = marksOf(p.eseRaw + marks);
      const trial = recompute(p, gracedMarks);
      if (trial.status === STATUS.PASS) {
        options.push({ kind: "ESE", marks, exactMarks, gracedMarks, trial,
          fromPct: exact.ese, toPct: pass.ese, eseFromPct: exact.ese, eseToPct: marksOf((gracedMarks / c.eseMax) * 100), combFromPct: exact.comb });
      }
    }
    if (combIn) {
      const raised = raiseEseForComb(p, c, pass.comb, exact, recompute);
      if (raised && raised.trial.status === STATUS.PASS) {
        const exactMarks = marksOf((raised.shortfall * c.eseMax) / 100);
        options.push({ kind: "COMB", marks: wholeMarks(exactMarks), exactMarks, gracedMarks: raised.gracedMarks, trial: raised.trial,
          fromPct: exact.comb, toPct: pass.comb, eseFromPct: exact.ese, eseToPct: raised.eseToPct, combFromPct: exact.comb });
      }
    }
    if (!options.length) continue;

    // ESE grace comes first; COMB grace steps in only where ESE grace does not apply or the pool cannot cover it.
    const chosen = options.find(o => o.marks <= left);
    if (!chosen) {
      refused.push({ paper: p, needed: Math.min(...options.map(o => o.marks)), left });
      continue;
    }
    const { trial, ...grace } = chosen;
    p.result = trial;
    p.grace = grace;
    left = marksOf(left - grace.marks);
    graced.push({ paper: p, left });
  }

  return { used: marksOf(available - left), left, graced, refused, noType };
}
