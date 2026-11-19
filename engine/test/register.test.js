import { test } from "node:test";
import assert from "node:assert/strict";
import { processSession, compactPaper, registerEntry, searchTerms, nonCreditCourses, seriatimOrder, POLICY } from "../src/index.js";

const IB = [{ ll: 0, np: "Fails" }, { ll: 50, np: 5 }, { ll: 55, np: 6 }, { ll: 65, np: 7 }, { ll: 75, np: 8 }, { ll: 85, np: 9 }, { ll: 95, np: 9.5 }, { ll: 100, np: 10 }];
const base = { programmes: "MTECH-CS", semester: "III", cieNP: "I-B", eseNP: "I-B", combNP: "I-B", passCategory: 3, weightageCategory: 1, batches: ["2025"] };
const COURSES = [
  { ...base, code: "MAWR-300", title: "Awareness Course-III: Work Culture, Ethics and Values", category: "VBC", courseType: "Theory", sequence: "6", credits: 1, cieMax: 50, eseMax: 0, cieWeight: 1, eseWeight: 0, calcType: 3 },
  { ...base, code: "MTCS-302", title: "Problem-Solving Lab", category: "SEC", courseType: "Practicals", sequence: "5", credits: 2, cieMax: 50, eseMax: 0, cieWeight: 1, eseWeight: 0, calcType: 3 },
  { ...base, code: "MTCS-301(noc26_cs144)", title: "Elective-IV: Cyber Security and Privacy", category: "DSE", courseType: "Theory", sequence: "3", credits: 4, cieMax: 25, eseMax: 100, cieWeight: 0.25, eseWeight: 0.75, calcType: 2 },
  { ...base, code: "MTCS-401", title: "Project Work (Interim Review)", category: "--", courseType: "--", sequence: "9", credits: 0, cieMax: 0, eseMax: 0, calcType: 5 }
];
const reference = {
  courses: COURSES, npTables: { "I-B": IB }, weightage: {},
  gradeTables: { "II-A": [{ ll: 0, ul: 7.9, lg: "A+", qa: "Very Good" }, { ll: 8, ul: 8.9, lg: "O", qa: "Distinction" }, { ll: 9, ul: 10, lg: "O+", qa: "Outstanding" }] },
  programmes: { "MTECH-CS": { gradeTable: "II-A", passCategory: 3 } }
};
const student = { regdNo: "S1", name: "S1", campus: "PSN", programme: "MTECH-CS", semester: "III", batch: "2025", semCredits: null };
const metaOf = courses => new Map(courses.map(c => [c.code, c]));

function entry(rows, courses = COURSES, ref = reference, overrides = []) {
  const out = processSession({
    reference: { ...ref, courses }, students: { S1: student }, policy: { ...POLICY.DEFAULT, expectFromCmf: false }, overrides,
    cie: rows.filter(r => r[1] !== null).map(([paperCode, raw]) => ({ regdNo: "S1", paperCode, raw })),
    ese: rows.filter(r => r[2] !== null).map(([paperCode, , raw]) => ({ regdNo: "S1", paperCode, raw }))
  });
  const r = out.results[0];
  return registerEntry({ student, result: r, papers: r.papers.map(compactPaper), courses: metaOf(courses), nonCredit: nonCreditCourses(student, "2025", courses), weightage: ref.weightage, grace: r.grace });
}

const IMAGE = [["MAWR-300", 41, null], ["MTCS-302", 49, null], ["MTCS-301(noc26_cs144)", 22, 81]];

