import { test } from "node:test";
import assert from "node:assert/strict";
import { processSession, mergeSupplementary, compactPaper, supplementaryGrace, gracePoolOf, isPostgraduate, POLICY, EXCEPTION, STUDENT_STATE } from "../src/index.js";

const IA = [{ ll: 0, np: "Fails" }, { ll: 40, np: 4 }, { ll: 45, np: 5 }, { ll: 55, np: 6 }, { ll: 65, np: 7 }, { ll: 75, np: 8 }, { ll: 85, np: 9 }, { ll: 95, np: 9.5 }, { ll: 100, np: 10 }];
const IB = [{ ll: 0, np: "Fails" }, { ll: 50, np: 5 }, { ll: 55, np: 6 }, { ll: 65, np: 7 }, { ll: 75, np: 8 }, { ll: 85, np: 9 }, { ll: 95, np: 9.5 }, { ll: 100, np: 10 }];

const theory = (code, over = {}) => ({ code, title: code, programmes: "BCOM", semester: "V", category: "DSC", credits: 4, cieMax: 50, eseMax: 100,
  cieWeight: 0.5, eseWeight: 0.5, calcType: 2, courseType: "Theory", cieNP: "I-A", eseNP: "I-A", combNP: "I-A", passCategory: 1, weightageCategory: 1, batches: [], ...over });

const referenceFor = courses => ({
  courses, npTables: { "I-A": IA, "I-B": IB }, weightage: { 1: { cie: 0.5, ese: 0.5 } },
  gradeTables: { "II-B": [{ ll: 0, ul: 3.9, lg: "F", qa: "Fail" }, { ll: 4, ul: 10, lg: "P", qa: "Pass" }] },
  programmes: { BCOM: { gradeTable: "II-B", passCategory: 1 }, MSC: { gradeTable: "II-B", passCategory: 2 }, MTECH: { gradeTable: "II-B", passCategory: 3 } }
});

// rows: [paperCode, cie, ese]
function grade(courses, rows, { programme = "BCOM", gracePool = null, policy = POLICY.DEFAULT } = {}) {
  const courses2 = courses.map(c => ({ ...c, programmes: programme }));
  const students = { S1: { regdNo: "S1", name: "S1", programme, semester: "V", batch: "", semCredits: null } };
  const reference = referenceFor(courses2);
  const out = processSession({
    reference, students, policy, gracePool,
    cie: rows.filter(r => r[1] !== undefined && r[1] !== null).map(([paperCode, cie]) => ({ regdNo: "S1", paperCode, raw: cie })),
    ese: rows.filter(r => r[2] !== undefined && r[2] !== null).map(([paperCode, , ese]) => ({ regdNo: "S1", paperCode, raw: ese }))
  });
  const r = out.results[0];
  return { r, out, reference, students, paper: code => r.papers.find(p => p.paperCode === code), codes: c => out.exceptions.filter(e => e.code === c) };
}

const TABLE_COURSES = [
  theory("UCOM-501"), theory("UCOM-502"), theory("UCOM-503"), theory("UCOM-504"), theory("UCOM-505"),
  theory("UCOM-506", { eseMax: 0, calcType: 3, eseWeight: 0, cieWeight: 1 }),
  // Non-credit: as in the real CMF, both maximums are 0 and no marks exist, so it never becomes a paper.
  theory("UCOM-507", { cieMax: 0, eseMax: 0, calcType: 5, credits: 0, courseType: "--" })
];

test("the Controller's example: pool 5, spent in seriatim", () => {
  const g = grade(TABLE_COURSES, [
    ["UCOM-501", 30, 39], ["UCOM-502", 30, 37], ["UCOM-503", 30, 38], ["UCOM-504", 30, 39], ["UCOM-505", 40, 77], ["UCOM-506", 40]
  ]);
  assert.equal(g.r.grace.pool, 5);
  assert.deepEqual(["UCOM-501", "UCOM-502", "UCOM-504"].map(c => [g.paper(c).grace.marks, g.paper(c).result.eseComptPct, g.paper(c).result.status]),
    [[1, 40, "Pass"], [3, 40, "Pass"], [1, 40, "Pass"]]);
  assert.equal(g.paper("UCOM-503").grace, undefined);
  assert.equal(g.paper("UCOM-503").result.status, "Fails");
  assert.equal(g.paper("UCOM-505").grace, undefined);
  assert.equal(g.paper("UCOM-506").grace, undefined);
  assert.equal(g.paper("UCOM-507"), undefined);
  assert.equal(g.r.grace.used, 5);
  assert.equal(g.r.grace.left, 0);
  const refused = g.codes(EXCEPTION.GRACE_NOT_AVAILABLE);
  assert.equal(refused.length, 1);
  assert.equal(refused[0].paperCode, "UCOM-503");
  assert.match(refused[0].message, /needs 2 grace marks, but only 1 of the pool of 5/);
  assert.equal(g.codes(EXCEPTION.GRACE_APPLIED).length, 3);
  assert.deepEqual(g.r.failedCourses, ["UCOM-503"]);
});

