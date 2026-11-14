import { isNum, roundSheets } from "./math.js";
import { letterGrade } from "./tables.js";

export const CGPA_STATUS = Object.freeze({ COMPUTED: "COMPUTED", WITHHELD: "WITHHELD", NOT_APPLICABLE: "NOT_APPLICABLE" });

export const semesterNumber = s => ({ I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10 })[String(s).trim().toUpperCase()] ?? Number(s);

export function computeCgpa(current, previous, reference, gradeTableCode) {
  const curSem = semesterNumber(current.semester);
  const prior = (previous || []).filter(p => p.semesterNo < curSem && isNum(p.credits) && p.credits > 0);

  if (!isNum(current.publishedGPA)) {
    return { status: CGPA_STATUS.WITHHELD, reason: "Current semester result is not a GPA", prior };
  }
  if (!prior.length) {
    return { status: CGPA_STATUS.NOT_APPLICABLE, reason: "No previous semester data", prior };
  }
  const missing = [];
  for (let s = 1; s < curSem; s++) if (!prior.some(p => p.semesterNo === s)) missing.push(s);
  if (missing.length) {
    return { status: CGPA_STATUS.WITHHELD, reason: `Previous semester data missing for semester ${missing.join(", ")}`, prior };
  }

  const totalCreditNP = prior.reduce((n, p) => n + (p.creditNP || 0), 0) + current.sumCreditNP;
  const totalCredits = prior.reduce((n, p) => n + p.credits, 0) + current.sumCredits;
  const cgpa = roundSheets(totalCreditNP / totalCredits, 2);
  const g = letterGrade(cgpa, reference.gradeTables, gradeTableCode || "II-A");
  return { status: CGPA_STATUS.COMPUTED, totalCreditNP, totalCredits, cgpa, letterGrade: g.letter, qualifier: g.qualifier, prior };
}