test("the register in the image: every column, in Sequence order, with the summary", () => {
  const e = entry(IMAGE);
  assert.deepEqual(e.rows.map(r => r.courseCode), ["MTCS-301(noc26_cs144)", "MTCS-302", "MAWR-300", "MTCS-401"]);
  assert.deepEqual(e.rows.map(r => r.sno), [1, 2, 3, 4]);
  const [elective, lab, awareness, project] = e.rows;
  assert.deepEqual(elective, { sno: 1, courseCode: "MTCS-301(noc26_cs144)", title: "Elective-IV: Cyber Security and Privacy", type: "Theory", category: "DSE", credits: 4,
    weightage: "25/75", cieMarks: 22, eseMarks: 81, ciePct: 88, esePct: 81, combPct: 83, cieNp: 9, eseNp: 8, combNp: 8, earnedCred: 4, earnedPoints: 32, failed: false, remarks: null });
  assert.deepEqual([lab.type, lab.category, lab.cieMarks, lab.eseMarks, lab.ciePct, lab.esePct, lab.combPct, lab.cieNp, lab.eseNp, lab.combNp, lab.earnedCred, lab.earnedPoints],
    ["Practicals", "SEC", 49, null, 98, null, 98, 9.5, "--", 9.5, 2, 19]);
  assert.deepEqual([awareness.ciePct, awareness.combNp, awareness.earnedCred, awareness.earnedPoints], [82, 8, 1, 8]);
  assert.deepEqual(project, { sno: 4, courseCode: "MTCS-401", title: "Project Work (Interim Review)", type: "--", category: null, credits: 0,
    weightage: null, cieMarks: null, eseMarks: null, ciePct: null, esePct: null, combPct: null, cieNp: null, eseNp: null, combNp: null, earnedCred: null, earnedPoints: null, failed: false, remarks: null });
  assert.deepEqual(e.summary, { sumEarnedCred: 7, sumEarnedPoints: 59, semesterGpa: 8.4, letterGrade: "O", qualGrade: "Distinction" });
});

test("a mark for a component the course does not have is not printed (MTOC-108: the viva entered in both sheets)", () => {
  const viva = { ...base, code: "MTOC-108", title: "Semester End Viva voce", category: "NA", courseType: "--", sequence: "8", credits: 1, cieMax: 0, eseMax: 50, cieWeight: 0, eseWeight: 1, calcType: 4 };
  const courses = [...COURSES, viva];
  const e = entry([...IMAGE.filter(r => r[0] !== "MTCS-302"), ["MTCS-302", 49, 30], ["MTOC-108", 28, 28]], courses);
  const row = code => e.rows.find(r => r.courseCode === code);
  const v = row("MTOC-108");
  assert.deepEqual([v.cieMarks, v.eseMarks, v.ciePct, v.esePct, v.combPct, v.combNp], [null, 28, null, 56, 56, 6]);
  const lab = row("MTCS-302");   // CIE only: a stray ESE mark is not printed either
  assert.deepEqual([lab.cieMarks, lab.eseMarks, lab.combPct], [49, null, 98]);
  assert.equal(row("MTCS-301(noc26_cs144)").cieMarks, 22);   // a course with both keeps both
});

test("Weightage: the CIE/ESE split each paper was graded with", () => {
  const [elective, lab, awareness, project] = entry(IMAGE).rows;
  assert.deepEqual([elective.weightage, lab.weightage, awareness.weightage, project.weightage], ["25/75", "100/0", "100/0", null]);
});

test("Weightage: a per-student edit of the weights is what shows", () => {
  const edit = (field, value) => ({ type: "course-field", regdNo: "S1", paperCode: "MTCS-301(noc26_cs144)", field, value, reason: "test" });
  const e = entry(IMAGE, COURSES, reference, [edit("cieWeight", 0.5), edit("eseWeight", 0.5)]);
  assert.equal(e.rows[0].weightage, "50/50");
  assert.equal(e.rows[0].combPct, 85);   // graded with the edited weights: 88 * 0.5 + 81 * 0.5 = 84.5; at 25/75 it is 83
  const asText = entry(IMAGE, COURSES, reference, [edit("cieWeight", "0.5"), edit("eseWeight", "0.5")]);
  assert.equal(asText.rows[0].weightage, "50/50");
});