test("seriatim follows course code, not the order marks arrived", () => {
  const g = grade([theory("UCOM-501", { eseMax: 100 }), theory("UCOM-502")], [["UCOM-502", 30, 38], ["UCOM-501", 30, 38]]);
  assert.equal(g.r.grace.pool, 2);
  assert.equal(g.paper("UCOM-501").grace.marks, 2);
  assert.equal(g.paper("UCOM-502").grace, undefined);
});

test("seriatim follows the CMF Sequence before course code", () => {
  // Pool 2 covers one paper needing 2. UPHY-201 (Sequence 3) comes before UCHM-203 (Sequence 4), though its code sorts later.
  const g = grade([theory("UPHY-201", { sequence: "3" }), theory("UCHM-203", { sequence: "4" })], [["UPHY-201", 30, 38], ["UCHM-203", 30, 38]]);
  assert.equal(g.paper("UPHY-201").grace.marks, 2);
  assert.equal(g.paper("UCHM-203").grace, undefined);
});

test("a paper out of 50 makes the pool 4.5 and its shortfall costs actual marks", () => {
  const courses = [theory("A-1", { eseMax: 50 }), theory("A-2"), theory("A-3"), theory("A-4"), theory("A-5")];
  const g = grade(courses, [["A-1", 30, 19], ["A-2", 40, 70], ["A-3", 40, 70], ["A-4", 40, 70], ["A-5", 40, 70]]);
  assert.equal(g.r.grace.pool, 4.5);
  const p = g.paper("A-1");
  assert.equal(p.grace.marks, 1);
  assert.equal(p.grace.gracedMarks, 20);
  assert.equal(p.result.eseComptPct, 40);
  assert.equal(p.result.status, "Pass");
  assert.equal(g.r.grace.left, 3.5);
});

test("COMB grace: CIE 30, ESE 46 costs the COMB shortfall of 2 and ESE becomes 49, the lowest that passes", () => {
  // ESE 49 gives COMB 39.5, which the sheets round to 40.
  const courses = [theory("A-1", { cieMax: 100 }), theory("A-2")];
  const g = grade(courses, [["A-1", 30, 46], ["A-2", 40, 70]]);
  const p = g.paper("A-1");
  assert.equal(p.grace.kind, "COMB");
  assert.equal(p.grace.marks, 2);
  assert.equal(p.grace.gracedMarks, 49);
  assert.equal(p.result.combPct, 40);
  assert.equal(p.result.eseComptPct, 49);
  assert.equal(p.result.ciePct, 30);
  assert.equal(p.result.status, "Pass");
  assert.equal(g.r.grace.left, 0);
});

test("PG COMB grace: CIE 52, ESE 42 is COMB 47; ESE 47 is the lowest that passes (COMB 49.5, rounded to 50)", () => {
  const pg = { passCategory: 2 };
  const g = grade([theory("M-1", { ...pg, cieMax: 100 }), theory("M-2", pg), theory("M-3", pg), theory("M-4", pg)],
    [["M-1", 52, 42], ["M-2", 40, 70], ["M-3", 40, 70], ["M-4", 40, 70]], { programme: "MSC" });
  const p = g.paper("M-1");
  assert.deepEqual([p.grace.kind, p.grace.marks, p.grace.gracedMarks, p.grace.eseToPct], ["COMB", 3, 47, 47]);
  assert.deepEqual([p.result.eseComptPct, p.result.combPct, p.result.status], [47, 50, "Pass"]);
  assert.equal(g.r.grace.left, 1);
});

test("COMB grace with an unusual weightage still lands on the pass mark", () => {
  const g = grade([theory("A-1", { cieMax: 100, cieWeight: 0.3, eseWeight: 0.7 }), theory("A-2", { cieWeight: 0.3, eseWeight: 0.7, eseMax: 300 })], [["A-1", 30, 41], ["A-2", 40, 70]]);
  const p = g.paper("A-1");
  assert.equal(p.grace.kind, "COMB");
  assert.equal(p.result.combPct, 40);
  assert.equal(p.result.status, "Pass");
  assert.equal(p.result.ciePct, 30);
});

