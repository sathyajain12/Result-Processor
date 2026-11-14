import { writeFileSync } from "node:fs";
import * as E from "../engine/src/index.js";
import { loadFixtures } from "../engine/test/golden.js";

const fx = loadFixtures();
const isBed = c => /(^|\/)BED($|\/)/.test(c?.programmes || "");
const idx = E.buildCourseIndex(fx.reference.courses);
const by = {};

for (const p of fx.papers) {
  const st = fx.students[p.regdNo];
  const { course } = E.resolveCourseLegacy(idx, p.paperCode, st);
  const eff = { cieMax: p.cieMax, eseMax: p.eseMax, weightageCategory: p.weightageCategory, passCategory: p.passCategory, calcType: p.calcType, credits: p.credits };
  const a = E.computePaper(p, course, fx.reference, E.POLICY.LEGACY, eff);
  const fix = isBed(course) && p.calcType === 2;
  const b = fix ? E.computePaper(p, course, fx.reference, E.POLICY.LEGACY, { ...eff, cieWeight: 0.3, eseWeight: 0.7 }) : a;
  const s = (by[p.regdNo] ||= { a: [], b: [], changes: [], bed: false });
  s.a.push({ paperCode: p.paperCode, result: a });
  s.b.push({ paperCode: p.paperCode, result: b });
  if (isBed(course)) s.bed = true;
  if (a.combNP !== b.combNP || a.combPct !== b.combPct) s.changes.push(`${p.paperCode}: ${a.combPct}%/${a.combNP} → ${b.combPct}%/${b.combNP}`);
}

const rows = [["Regd No", "Name", "Programme", "Semester", "Campus", "Published GPA", "Letter Grade", "QA", "Corrected GPA", "Corrected Grade", "Corrected QA", "Grade Changed", "Papers changed (COMB% / NP)"]];
for (const [regdNo, v] of Object.entries(by)) {
  if (!v.bed) continue;
  const st = fx.students[regdNo];
  const A = E.computeStudent(st, v.a, fx.reference), B = E.computeStudent(st, v.b, fx.reference);
  if (A.publishedGPA === B.publishedGPA && A.letterGrade === B.letterGrade) continue;
  rows.push([regdNo, st.name, st.programme, st.semester, st.campus, A.publishedGPA, A.letterGrade, A.qualifier, B.publishedGPA, B.letterGrade, B.qualifier, A.letterGrade !== B.letterGrade ? "YES" : "", v.changes.join("; ")]);
}
writeFileSync(process.argv[2], JSON.stringify(rows));
console.log(`${rows.length - 1} students`);