test("Weightage: a course with no WTG of its own shows its weightage category", () => {
  const plain = COURSES.map(c => (c.code === "MTCS-301(noc26_cs144)" ? { ...c, cieWeight: null, eseWeight: null, weightageCategory: 2 } : c));
  const e = entry(IMAGE, plain, { ...reference, weightage: { 2: { cie: 1 / 3, ese: 2 / 3 } } });
  assert.equal(e.rows[0].weightage, "33.33/66.67");
});

test("Weightage: none known gives an empty cell", () => {
  const e = registerEntry({ student, result: {}, papers: [{ paperCode: "X-1", courseCode: "X-1", course: { cieWeight: null, eseWeight: null, weightageCategory: 9 }, status: "Pass", credits: 2 }], courses: new Map() });
  assert.equal(e.rows[0].weightage, null);
});

test("a failed paper earns nothing, and the GPA says Fail", () => {
  const e = entry([["MAWR-300", 41, null], ["MTCS-302", 49, null], ["MTCS-301(noc26_cs144)", 22, 30]]);
  const failed = e.rows[0];
  assert.deepEqual([failed.credits, failed.earnedCred, failed.earnedPoints, failed.failed, failed.remarks], [4, 0, 0, true, "Failed"]);
  assert.deepEqual(e.summary, { sumEarnedCred: 3, sumEarnedPoints: 27, semesterGpa: "Fail", letterGrade: null, qualGrade: null });
});

test("an absent paper shows Ab and earns nothing", () => {
  const e = entry([["MAWR-300", 41, null], ["MTCS-302", 49, null], ["MTCS-301(noc26_cs144)", 22, "A"]]);
  const a = e.rows[0];
  assert.deepEqual([a.eseMarks, a.esePct, a.combPct, a.combNp, a.earnedCred, a.remarks], ["Ab", null, null, "Ab", 0, "Absent"]);
  assert.equal(e.summary.semesterGpa, "Absent");
});

test("a graced paper shows the graced ESE marks and says so", () => {
  const courses = COURSES.map(c => (c.code === "MTCS-301(noc26_cs144)" ? { ...c, eseMax: 100, cieMax: 100, cieWeight: 0.5, eseWeight: 0.5 } : c));
  const e = entry([["MAWR-300", 41, null], ["MTCS-302", 49, null], ["MTCS-301(noc26_cs144)", 60, 49]], courses);
  const g = e.rows[0];
  assert.deepEqual([g.eseMarks, g.esePct, g.earnedCred, g.remarks, g.graced], [50, 50, 4, "Graced +1 (ESE)", true]);
});

test("a graced student's register lists the grace: the paper, what was raised and the pool", () => {
  const courses = COURSES.map(c => (c.code === "MTCS-301(noc26_cs144)" ? { ...c, eseMax: 100, cieMax: 100, cieWeight: 0.5, eseWeight: 0.5 } : c));
  const e = entry([["MAWR-300", 41, null], ["MTCS-302", 49, null], ["MTCS-301(noc26_cs144)", 60, 49]], courses);
  assert.deepEqual(e.gracing, {
    pool: 1, available: 1, used: 1, left: 0, attempt: null, terminal: null, usedBefore: null,
    papers: [{ courseCode: "MTCS-301(noc26_cs144)", title: "Elective-IV: Cyber Security and Privacy", kind: "ESE", marks: 1, exactMarks: 1, points: 1, passPct: 50, shortPct: 49, eseMax: 100,
      eseFrom: 49, eseTo: 50, esePctFrom: 49, esePctTo: 50, combPctFrom: 54.5, combPctTo: 55, combNp: 6 }],
    notGraced: []
  });
});

test("a student with no grace has no gracing section", () => {
  assert.equal(entry([["MAWR-300", 41, null], ["MTCS-302", 49, null], ["MTCS-301(noc26_cs144)", 22, 80]]).gracing, null);
});