test("rule 7: no ESE grace if COMB would still fail", () => {
  const g = grade([theory("A-1", { cieMax: 100 }), theory("A-2")], [["A-1", 30, 38], ["A-2", 40, 70]]);
  const p = g.paper("A-1");
  assert.equal(p.result.combPct, 34);
  assert.equal(p.grace, undefined);
  assert.equal(p.result.status, "Fails");
  assert.equal(p.result.eseComptPct, 38);
  assert.equal(g.r.grace.used, 0);
});

test("rule 6: a paper takes one kind of grace", () => {
  // ESE 38 and COMB 39: ESE grace alone carries COMB to 40.
  const g = grade([theory("A-1", { cieMax: 100 }), theory("A-2")], [["A-1", 40, 38], ["A-2", 40, 70]]);
  const p = g.paper("A-1");
  assert.equal(p.grace.kind, "ESE");
  assert.equal(p.grace.marks, 2);
  assert.equal(p.result.combPct, 40);
  assert.equal(g.r.grace.used, 2);
});

test("a COMB shortfall can be covered when the ESE one cannot", () => {
  // ESE 38 needs 2, COMB 39 needs 1, pool 1.
  const g = grade([theory("A-1", { cieMax: 100 })], [["A-1", 40, 38]]);
  const p = g.paper("A-1");
  assert.equal(p.grace.kind, "COMB");
  assert.equal(p.grace.marks, 1);
  assert.equal(p.result.status, "Pass");
  assert.equal(p.result.eseComptPct, 40);
});

test("a paper still failing on ESE is not graced through COMB", () => {
  const g = grade([theory("A-1", { cieMax: 100 }), theory("A-2")], [["A-1", 46, 30], ["A-2", 40, 70]]);
  const p = g.paper("A-1");
  assert.equal(p.result.combPct, 38);
  assert.equal(p.grace, undefined);
  assert.equal(p.result.status, "Fails");
});

test("COMB grace does not lift an ESE more than 3 below its pass mark", () => {
  // CIE 28/70 (40%), ESE 34: COMB 37 is in range, but the ESE is 6 short of 40, so the paper stays failed.
  const g = grade([theory("A-1", { cieMax: 70 }), theory("A-2")], [["A-1", 28, 34], ["A-2", 40, 70]]);
  const p = g.paper("A-1");
  assert.equal(p.result.combPct, 37);
  assert.equal(p.grace, undefined);
  assert.equal(p.result.status, "Fails");
  // ESE 37 (3 short) with the same CIE is still graced.
  const others = ["A-2", "A-3", "A-4", "A-5"];   // five papers out of 100: a pool of 5
  const ok = grade([theory("A-1", { cieMax: 70 }), ...others.map(c => theory(c))], [["A-1", 28, 37], ...others.map(c => [c, 40, 70])]).paper("A-1");
  assert.equal(ok.result.status, "Pass");
});

test("the range is the policy's > 36% and < 40%: 36% and 40% are not graced, 36.5% and 37% are", () => {
  const go = ese => grade([theory("A-1"), theory("A-2"), theory("A-3"), theory("A-4"), theory("A-5")],
    [["A-1", 30, ese], ["A-2", 40, 70], ["A-3", 40, 70], ["A-4", 40, 70], ["A-5", 40, 70]]).paper("A-1");
  assert.equal(go(36).grace, undefined);
  assert.equal(go(36).result.status, "Fails");
  assert.equal(go(40).grace, undefined);
  assert.equal(go(40).result.status, "Pass");
  assert.equal(go(37).grace.marks, 3);
  assert.equal(go(36.5).grace.marks, 4);   // 3.5 short, rounded up to whole marks
});

test("exact percentages: 36.5 is 3.5 short, not the 3 its rounded 37 would be, and is graced 4 whole marks", () => {
  const g = grade([theory("A-1"), theory("A-2"), theory("A-3"), theory("A-4")], [["A-1", 30, 36.5], ["A-2", 40, 70], ["A-3", 40, 70], ["A-4", 40, 70]]);
  const p = g.paper("A-1");
  assert.deepEqual([p.grace.exactMarks, p.grace.marks, p.grace.fromPct, p.grace.gracedMarks, p.result.status], [3.5, 4, 36.5, 40.5, "Pass"]);
  assert.equal(g.r.grace.left, 0);
  // With a pool of 3 it cannot be covered, though its rounded 37 would have cost exactly 3.
  const short = grade([theory("A-1"), theory("A-2"), theory("A-3")], [["A-1", 30, 36.5], ["A-2", 40, 70], ["A-3", 40, 70]]);
  assert.equal(short.paper("A-1").grace, undefined);
  assert.match(short.codes(EXCEPTION.GRACE_NOT_AVAILABLE)[0].message, /needs 4 grace marks/);
});

