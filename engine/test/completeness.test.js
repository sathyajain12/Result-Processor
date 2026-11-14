import { test } from "node:test";
import assert from "node:assert/strict";
import { processSession, EXCEPTION, STUDENT_STATE } from "../src/index.js";

const NP = [{ ll: 0, np: "Fails" }, { ll: 40, np: 4 }, { ll: 45, np: 5 }, { ll: 55, np: 6 }, { ll: 65, np: 7 }, { ll: 75, np: 8 }, { ll: 85, np: 9 }, { ll: 95, np: 9.5 }, { ll: 100, np: 10 }];
const course = (code, extra = {}) => ({ code, title: code, programmes: "BSH-M", semester: "II", category: "DSC", credits: 4, cieMax: 50, eseMax: 100,
  cieWeight: 0.5, eseWeight: 0.5, calcType: 2, cieNP: "I-A", eseNP: "I-A", combNP: "I-A", passCategory: 1, weightageCategory: 1, batches: [], ...extra });
const reference = {
  weightage: { 1: { cie: 0.5, ese: 0.5 } }, npTables: { "I-A": NP },
  gradeTables: { "II-A": [{ ll: 0, ul: 3.9, lg: "Fail", qa: "Fail" }, { ll: 4, ul: 10, lg: "A", qa: "Good" }] },
  programmes: { "BSH-M": { gradeTable: "II-A" } },
  courses: [course("TMAT-201"), course("TPHY-202")]
};
const students = Object.fromEntries(["S1", "S2", "S3", "S4"].map(r => [r, { regdNo: r, name: r, programme: "BSH-M", semester: "II", batch: "", semCredits: null }]));
const run = rows => processSession({
  reference, students,
  cie: rows.map(([regdNo, paperCode, cie]) => ({ regdNo, paperCode, raw: cie })),
  ese: rows.map(([regdNo, paperCode, , ese]) => ({ regdNo, paperCode, raw: ese }))
});
const full = r => [[r, "TMAT-201", 40, 70], [r, "TPHY-202", 40, 70]];

test("Rule 1B: a partly arrived course only warns, even when most of the batch has it; nobody is held for it", () => {
  // TPHY-202 arrived for 3 of 4 students (75%): the old 75% rule would have held S4.
  const out = run([...full("S1"), ...full("S2"), ...full("S3"), ["S4", "TMAT-201", 40, 70]]);
  const partial = out.exceptions.find(e => e.code === EXCEPTION.COURSE_PARTIAL);
  assert.equal(partial.severity, "warn");
  assert.deepEqual([partial.details.arrived, partial.details.expected, partial.details.missing], [3, 4, ["S4"]]);
  const s4 = out.results.find(r => r.regdNo === "S4");
  assert.equal(s4.state, STUDENT_STATE.RESULT);
  assert.equal(s4.releasable, true);
  assert.equal(s4.papers.length, 1);
});

test("Rule 1B: a course nobody has marks for blocks the batch", () => {
  const out = run(["S1", "S2", "S3", "S4"].map(r => [r, "TMAT-201", 40, 70]));
  const e = out.exceptions.find(x => x.code === EXCEPTION.COURSE_NOT_RECEIVED);
  assert.equal(e.severity, "block");
  assert.equal(out.batches[0].blocked, true);
  assert.ok(out.results.every(r => !r.releasable));
});

test("Rule 1B: a course not received holds only students whose credits are short, so another campus can go ahead", () => {
  // TBIO-203 has no marks anywhere. S1 and S2 (one campus) do not take it: their 8 Sem-Credits are complete.
  // S3 and S4 (the other campus) need 12 credits, so they wait for it.
  const ref = { ...reference, courses: [...reference.courses, course("TBIO-203")] };
  const st = Object.fromEntries(Object.entries(students).map(([r, s]) => [r, { ...s, semCredits: r === "S1" || r === "S2" ? 8 : 12 }]));
  const rows = ["S1", "S2", "S3", "S4"].flatMap(full);
  const out = processSession({ reference: ref, students: st,
    cie: rows.map(([regdNo, paperCode, cie]) => ({ regdNo, paperCode, raw: cie })),
    ese: rows.map(([regdNo, paperCode, , ese]) => ({ regdNo, paperCode, raw: ese })) });
  assert.ok(out.exceptions.some(x => x.code === EXCEPTION.COURSE_NOT_RECEIVED && x.paperCode === "TBIO-203"));
  const ready = Object.fromEntries(out.results.map(r => [r.regdNo, r.releasable]));
  assert.deepEqual(ready, { S1: true, S2: true, S3: false, S4: false });
  assert.equal(out.batches[0].blocked, false);
});