test("a failed paper the pool could not cover says so", () => {
  const courses = COURSES.map(c => (c.code === "MTCS-301(noc26_cs144)" ? { ...c, eseMax: 100, cieMax: 100, cieWeight: 0.5, eseWeight: 0.5 } : c));
  const out = processSession({
    reference: { ...reference, courses }, students: { S1: student }, policy: { ...POLICY.DEFAULT, expectFromCmf: false }, overrides: [],
    cie: [["MAWR-300", 41], ["MTCS-302", 49], ["MTCS-301(noc26_cs144)", 60]].map(([paperCode, raw]) => ({ regdNo: "S1", paperCode, raw })),
    ese: [{ regdNo: "S1", paperCode: "MTCS-301(noc26_cs144)", raw: 47 }]
  });
  const r = out.results[0];
  const refused = out.exceptions.filter(x => x.code === "GRACE_NOT_AVAILABLE").map(x => ({ paperCode: x.paperCode, needed: x.details.needed, left: x.details.left }));
  assert.equal(refused.length, 1);
  const e = registerEntry({ student, result: r, papers: r.papers.map(compactPaper), courses: metaOf(courses), weightage: {}, grace: r.grace, refused });
  assert.equal(e.rows.find(x => x.courseCode === "MTCS-301(noc26_cs144)").remarks, "Not graced: pool short, Failed");
  assert.deepEqual(e.gracing.notGraced, [{ courseCode: "MTCS-301(noc26_cs144)", needed: 3, left: 1 }]);
  assert.deepEqual(e.gracing.papers, []);
});

test("a paper that has marks is not listed again as a non-credit row", () => {
  const courses = COURSES.map(c => (c.code === "MTCS-401" ? { ...c, cieMax: 0, eseMax: 0 } : c));
  const e = entry([...IMAGE, ["MTCS-401", 5, null]], courses);
  assert.equal(e.rows.filter(r => r.courseCode === "MTCS-401").length, 1);
});

test("non-credit courses match the student's programme, semester, batch and chosen electives", () => {
  const c = { programmes: "MTECH-CS", semester: "III", batches: ["2025"], cieMax: 0, eseMax: 0, code: "X", category: "--" };
  const of = (over, s = student, batch = "2025") => nonCreditCourses(s, batch, [{ ...c, ...over }]).length;
  assert.equal(of({}), 1);
  assert.equal(of({ programmes: "MSC-M" }), 0);
  assert.equal(of({ semester: "IV" }), 0);
  assert.equal(of({ batches: ["2024"] }), 0);
  assert.equal(of({ cieMax: 50 }), 0);
  assert.equal(of({ category: "DSE" }), 0);
  assert.equal(of({ category: "DSE" }, { ...student, electives: ["X"] }), 1);
  assert.equal(of({ teachingDept: "SWAYAM NC" }), 0);
});

test("searching for several students at once", () => {
  assert.deepEqual(searchTerms("25010103001"), ["25010103001"]);
  assert.deepEqual(searchTerms("25010103001 25010202001"), ["25010103001", "25010202001"]);
  assert.deepEqual(searchTerms(" 25010103001,  25010202001 ;234521\n"), ["25010103001", "25010202001", "234521"]);
  assert.deepEqual(searchTerms("Arthi S"), ["Arthi S"]);
  assert.deepEqual(searchTerms("Arthi S, Abhishek Paswan"), ["Arthi S", "Abhishek Paswan"]);
  assert.deepEqual(searchTerms("Arthi S, 25010103001 25010202001"), ["Arthi S", "25010103001", "25010202001"]);
  assert.deepEqual(searchTerms("234521, 234521"), ["234521"]);
  assert.deepEqual(searchTerms(" , "), []);
  assert.equal(searchTerms(Array.from({ length: 30 }, (_, i) => i + 1).join(",")).length, 20);
});

test("seriatim: Sequence first, then natural course code, blanks last", () => {
  const list = [{ sequence: null, code: "A-1" }, { sequence: "4", code: "UCHM-203" }, { sequence: "3", code: "UPHY-10" }, { sequence: "3", code: "UPHY-2" }, { sequence: "", code: "A-0" }];
  assert.deepEqual(list.sort(seriatimOrder).map(x => x.code), ["UPHY-2", "UPHY-10", "UCHM-203", "A-0", "A-1"]);
});