test("COMB grace is also given in whole marks: a 1.5-mark COMB shortfall costs 2", () => {
  // CIE 30/100 and ESE 34.5/75 (46%) at 50/50: COMB 38, 2 points short of 40, which is 1.5 marks of an ESE out of 75.
  const g = grade([theory("A-1", { cieMax: 100, eseMax: 75 }), theory("A-2"), theory("A-3")], [["A-1", 30, 34.5], ["A-2", 40, 70], ["A-3", 40, 70]]);
  const p = g.paper("A-1");
  assert.deepEqual([p.grace.kind, p.grace.exactMarks, p.grace.marks, p.result.status], ["COMB", 1.5, 2, "Pass"]);
  assert.equal(g.r.grace.left, 0.75);
});

test("M.Tech: ESE 35 out of 75 is 46.67%, inside the range at a pass mark of 50; 2.5 marks short, graced 3 whole marks", () => {
  const mt = { passCategory: 3, cieNP: "I-B", eseNP: "I-B", combNP: "I-B" };
  const g = grade([theory("T-1", { ...mt, cieMax: 25, eseMax: 75, cieWeight: 0.25, eseWeight: 0.75 }), theory("T-2", mt), theory("T-3", { ...mt, eseMax: 50 }), theory("T-4", mt)],
    [["T-1", 25, 35], ["T-2", 40, 70], ["T-3", 40, 40], ["T-4", 40, 70]], { programme: "MTECH" });
  assert.equal(g.r.grace.pool, 3.25);
  const p = g.paper("T-1");
  assert.deepEqual([p.grace.kind, p.grace.fromPct, p.grace.exactMarks, p.grace.marks, p.grace.gracedMarks, p.grace.eseToPct, p.grace.combFromPct], ["ESE", 46.67, 2.5, 3, 38, 50.67, 60]);
  assert.deepEqual([p.result.eseComptPct, p.result.combPct, p.result.status], [51, 63, "Pass"]);
  assert.equal(g.r.grace.left, 0.25);
  // 34 out of 75 is 45.33%: below the range.
  const below = grade([theory("T-1", { ...mt, cieMax: 25, eseMax: 75, cieWeight: 0.25, eseWeight: 0.75 }), theory("T-2", mt)], [["T-1", 25, 34], ["T-2", 40, 70]], { programme: "MTECH" });
  assert.equal(below.paper("T-1").grace, undefined);
});

test("only Theory is graced; a Viva counts towards the pool", () => {
  const viva = theory("A-9", { courseType: "--", calcType: 4, cieMax: 0, cieWeight: 0, eseWeight: 1, eseMax: 100 });
  const practical = theory("A-8", { courseType: "Practicals" });
  const g = grade([theory("A-1"), practical, viva], [["A-1", 40, 70], ["A-8", 30, 38], ["A-9", null, 38]]);
  assert.equal(g.r.grace.pool, 3);
  assert.equal(g.paper("A-8").grace, undefined);
  assert.equal(g.paper("A-9").grace, undefined);
  assert.equal(g.paper("A-8").result.status, "Fails");
  assert.equal(g.codes(EXCEPTION.GRACE_NO_COURSE_TYPE).length, 0);
});

test("an ESE-only Theory paper is graced on ESE", () => {
  const paper = theory("A-1", { calcType: 4, cieMax: 0, cieWeight: 0, eseWeight: 1 });
  const g = grade([paper, theory("A-2")], [["A-1", null, 38], ["A-2", 40, 70]]);
  assert.equal(g.paper("A-1").grace.kind, "ESE");
  assert.equal(g.paper("A-1").result.status, "Pass");
  assert.equal(g.paper("A-1").result.combPct, 40);
});

test("a blank Course Type is flagged rather than quietly left to fail", () => {
  const g = grade([theory("A-1", { courseType: "" }), theory("A-2")], [["A-1", 30, 38], ["A-2", 40, 70]]);
  assert.equal(g.paper("A-1").grace, undefined);
  const w = g.codes(EXCEPTION.GRACE_NO_COURSE_TYPE);
  assert.equal(w.length, 1);
  assert.equal(w[0].severity, "warn");
  assert.equal(w[0].paperCode, "A-1");
});

