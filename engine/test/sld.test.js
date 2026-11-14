import { test } from "node:test";
import assert from "node:assert/strict";
import { processSession, compactPaper, registerEntry, sldOverrides, isSldCode, POLICY, EXCEPTION } from "../src/index.js";

const IA = [{ ll: 0, np: "Fails" }, { ll: 40, np: 4 }, { ll: 45, np: 5 }, { ll: 55, np: 6 }, { ll: 65, np: 7 }, { ll: 75, np: 8 }, { ll: 85, np: 9 }, { ll: 95, np: 9.5 }, { ll: 100, np: 10 }];
const COURSE = { code: "UELL-501", title: "Literature", programmes: "BAH", semester: "V", category: "DSC", credits: 4, cieMax: 50, eseMax: 100,
  cieWeight: 0.5, eseWeight: 0.5, calcType: 2, courseType: "Theory", cieNP: "I-A", eseNP: "I-A", combNP: "I-A", passCategory: 1, weightageCategory: 1, batches: [] };
const reference = {
  courses: [COURSE], npTables: { "I-A": IA }, weightage: { 1: { cie: 0.5, ese: 0.5 } },
  gradeTables: { "II-B": [{ ll: 0, ul: 3.9, lg: "F", qa: "Fail" }, { ll: 4, ul: 10, lg: "P", qa: "Pass" }] }, programmes: { BAH: { gradeTable: "II-B", passCategory: 1 } }
};
const student = { regdNo: "S1", name: "S1", programme: "BAH", semester: "V", batch: "", semCredits: null };
// The SLD sheet, out of 60, as Mark sheets stores it: its course code, component, maximum and "<regd>|<paper>" keys.
const SHEET = { courseCode: "UELL-501_SLD", component: "ESE", maxMarks: 60, keys: ["S1|UELL-501"] };

function grade(ese, overrides = sldOverrides([SHEET])) {
  const out = processSession({
    reference, students: { S1: student }, policy: POLICY.DEFAULT, overrides,
    cie: [{ regdNo: "S1", paperCode: "UELL-501", raw: 40 }], ese: [{ regdNo: "S1", paperCode: "UELL-501", raw: ese }]
  });
  return { out, paper: out.results[0].papers[0], r: out.results[0] };
}

test("SLD: sheet names ending in SLD, with _ - or a space", () => {
  assert.deepEqual(["UPOL-101_SLD", "UELL-502-SLD", "UECO-301 SLD", "uell-501_sld ", "UPOL-101", "UPOL-101_SLDX", "SLDUPOL-101"].map(isSldCode),
    [true, true, true, true, false, false, false]);
});

test("SLD: each SLD sheet sets that student's maximum for the paper", () => {
  const o = sldOverrides([SHEET, { courseCode: "UPOL-101", component: "ESE", maxMarks: 100, keys: ["S2|UPOL-101"] },
    { courseCode: "UPOL-301_SLD", component: "ESE", maxMarks: null, keys: ["S3|UPOL-301"] }]);
  assert.deepEqual(o.map(x => [x.regdNo, x.paperCode, x.field, x.value]), [["S1", "UELL-501", "eseMax", 60], ["S1", "UELL-501", "sldEseMax", 60]]);
  assert.equal(o[0].type, "course-field");
});

test("SLD: 37 out of 60 is graded as 62%, not 37%, and needs no grace", () => {
  const { paper, out } = grade(37);
  assert.equal(paper.result.eseComptPct, 62);
  assert.equal(paper.result.combPct, 71);   // CIE 40/50 = 80%: 80 x 0.5 + 62 x 0.5
  assert.equal(paper.result.status, "Pass");
  assert.equal(paper.grace, undefined);
  assert.equal(out.exceptions.filter(e => e.code === EXCEPTION.GRACE_APPLIED).length, 0);
  // Without the SLD sheet the same mark is 37% and fails ESE.
  assert.equal(grade(37, []).paper.result.eseComptPct, 37);
});

test("SLD: the Grade register keeps the mark as entered and says it is SLD", () => {
  const { r } = grade(37);
  const e = registerEntry({ student, result: r, papers: r.papers.map(compactPaper), courses: new Map([[COURSE.code, COURSE]]) });
  assert.deepEqual([e.rows[0].eseMarks, e.rows[0].esePct, e.rows[0].remarks], [37, 62, "SLD (ESE out of 60)"]);
});

test("SLD: a mark above the SLD maximum warns against that maximum", () => {
  const { out } = grade(55);
  const above = out.exceptions.filter(e => e.code === EXCEPTION.MARK_ABOVE_MAX);
  assert.equal(above.length, 0);   // 55 is within 60
  const { out: out2 } = grade(65);
  assert.match(out2.exceptions.find(e => e.code === EXCEPTION.MARK_ABOVE_MAX).message, /above the student's maximum 60/);
});

test("SLD: an edit on the student page wins over the SLD sheet", () => {
  const edit = { type: "course-field", regdNo: "S1", paperCode: "UELL-501", field: "eseMax", value: 75, reason: "checked" };
  assert.equal(grade(37, [...sldOverrides([SHEET]), edit]).paper.result.eseComptPct, 49);   // 37 / 75
});
