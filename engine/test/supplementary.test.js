import { test } from "node:test";
import assert from "node:assert/strict";
import { processSession, mergeSupplementary, compactPaper, expandPaper, POLICY, STUDENT_STATE, EXCEPTION } from "../src/index.js";

const NP = [{ ll: 0, np: "Fails" }, { ll: 40, np: 4 }, { ll: 45, np: 5 }, { ll: 55, np: 6 }, { ll: 65, np: 7 }, { ll: 75, np: 8 }, { ll: 85, np: 9 }, { ll: 95, np: 9.5 }, { ll: 100, np: 10 }];
const course = (code, credits) => ({ code, title: code, programmes: "BSH-M", semester: "II", category: "DSC", credits, cieMax: 50, eseMax: 100,
  cieWeight: 0.5, eseWeight: 0.5, calcType: 2, cieNP: "I-A", eseNP: "I-A", combNP: "I-A", passCategory: 1, weightageCategory: 1, batches: [] });
const reference = {
  weightage: { 1: { cie: 0.5, ese: 0.5 } }, npTables: { "I-A": NP },
  gradeTables: { "II-A": [{ ll: 0, ul: 3.9, lg: "Fail", qa: "Fail" }, { ll: 4, ul: 4.9, lg: "C", qa: "Average" }, { ll: 5, ul: 5.9, lg: "B", qa: "Fair" }, { ll: 6, ul: 6.9, lg: "A", qa: "Good" }, { ll: 7, ul: 7.9, lg: "A+", qa: "Very Good" }, { ll: 8, ul: 8.9, lg: "O", qa: "Distinction" }, { ll: 9, ul: 10, lg: "O+", qa: "Outstanding" }] },
  programmes: { "BSH-M": { gradeTable: "II-A" } },
  courses: [course("TMAT-201", 4), course("TPHY-202", 4), course("TENG-203", 2)]
};
const student = regdNo => ({ regdNo, name: regdNo, programme: "BSH-M", semester: "II", batch: "", semCredits: null });
const marks = (rows, comp) => rows.map(([regdNo, paperCode, cie, ese]) => ({ regdNo, paperCode, raw: comp === "CIE" ? cie : ese }));

// Base session: S1 fails TPHY-202, S2 passes everything.
function baseResults() {
  const rows = [["S1", "TMAT-201", 40, 80], ["S1", "TPHY-202", 10, 18], ["S1", "TENG-203", 38, 70],
                ["S2", "TMAT-201", 45, 90], ["S2", "TPHY-202", 40, 85], ["S2", "TENG-203", 42, 88]];
  const out = processSession({ reference, students: { S1: student("S1"), S2: student("S2") }, cie: marks(rows, "CIE"), ese: marks(rows, "ESE") });
  return new Map(out.results.map(r => [r.regdNo, {
    sessionId: "base", approvedAt: "2026-10-01 10:00:00", approvedBy: "coe@sssihl.edu.in", runId: "run-1", digest: `d-${r.regdNo}`, batchKey: r.batchKey,
    sumCredits: r.sumCredits, publishedGPA: r.publishedGPA, papers: r.papers.map(compactPaper)
  }]));
}

function supp(rows, regdNos, overrides = []) {
  const students = Object.fromEntries(regdNos.map(r => [r, student(r)]));
  const out = processSession({ reference, students, cie: marks(rows, "CIE"), ese: marks(rows, "ESE"), overrides, policy: { ...POLICY.DEFAULT, expectFromCmf: false } });
  return { out, students };
}

const run = (rows, regdNos, base = baseResults(), overrides = []) => {
  const { out, students } = supp(rows, regdNos, overrides);
  return mergeSupplementary({ supp: out, base, students, reference, overrides });
};

test("supplementary: a failed paper is replaced and the semester GPA recomputed", () => {
  const r = run([["S1", "TPHY-202", 35, 70]], ["S1"]).results[0];
  assert.equal(r.state, STUDENT_STATE.RESULT);
  assert.equal(typeof r.publishedGPA, "number");
  assert.ok(r.letterGrade);
  assert.equal(r.papers.length, 3);
  const phy = r.papers.find(p => p.paperCode === "TPHY-202");
  assert.equal(phy.origin, "supp");
  assert.deepEqual(phy.replaced.status, "Fails");
  assert.equal(r.papers.filter(p => p.origin === "base").length, 2);
  assert.deepEqual(r.supplementary.replaced, ["TPHY-202"]);
  assert.equal(r.supplementary.baseDigest, "d-S1");
  assert.equal(r.releasable, true);
});

