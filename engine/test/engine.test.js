import { test } from "node:test";
import assert from "node:assert/strict";
import { computePaper, computeStudent, roundSheets, POLICY, STATUS, STUDENT_STATE } from "../src/index.js";

const reference = {
  weightage: { 1: { cie: 0.5, ese: 0.5 }, 2: { cie: 0.4, ese: 0.6 } },
  npTables: {
    "I-A": [{ ll: 0, np: "Fails" }, { ll: 40, np: 4 }, { ll: 45, np: 5 }, { ll: 55, np: 6 }, { ll: 65, np: 7 }, { ll: 75, np: 8 }, { ll: 85, np: 9 }, { ll: 95, np: 9.5 }, { ll: 100, np: 10 }],
    "I-B": [{ ll: 0, np: "Fails" }, { ll: 50, np: 5 }, { ll: 55, np: 6 }, { ll: 65, np: 7 }, { ll: 75, np: 8 }, { ll: 85, np: 9 }, { ll: 95, np: 9.5 }, { ll: 100, np: 10 }]
  },
  gradeTables: {
    "II-A": [{ ll: 0, ul: 3.9, lg: "Fail", qa: "Fail" }, { ll: 4, ul: 4.9, lg: "C", qa: "Average" }, { ll: 5, ul: 5.9, lg: "B", qa: "Fair" }, { ll: 6, ul: 6.9, lg: "A", qa: "Good" }, { ll: 7, ul: 7.9, lg: "A+", qa: "Very Good" }, { ll: 8, ul: 8.9, lg: "O", qa: "Distinction" }, { ll: 9, ul: 10, lg: "O+", qa: "Outstanding" }]
  },
  programmes: { "BSH-CS": { gradeTable: "II-A" } }
};

const course = { code: "UCSC-101", calcType: 2, passCategory: 1, weightageCategory: 2, cieMax: 50, eseMax: 100, credits: 4, cieNP: "I-A", eseNP: "I-A", combNP: "I-A" };

test("rounds half away from zero like Sheets", () => {
  assert.equal(roundSheets(60.5), 61);
  assert.equal(roundSheets(0.4 * 55 + 0.6 * 62), 59);
  assert.equal(roundSheets(-2.5), -3);
});

test("weighted CIE + ESE pass", () => {
  const r = computePaper({ cie: 34, ese: 61 }, course, reference);
  assert.equal(r.ciePct, 68);
  assert.equal(r.eseComptPct, 61);
  assert.equal(r.combPct, 64);
  assert.equal(r.combNP, 6);
  assert.equal(r.status, STATUS.PASS);
});

test("ESE below 40 fails the paper even if COMB passes", () => {
  const r = computePaper({ cie: 50, ese: 35 }, course, reference);
  assert.equal(r.eseNP, "< 4");
  assert.equal(r.combNP, "--");
  assert.equal(r.status, STATUS.FAIL);
});

test("missing ESE is Pending by default and Fails in legacy", () => {
  assert.equal(computePaper({ cie: 40, ese: null }, course, reference).status, STATUS.PENDING);
  assert.equal(computePaper({ cie: 40, ese: null }, course, reference, POLICY.LEGACY).status, STATUS.FAIL);
});

test("absent wins over everything", () => {
  assert.equal(computePaper({ cie: "A", ese: 80 }, course, reference).status, STATUS.ABSENT);
});

test("unknown course is an Error by default", () => {
  assert.equal(computePaper({ cie: 40, ese: 50 }, null, reference).status, STATUS.ERROR);
});

test("student with a pending paper is held, others get GPA and grade", () => {
  const student = { regdNo: "1", programme: "BSH-CS", semester: "I" };
  const ok = computePaper({ cie: 45, ese: 90 }, course, reference);
  const pending = computePaper({ cie: 45, ese: null }, course, reference);

  const s1 = computeStudent(student, [{ paperCode: "A", result: ok }], reference);
  assert.equal(s1.state, STUDENT_STATE.RESULT);
  assert.equal(s1.publishedGPA, 9);
  assert.equal(s1.letterGrade, "O+");

  const s2 = computeStudent(student, [{ paperCode: "A", result: ok }, { paperCode: "B", result: pending }], reference);
  assert.equal(s2.state, STUDENT_STATE.HELD);
});

test("credit mismatch with SMF withholds the result", () => {
  const s = computeStudent({ regdNo: "1", programme: "BSH-CS" }, [{ paperCode: "A", result: computePaper({ cie: 45, ese: 90 }, course, reference) }], reference, { semCredits: 20 });
  assert.equal(s.state, STUDENT_STATE.WITHHELD);
});

test("per-course weights override the weightage category (B.Ed 30/70)", () => {
  const bed = { ...course, cieMax: 30, eseMax: 70, weightageCategory: 1, cieWeight: 0.3, eseWeight: 0.7 };
  const r = computePaper({ cie: 29, ese: 54 }, bed, reference);
  assert.equal(r.ciePct, 97);
  assert.equal(r.eseComptPct, 77);
  assert.equal(r.combPct, 83);
});

test("unreadable mark holds the paper; a mark above the maximum is graded as given (Rule 3B warns)", () => {
  assert.equal(computePaper({ cie: "AB", ese: 60 }, course, reference).status, STATUS.ERROR);
  const above = computePaper({ cie: 55, ese: 60 }, course, reference);
  assert.equal(above.status, STATUS.PASS);
  assert.equal(above.ciePct, 110);
});

test("every result carries an explanation trace", () => {
  const r = computePaper({ cie: 34, ese: 61 }, course, reference);
  assert.deepEqual(r.trace.map(t => t.key), ["cie", "cieNP", "ese", "eseNP", "comb", "combNP", "status"]);
});

import { computeCgpa, CGPA_STATUS } from "../src/index.js";

test("CGPA sums previous and current credit points (matches CGPA Result sheet row)", () => {
  const r = computeCgpa(
    { semester: "IV", publishedGPA: 8.2, sumCreditNP: 155, sumCredits: 19 },
    [{ semesterNo: 1, creditNP: 153, credits: 21 }, { semesterNo: 2, creditNP: 164, credits: 23 }],
    reference, "II-A");
  assert.equal(r.status, CGPA_STATUS.WITHHELD);
  const r2 = computeCgpa(
    { semester: "III", publishedGPA: 8.2, sumCreditNP: 155, sumCredits: 19 },
    [{ semesterNo: 1, creditNP: 153, credits: 21 }, { semesterNo: 2, creditNP: 164, credits: 23 }],
    reference, "II-A");
  assert.equal(r2.status, CGPA_STATUS.COMPUTED);
  assert.equal(r2.cgpa, 7.49);
  assert.equal(r2.letterGrade, "A+");
});
