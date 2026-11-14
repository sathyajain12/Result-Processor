import { NP_NONE, STATUS } from "./constants.js";
import { isNum, roundGpa } from "./math.js";
import { letterGrade } from "./tables.js";

export const STUDENT_STATE = Object.freeze({
  RESULT: "Result",
  WITHHELD: "Withheld",
  HELD: "Held"
});

export function computeStudent(student, papers, reference, { semCredits = null } = {}) {
  let sumCredits = 0;
  let sumCreditNP = 0;
  let hasFail = false;
  let hasAbsent = false;
  const failedCourses = [];
  const held = [];

  for (const p of papers) {
    const r = p.result;
    sumCredits += r.credits;

    if (isNum(r.combNP)) sumCreditNP += r.credits * r.combNP;
    else if (r.combNP === NP_NONE && isNum(r.cieNP)) sumCreditNP += r.credits * r.cieNP;

    if (r.status === STATUS.FAIL) { hasFail = true; failedCourses.push(p.paperCode); }
    if (r.status === STATUS.ABSENT) hasAbsent = true;
    if (r.status === STATUS.PENDING || r.status === STATUS.ERROR) {
      held.push({ paperCode: p.paperCode, status: r.status, reasons: r.reasons });
    }
  }

  const base = {
    regdNo: student.regdNo,
    programme: student.programme,
    campus: student.campus,
    semester: student.semester,
    name: student.name,
    totalPapers: papers.length,
    sumCredits,
    failedCourses
  };

  if (isNum(semCredits) && semCredits > 0 && sumCredits !== semCredits) {
    return {
      ...base, state: STUDENT_STATE.WITHHELD,
      reasons: [`Credits ${sumCredits} do not match SMF semester credits ${semCredits}`],
      calculatedGPA: null, sumCreditNP: null, publishedGPA: null, letterGrade: "", qualifier: "", isAbsent: 0, held
    };
  }

  const calculatedGPA = sumCredits > 0 ? roundGpa(sumCreditNP / sumCredits) : 0;
  const publishedGPA = hasAbsent ? "Absent" : hasFail ? "Fail" : calculatedGPA;

  let grade = { letter: "", qualifier: "", table: null };
  if (isNum(publishedGPA)) {
    const tableCode = reference.programmes?.[student.programme]?.gradeTable || "II-A";
    grade = letterGrade(publishedGPA, reference.gradeTables, tableCode);
  }

  return {
    ...base,
    state: held.length ? STUDENT_STATE.HELD : STUDENT_STATE.RESULT,
    reasons: held.map(h => `${h.paperCode}: ${h.reasons.join("; ")}`),
    calculatedGPA,
    sumCreditNP,
    publishedGPA,
    letterGrade: grade.letter,
    qualifier: grade.qualifier,
    gradeTable: grade.table,
    isAbsent: hasAbsent ? 1 : 0,
    held
  };
}