test("absent and pending papers are never graced", () => {
  const absent = grade([theory("A-1"), theory("A-2")], [["A-1", 30, "A"], ["A-2", 40, 70]]);
  assert.equal(absent.paper("A-1").grace, undefined);
  assert.equal(absent.paper("A-1").result.status, "Absent");
  const pending = grade([theory("A-1"), theory("A-2")], [["A-1", 30, null], ["A-2", 40, 70]]);
  assert.equal(pending.paper("A-1").grace, undefined);
  assert.equal(pending.paper("A-1").result.status, "Pending");
});

test("PG: COMB 48 graced to 50 at pass category 2", () => {
  const pg = { passCategory: 2 };
  const g = grade([theory("M-1", { ...pg, cieMax: 100 }), theory("M-2", pg), theory("M-3", pg)], [["M-1", 50, 46], ["M-2", 40, 70], ["M-3", 40, 70]], { programme: "MSC" });
  const p = g.paper("M-1");
  assert.equal(p.grace.kind, "COMB");
  assert.equal(p.grace.marks, 2);
  assert.equal(p.result.combPct, 50);
  assert.equal(p.result.status, "Pass");
  assert.match(g.codes(EXCEPTION.GRACE_APPLIED)[0].message, /Add the grace to E1, or to TEB/);
});

test("PG: COMB 46 is outside the range at a pass mark of 50", () => {
  const pg = { passCategory: 2 };
  const g = grade([theory("M-1", { ...pg, cieMax: 100 }), theory("M-2", pg), theory("M-3", pg)], [["M-1", 50, 42], ["M-2", 40, 70], ["M-3", 40, 70]], { programme: "MSC" });
  assert.equal(g.paper("M-1").result.combPct, 46);
  assert.equal(g.paper("M-1").grace, undefined);
});

test("M.Tech: ESE 47 graced to 50 on table I-B", () => {
  const mt = { passCategory: 3, cieNP: "I-B", eseNP: "I-B", combNP: "I-B" };
  const g = grade([theory("T-1", mt), theory("T-2", mt), theory("T-3", mt)], [["T-1", 35, 47], ["T-2", 40, 70], ["T-3", 40, 70]], { programme: "MTECH" });
  const p = g.paper("T-1");
  assert.equal(p.grace.kind, "ESE");
  assert.equal(p.grace.marks, 3);
  assert.equal(p.result.eseComptPct, 50);
  assert.equal(p.result.status, "Pass");
});

test("UG messages do not mention E1", () => {
  const g = grade([theory("A-1"), theory("A-2")], [["A-1", 30, 39], ["A-2", 40, 70]]);
  assert.doesNotMatch(g.codes(EXCEPTION.GRACE_APPLIED)[0].message, /E1/);
});

test("graced papers survive storage; ungraced papers are stored as before", () => {
  const g = grade([theory("A-1"), theory("A-2")], [["A-1", 30, 39], ["A-2", 40, 70]]);
  assert.deepEqual(compactPaper(g.paper("A-1")).grace.marks, 1);
  assert.equal("grace" in compactPaper(g.paper("A-2")), false);
});

test("who counts as PG or professional", () => {
  assert.equal(isPostgraduate("MSC-M", 2), true);
  assert.equal(isPostgraduate("MTECH-CS", 3), true);
  assert.equal(isPostgraduate("B.Ed", 1), true);
  assert.equal(isPostgraduate("BEDN", 1), true);
  assert.equal(isPostgraduate("PPHD-CH", 1), true);
  assert.equal(isPostgraduate("BCOM", 1), false);
});

// ── Supplementary ──
const SUPP_COURSES = [theory("UCOM-501"), theory("UCOM-502"), theory("UCOM-503"), theory("UCOM-504"), theory("UCOM-505")];
const basePapers = used => SUPP_COURSES.map((c, i) => ({ paperCode: c.code, course: c, overrides: null, ...(i === 0 && used ? { grace: { marks: used } } : {}) }));

