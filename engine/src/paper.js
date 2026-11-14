import { NP_NONE, FAIL_4, FAIL_5, NP_ERROR, STATUS, CALC_TYPE, POLICY, isFailToken } from "./constants.js";
import { isNum, isBlank, roundSheets } from "./math.js";
import { lookupNP } from "./tables.js";

const ERR = Symbol("error");

const toNumber = v => (isNum(v) ? v : isBlank(v) ? 0 : ERR);
const pct = (marks, max) => (isNum(max) && max !== 0 ? roundSheets(((marks ?? 0) / max) * 100) : null);

export function computePaper(marks, course, reference, policy = POLICY.DEFAULT, overrides = null) {
  const c = overrides ? { ...course, ...overrides } : course;
  const { cie, ese, eseGraced = null } = marks;
  const trace = [];
  const step = (key, label, value, note) => trace.push({ key, label, value, note });

  const N = c?.calcType ?? null;
  const M = c?.passCategory ?? null;
  const L = c?.weightageCategory ?? null;
  const cieMax = c?.cieMax ?? null;
  const eseMax = c?.eseMax ?? null;
  const weights = isNum(c?.cieWeight) && isNum(c?.eseWeight)
    ? { cie: c.cieWeight, ese: c.eseWeight }
    : reference.weightage?.[String(L)] ?? null;

  const cieRound = isNum(cie) ? roundSheets(cie) : null;
  const ciePct = pct(cieRound, cieMax);
  if (isNum(cieMax) && cieMax !== 0) {
    step("cie", "CIE", ciePct, cie === "A" ? "Absent" : cieRound !== null ? `${cieRound} / ${cieMax}` : "No CIE mark");
  }

  let cieNP = NP_NONE;
  if (cie !== "A" && ciePct !== null) {
    const r = lookupNP(ciePct, reference.npTables, c?.cieNP);
    if (r.ok) { cieNP = r.value; step("cieNP", "CIE-NP", cieNP, `Table ${r.table}, band from ${r.band.ll}%`); }
  }

  const eseRound = isNum(ese) ? roundSheets(ese) : null;
  const esePct = pct(eseRound, eseMax);
  const eseGracedPct = isBlank(eseGraced) ? (isNum(eseMax) && eseMax !== 0 ? 0 : null) : pct(eseGraced, eseMax);
  const eseFinalPct = isBlank(eseGraced) ? esePct : roundSheets(eseGracedPct);
  const eseUsable = isNum(eseMax) && eseMax !== 0 && ese !== "A" && !isBlank(ese);
  const eseComptPct = eseUsable ? eseFinalPct : null;
  if (isNum(eseMax) && eseMax !== 0) {
    step("ese", "ESE", eseComptPct, ese === "A" ? "Absent"
      : eseRound !== null ? `${eseRound} / ${eseMax}${isBlank(eseGraced) ? "" : `, graced to ${eseGraced}`}` : "No ESE mark");
  }

  let eseNP = NP_NONE;
  if (eseUsable && N !== CALC_TYPE.CIE_FROM_COMPONENTS && N !== CALC_TYPE.CIE_ONLY) {
    const r = lookupNP(eseComptPct, reference.npTables, c?.eseNP);
    if (r.ok) { eseNP = r.value; step("eseNP", "ESE-NP", eseNP, `Table ${r.table}, band from ${r.band.ll}%`); }
  }

  let combPct;
  if (N === CALC_TYPE.CIE_AND_ESE) {
    combPct = weights ? roundSheets((ciePct ?? 0) * weights.cie + (eseComptPct ?? 0) * weights.ese) : null;
  } else if (N === CALC_TYPE.CIE_FROM_COMPONENTS || N === CALC_TYPE.CIE_ONLY) combPct = roundSheets(ciePct ?? 0);
  else if (N === CALC_TYPE.ESE_ONLY) combPct = roundSheets(eseComptPct ?? 0);
  else combPct = 0;

  if (isNum(N) && combPct !== null) {
    const how = N === CALC_TYPE.CIE_AND_ESE ? `${ciePct ?? 0}×${weights.cie} + ${eseComptPct ?? 0}×${weights.ese}`
      : N === CALC_TYPE.ESE_ONLY ? "ESE only" : "CIE only";
    step("comb", "COMB", combPct, how);
  }

  const n = toNumber(N);
  const m = toNumber(M);
  const belowPass = () => {
    if (m === 2 && isNum(combPct) && combPct < 50) return FAIL_5;
    if (m === 1 && isNum(combPct) && combPct < 40) return FAIL_4;
    return null;
  };

  let combNP;
  if (n === ERR || m === ERR) combNP = NP_ERROR;
  else if (n === CALC_TYPE.CIE_FROM_COMPONENTS || n === CALC_TYPE.CIE_ONLY) combNP = belowPass() ?? cieNP;
  else if (n === CALC_TYPE.ESE_ONLY) combNP = eseNP;
  else {
    combNP = belowPass();
    if (combNP === null) {
      if (isFailToken(eseNP) || eseNP === NP_NONE) combNP = NP_NONE;
      else {
        const r = lookupNP(combPct, reference.npTables, c?.combNP);
        combNP = r.ok ? r.value : "";
      }
    }
  }
  if (combNP !== NP_ERROR) {
    const note = belowPass() ? `Below pass mark for category ${m}`
      : isFailToken(eseNP) ? "ESE not cleared"
      : combNP === NP_NONE && n === CALC_TYPE.CIE_AND_ESE ? "No ESE grade point" : undefined;
    step("combNP", "COMB-NP", combNP, note);
  }

  let status;
  if (cie === "A" || ese === "A") status = STATUS.ABSENT;
  else if (combNP === NP_ERROR) status = STATUS.BLANK;
  else if (combNP === NP_NONE || isFailToken(combNP)) status = STATUS.FAIL;
  else if (combNP === "") status = STATUS.ABSENT;
  else status = STATUS.PASS;

  const reasons = [];
  if (policy.incompleteCourse === "error" && (!course || !isNum(N) || !isNum(M))) {
    reasons.push(course ? "Course is missing calculation type or pass category" : "Paper code not found in course master");
    status = STATUS.ERROR;
  } else if (status !== STATUS.ABSENT) {
    const needsCie = (N === CALC_TYPE.CIE_FROM_COMPONENTS || N === CALC_TYPE.CIE_AND_ESE || N === CALC_TYPE.CIE_ONLY) && isNum(cieMax) && cieMax !== 0;
    const needsEse = (N === CALC_TYPE.CIE_AND_ESE || N === CALC_TYPE.ESE_ONLY) && isNum(eseMax) && eseMax !== 0;

    if (policy.invalidMark === "hold") {
      const bad = (v, label) => !isBlank(v) && v !== "A" && !isNum(v) && reasons.push(`${label} mark "${v}" is not a number`);
      bad(cie, "CIE"); bad(ese, "ESE");
      if (reasons.length) status = STATUS.ERROR;
    }

    if (status !== STATUS.ERROR && policy.missingMark === "pending") {
      if (needsCie && isBlank(cie)) reasons.push("CIE mark not received");
      if (needsEse && isBlank(ese)) reasons.push("ESE mark not received");
      if (reasons.length) status = STATUS.PENDING;
    }
  }

  step("status", "Result", status, reasons.join("; ") || undefined);

  return {
    cieRound, ciePct, cieNP,
    eseRound, esePct, eseGracedPct, eseFinalPct, eseComptPct, eseNP,
    combPct, combNP,
    credits: isNum(c?.credits) ? c.credits : 0,
    status, reasons, trace
  };
}