test("batch figures per campus: one campus ready while the other waits", () => {
  const st = Object.fromEntries(Object.entries(students).map(([r, s]) => [r, { ...s, campus: r === "S1" || r === "S2" ? "Anantapur" : "Brindavan" }]));
  // S1, S2 complete; S3 has no ESE for TPHY-202 yet, S4 complete.
  const rows = [...full("S1"), ...full("S2"), ["S3", "TMAT-201", 40, 70], ["S3", "TPHY-202", 40, ""], ...full("S4")];
  const out = processSession({ reference, students: st,
    cie: rows.map(([regdNo, paperCode, cie]) => ({ regdNo, paperCode, raw: cie })),
    ese: rows.map(([regdNo, paperCode, , ese]) => ({ regdNo, paperCode, raw: ese })) });
  const c = Object.fromEntries(out.batches[0].campuses.map(x => [x.campus, x]));
  assert.deepEqual([c.Anantapur.students, c.Anantapur.ready, c.Anantapur.held, c.Anantapur.arrival], [2, 2, 0, 1]);
  assert.deepEqual([c.Brindavan.students, c.Brindavan.ready, c.Brindavan.held, c.Brindavan.arrival], [2, 1, 1, 0.75]);
});

test("Rule 3B: a mark above the CMF maximum warns and is graded as given", () => {
  const out = run([...full("S1"), ...full("S2"), ...full("S3"), ["S4", "TMAT-201", 40, 112], ["S4", "TPHY-202", 40, 70]]);
  const e = out.exceptions.find(x => x.code === EXCEPTION.MARK_ABOVE_MAX);
  assert.equal(e.severity, "warn");
  assert.equal(e.regdNo, "S4");
  assert.ok(!out.exceptions.some(x => x.code === EXCEPTION.MARK_INVALID));
  assert.equal(out.results.find(r => r.regdNo === "S4").releasable, true);
});

test("Rule 3B: a mark where the CMF has no component warns", () => {
  const ref = { ...reference, courses: [course("TMAT-201"), course("TPHY-202", { cieMax: 0, calcType: 4, cieWeight: 0, eseWeight: 1 })] };
  const out = processSession({
    reference: ref, students: { S1: students.S1 },
    cie: [{ regdNo: "S1", paperCode: "TMAT-201", raw: 40 }, { regdNo: "S1", paperCode: "TPHY-202", raw: 12 }],
    ese: [{ regdNo: "S1", paperCode: "TMAT-201", raw: 70 }, { regdNo: "S1", paperCode: "TPHY-202", raw: 70 }]
  });
  assert.ok(out.exceptions.some(x => x.code === EXCEPTION.MARK_UNEXPECTED && x.severity === "warn"));
});

test("Rule 2: an unreadable mark still holds the student, a blank one is still Pending", () => {
  const out = run([...full("S1"), ...full("S2"), ["S3", "TMAT-201", "4O", 70], ["S3", "TPHY-202", 40, 70], ["S4", "TMAT-201", 40, ""], ["S4", "TPHY-202", 40, 70]]);
  assert.equal(out.exceptions.find(x => x.code === EXCEPTION.MARK_INVALID).regdNo, "S3");
  assert.equal(out.exceptions.find(x => x.code === EXCEPTION.MARK_MISSING).regdNo, "S4");
  assert.equal(out.results.find(r => r.regdNo === "S3").releasable, false);
  assert.equal(out.results.find(r => r.regdNo === "S4").releasable, false);
  assert.equal(out.results.find(r => r.regdNo === "S1").releasable, true);
});
