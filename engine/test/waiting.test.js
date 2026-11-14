import { test } from "node:test";
import assert from "node:assert/strict";
import { processSession, POLICY, EXCEPTION, STUDENT_STATE } from "../src/index.js";

// A student short of Sem-Credits only because a paper they take has no marks yet is held for the marks, not withheld.
const IA = [{ ll: 0, np: "Fails" }, { ll: 40, np: 4 }, { ll: 55, np: 6 }, { ll: 75, np: 8 }, { ll: 100, np: 10 }];
const base = { programmes: "BBAH", semester: "VII", calcType: 2, cieMax: 50, eseMax: 50, cieWeight: 0.5, eseWeight: 0.5, courseType: "Theory",
  cieNP: "I-A", eseNP: "I-A", combNP: "I-A", passCategory: 1, weightageCategory: 1, batches: ["2023"] };
const COURSES = [
  { ...base, code: "UBBA-701", baseCode: "UBBA-701", category: "DSC", credits: 4 },
  // The CMF lists the elective under a longer code because the code repeats; the SMF names it by its own code.
  { ...base, code: "UBBA-703(imb26_mg236)-Arts-Sem-VII-IDM", baseCode: "UBBA-703(imb26_mg236)", category: "IDM", credits: 4 },
  { ...base, code: "UBBA-703(noc25_mg13)-Arts-Sem-VII-IDM", baseCode: "UBBA-703(noc25_mg13)", category: "IDM", credits: 4 }
];
const reference = { courses: COURSES, npTables: { "I-A": IA }, weightage: { 1: { cie: 0.5, ese: 0.5 } },
  gradeTables: { "II-A": [{ ll: 0, ul: 10, lg: "P", qa: "Pass" }] }, programmes: { BBAH: { gradeTable: "II-A", passCategory: 1 } } };

function run({ semCredits = 8, electives = ["UBBA-703(imb26_mg236)"], marks = [["UBBA-701", 40, 40]] } = {}) {
  const student = { regdNo: "S1", name: "S1", programme: "BBAH", semester: "VII", batch: "2023", semCredits, electives };
  const out = processSession({
    reference, students: { S1: student }, policy: POLICY.DEFAULT,
    cie: marks.map(([paperCode, cie]) => ({ regdNo: "S1", paperCode, raw: cie })),
    ese: marks.map(([paperCode, , ese]) => ({ regdNo: "S1", paperCode, raw: ese }))
  });
  return { r: out.results[0], codes: c => out.exceptions.filter(e => e.code === c) };
}

test("Elective with no marks yet: held, waiting for that paper, not withheld for credits", () => {
  const { r, codes } = run();
  assert.equal(r.state, STUDENT_STATE.HELD);
  assert.equal(r.releasable, false);
  assert.equal(codes(EXCEPTION.CREDIT_MISMATCH).length, 0);
  const missing = codes(EXCEPTION.MARK_MISSING).filter(e => e.regdNo === "S1");
  assert.deepEqual(missing.map(e => e.paperCode), ["UBBA-703(imb26_mg236)"]);
  assert.match(missing[0].message, /^UBBA-703\(imb26_mg236\): no marks received yet \(4 credits\)/);
  assert.match(r.reasons[0], /Marks not received yet for UBBA-703\(imb26_mg236\) \(4 credits\)/);
  // The other option is not the student's, so it is not expected from them.
  assert.ok(!missing.some(e => e.paperCode.includes("noc25_mg13")));
  // Nobody in the batch has marks for it yet, so the batch is told too (Rule 1B).
  assert.equal(codes(EXCEPTION.COURSE_NOT_RECEIVED).length, 1);
});

test("Once the elective's marks arrive the credits match and the result is ready", () => {
  const { r, codes } = run({ marks: [["UBBA-701", 40, 40], ["UBBA-703(imb26_mg236)", 30, 30]] });
  assert.equal(r.state, STUDENT_STATE.RESULT);
  assert.equal(r.sumCredits, 8);
  assert.equal(codes(EXCEPTION.MARK_MISSING).length, 0);
});

test("A real shortfall is still withheld, and says which papers are also waiting", () => {
  const { r, codes } = run({ semCredits: 12 });
  assert.equal(r.state, STUDENT_STATE.WITHHELD);
  const m = codes(EXCEPTION.CREDIT_MISMATCH);
  assert.equal(m.length, 1);
  assert.equal(m[0].message, "Credits 4 do not match SMF semester credits 12 (no marks yet for UBBA-703(imb26_mg236))");
});

test("An elective the student did not choose is not expected from them", () => {
  const { r, codes } = run({ semCredits: 4, electives: [] });
  assert.equal(r.state, STUDENT_STATE.RESULT);
  assert.equal(codes(EXCEPTION.MARK_MISSING).length, 0);
});