test("supplementary budgets: UG first attempt, UG second, PG first", () => {
  assert.equal(gracePoolOf(basePapers(0)), 5);
  assert.deepEqual(supplementaryGrace({ basePapers: basePapers(3), postgraduate: false, attempt: 1 }), { pool: 5, usedBefore: 3, available: 2, attempt: 1, terminal: false });
  assert.deepEqual(supplementaryGrace({ basePapers: basePapers(5), postgraduate: false, attempt: 1 }), { pool: 5, usedBefore: 5, available: 0, attempt: 1, terminal: false });
  assert.deepEqual(supplementaryGrace({ basePapers: basePapers(5), postgraduate: false, attempt: 2 }), { pool: 5, usedBefore: 0, available: 5, attempt: 2, terminal: true });
  assert.deepEqual(supplementaryGrace({ basePapers: basePapers(5), postgraduate: true, attempt: 1 }), { pool: 5, usedBefore: 0, available: 5, attempt: 1, terminal: true });
});

const suppRun = (ese, used, { attempt = 1, postgraduate = false } = {}) => {
  const budget = supplementaryGrace({ basePapers: basePapers(used), postgraduate, attempt });
  return grade(SUPP_COURSES, [["UCOM-503", 30, ese]], { gracePool: () => budget, policy: { ...POLICY.DEFAULT, expectFromCmf: false } });
};

test("UG S1: uses what the regular exam left", () => {
  const g = suppRun(38, 3);
  assert.equal(g.paper("UCOM-503").grace.marks, 2);
  assert.equal(g.paper("UCOM-503").result.status, "Pass");
  assert.equal(g.r.grace.used, 2);
  assert.equal(g.r.grace.left, 0);
  assert.equal(g.r.grace.usedBefore, 3);
  assert.equal(g.r.grace.pool, 5);
});

test("UG S1: an exhausted pool means no grace and borderline papers fail", () => {
  const g = suppRun(39, 5);
  assert.equal(g.paper("UCOM-503").grace, undefined);
  assert.equal(g.paper("UCOM-503").result.status, "Fails");
  assert.equal(g.codes(EXCEPTION.GRACE_NOT_AVAILABLE).length, 1);
  assert.match(g.codes(EXCEPTION.GRACE_NOT_AVAILABLE)[0].message, /needs 1 grace mark, but none of the pool of 5 is left/);
});

test("UG S2 and PG S1 get a fresh pool", () => {
  for (const opts of [{ attempt: 2 }, { attempt: 1, postgraduate: true }]) {
    const g = suppRun(37, 5, opts);
    assert.equal(g.paper("UCOM-503").grace.marks, 3);
    assert.equal(g.r.grace.terminal, true);
    assert.equal(g.r.grace.left, 2);
  }
});

test("no regular result: no budget, no grace", () => {
  const g = grade(SUPP_COURSES, [["UCOM-503", 30, 39]], { gracePool: () => null, policy: { ...POLICY.DEFAULT, expectFromCmf: false } });
  assert.equal(g.paper("UCOM-503").grace, undefined);
  assert.equal(g.r.grace.pool, 0);
});

test("merging a supplementary keeps graced papers from both exams, and the budget", () => {
  const reg = grade(SUPP_COURSES, [["UCOM-501", 30, 39], ["UCOM-502", 30, 30], ["UCOM-503", 40, 70], ["UCOM-504", 40, 70], ["UCOM-505", 40, 70]]);
  assert.equal(reg.paper("UCOM-501").grace.marks, 1);
  const stored = reg.r.papers.map(compactPaper);
  const base = new Map([["S1", { sessionId: "base", runId: "r", digest: "d", batchKey: reg.r.batchKey, sumCredits: reg.r.sumCredits, publishedGPA: reg.r.publishedGPA, papers: stored }]]);
  const budget = supplementaryGrace({ basePapers: stored, postgraduate: false, attempt: 1 });
  assert.equal(budget.available, 4);
  const supp = grade(SUPP_COURSES, [["UCOM-502", 30, 38]], { gracePool: () => budget, policy: { ...POLICY.DEFAULT, expectFromCmf: false } });
  const merged = mergeSupplementary({ supp: supp.out, base, students: supp.students, reference: supp.reference }).results[0];
  assert.equal(merged.state, STUDENT_STATE.RESULT);
  assert.equal(merged.papers.find(p => p.paperCode === "UCOM-501").grace.marks, 1);
  assert.equal(merged.papers.find(p => p.paperCode === "UCOM-501").origin, "base");
  assert.equal(merged.papers.find(p => p.paperCode === "UCOM-502").grace.marks, 2);
  assert.equal(merged.papers.find(p => p.paperCode === "UCOM-502").origin, "supp");
  assert.equal(merged.grace.left, 2);
  assert.equal(merged.publishedGPA > 0, true);
});
