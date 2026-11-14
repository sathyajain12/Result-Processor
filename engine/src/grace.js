import { STATUS, CALC_TYPE } from "./constants.js";
import { isNum, roundSheets } from "./math.js";
import { seriatimOrder } from "./course.js";

// Grace marks. A student gets a pool of 1% of the total ESE maximum of the semester's papers, spent in seriatim on failed
// Theory papers within 3 points of a pass mark. A paper takes one kind of grace, and only if it then passes:
//   ESE grace   ESE is raised to its pass mark; costs the ESE shortfall.
//   COMB grace  ESE is raised just enough for COMB to reach its pass mark, CIE untouched; costs the COMB shortfall. Only
//               where the ESE passes or is itself within 3 of its pass mark.
// Shortfalls are in percentage points and cost that share of the paper's ESE maximum, in actual marks: 2 points on a
// paper out of 50 cost 1 mark.

const WINDOW = 3;
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

const inWindow = (value, pass) => isNum(value) && isNum(pass) && value < pass && value >= pass - WINDOW;

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

function raiseEseForComb(p, course, comb, recompute) {
  const r = p.result;
  const weight = isNum(course.eseWeight) ? course.eseWeight : null;
  if (!weight) return null;
  const shortfall = comb - r.combPct;
  const toMarks = pct => marksOf((pct * course.eseMax) / 100);
  // The ESE the COMB arithmetic calls for (CIE 30, ESE 46: 2 short at 50/50, so ESE 50), raised further only if rounding leaves COMB short.
  for (let pct = roundSheets(r.eseComptPct + shortfall / weight); pct <= 100; pct++) {
    const trial = recompute(p, toMarks(pct));
    if (isNum(trial.combPct) && trial.combPct >= comb) return { trial, eseToPct: pct, gracedMarks: toMarks(pct), shortfall };
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
    const eseIn = inWindow(r.eseComptPct, pass.ese);
    // COMB grace only where the ESE itself passes or is within the range: an ESE further below its pass mark stays failed,
    // even when raising it would bring COMB up (CIE 40%, ESE 34: COMB 37, but the ESE is 6 short).
    const eseWithin = !isNum(pass.ese) || (isNum(r.eseComptPct) && r.eseComptPct >= pass.ese - WINDOW);
    const combIn = c.calcType === CALC_TYPE.CIE_AND_ESE && eseWithin && inWindow(r.combPct, pass.comb);
    if (!eseIn && !combIn) continue;
    if (!isTheory(c)) { if (typeBlank(c)) noType.push(p); continue; }

    const options = [];
    if (eseIn) {
      const gracedMarks = marksOf((pass.ese * c.eseMax) / 100);
      const trial = recompute(p, gracedMarks);
      if (trial.status === STATUS.PASS) {
        options.push({ kind: "ESE", marks: marksOf(((pass.ese - r.eseComptPct) * c.eseMax) / 100), gracedMarks, trial,
          fromPct: r.eseComptPct, toPct: pass.ese, eseFromPct: r.eseComptPct, eseToPct: pass.ese });
      }
    }
    if (combIn) {
      const raised = raiseEseForComb(p, c, pass.comb, recompute);
      if (raised && raised.trial.status === STATUS.PASS) {
        options.push({ kind: "COMB", marks: marksOf((raised.shortfall * c.eseMax) / 100), gracedMarks: raised.gracedMarks, trial: raised.trial,
          fromPct: r.combPct, toPct: pass.comb, eseFromPct: r.eseComptPct, eseToPct: raised.eseToPct });
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