test("supplementary: absent in the re-appeared paper keeps the result Absent", () => {
  const r = run([["S1", "TPHY-202", 35, "A"]], ["S1"]).results[0];
  assert.equal(r.publishedGPA, "Absent");
});

test("supplementary: no approved base result is held even when the exception is accepted", () => {
  const accept = [{ type: "accept", code: EXCEPTION.SUPP_NO_BASE_RESULT, batchKey: "BSH-M|II|", regdNo: "S9" }];
  const out = run([["S9", "TPHY-202", 35, 70]], ["S9"], baseResults(), accept);
  const r = out.results[0];
  assert.equal(r.state, STUDENT_STATE.HELD);
  assert.equal(r.releasable, false);
  assert.ok(out.exceptions.some(e => e.code === EXCEPTION.SUPP_NO_BASE_RESULT));
});

test("supplementary: re-appearing in a passed paper warns and still replaces it, even when worse", () => {
  const out = run([["S2", "TMAT-201", 20, 45]], ["S2"]);
  const r = out.results[0];
  const mat = r.papers.find(p => p.paperCode === "TMAT-201");
  assert.equal(mat.origin, "supp");
  assert.equal(mat.replaced.status, "Pass");
  assert.ok(out.exceptions.some(e => e.code === EXCEPTION.SUPP_REAPPEAR_PASSED && e.severity === "warn"));
  assert.ok(r.publishedGPA < baseResults().get("S2").publishedGPA);
});

test("supplementary: a paper not in the base result blocks, and is dropped once accepted", () => {
  const ref2 = { ...reference, courses: [...reference.courses, course("TCHE-204", 4)] };
  const rows = [["S1", "TPHY-202", 35, 70], ["S1", "TCHE-204", 40, 80]];
  const students = { S1: student("S1") };
  const go = overrides => mergeSupplementary({
    supp: processSession({ reference: ref2, students, cie: marks(rows, "CIE"), ese: marks(rows, "ESE"), overrides, policy: { ...POLICY.DEFAULT, expectFromCmf: false } }),
    base: baseResults(), students, reference: ref2, overrides
  });
  const blocked = go([]);
  assert.equal(blocked.results[0].releasable, false);
  assert.equal(blocked.results[0].papers.length, 3);
  const ok = go([{ type: "accept", code: EXCEPTION.SUPP_PAPER_NOT_IN_BASE, batchKey: "BSH-M|II|", regdNo: "S1", paperCode: "TCHE-204" }]);
  assert.equal(ok.results[0].releasable, true);
  assert.ok(!ok.results[0].papers.some(p => p.paperCode === "TCHE-204"));
});

test("supplementary: matching works through _IHA suffixes", () => {
  const r = run([["S1", "TPHY-202_IHA", 35, 70]], ["S1"]).results[0];
  assert.deepEqual(r.supplementary.replaced, ["TPHY-202"]);
  assert.equal(r.papers.length, 3);
});

test("supplementary: a student with no supplementary marks is blocked", () => {
  const out = run([["S1", "TPHY-202", 35, 70]], ["S1", "S2"]);
  assert.ok(out.exceptions.some(e => e.code === EXCEPTION.SUPP_NOTHING_REAPPEARED && e.regdNo === "S2"));
  assert.equal(out.results.find(r => r.regdNo === "S2").releasable, false);
});

test("supplementary: base results are not modified", () => {
  const base = baseResults();
  const before = JSON.stringify([...base]);
  run([["S1", "TPHY-202", 35, 70], ["S2", "TMAT-201", 20, 45]], ["S1", "S2"], base);
  assert.equal(JSON.stringify([...base]), before);
});

test("supplementary: batch stats come from the merged results", () => {
  const out = run([["S1", "TPHY-202", 35, 70]], ["S1"]);
  assert.equal(out.batches.length, 1);
  assert.equal(out.batches[0].passed, 1);
  assert.equal(out.batches[0].failed, 0);
});

test("compactPaper / expandPaper round trip keeps every stored field", () => {
  for (const p of baseResults().get("S1").papers) {
    assert.deepEqual(compactPaper(expandPaper(p)), p);
  }
});
