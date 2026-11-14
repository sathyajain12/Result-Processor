import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  buildCourseIndex, resolveCourse, resolveCourseLegacy, computePaper, computeStudent, POLICY, NP_ERROR
} from "../src/index.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures");

export function loadFixtures() {
  if (!existsSync(join(FIXTURES, "papers.json"))) return null;
  const read = n => JSON.parse(readFileSync(join(FIXTURES, `${n}.json`), "utf8"));
  return { reference: read("reference"), students: read("students"), papers: read("papers"), finalOutput: read("finalOutput") };
}

const norm = v => (v === undefined || v === "" ? null : v === NP_ERROR ? "#VALUE!" : v);
export const same = (a, b) => {
  a = norm(a); b = norm(b);
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-9;
  return a === b;
};

const ATTRS = ["cieMax", "eseMax", "weightageCategory", "passCategory", "calcType", "credits"];
const OUTPUTS = ["ciePct", "cieNP", "eseComptPct", "eseNP", "combPct", "combNP", "status"];

const push = (bag, k, v) => (bag[k] ||= []).push(v);

export function runGolden(fx) {
  const index = buildCourseIndex(fx.reference.courses);
  const computation = {};
  const resolution = { total: 0, sameCourse: 0, manualRows: 0, diffs: [] };
  const byStudent = new Map();

  for (const p of fx.papers) {
    const student = fx.students[p.regdNo];
    const legacy = resolveCourseLegacy(index, p.paperCode, student);
    const effective = Object.fromEntries(ATTRS.map(a => [a, p[a] ?? null]));
    const out = computePaper({ cie: p.cie, ese: p.ese, eseGraced: p.eseGraced }, legacy.course, fx.reference, POLICY.LEGACY, effective);

    for (const k of OUTPUTS) {
      if (!same(out[k], p[k])) push(computation, k, { regdNo: p.regdNo, paperCode: p.paperCode, got: out[k], expected: p[k] });
    }

    const manual = p.manual.filter(m => ATTRS.includes(m));
    resolution.total++;
    if (manual.length) resolution.manualRows++;
    else {
      const precise = resolveCourse(index, p.paperCode, student);
      const differs = ATTRS.filter(a => !same(precise.course?.[a] ?? null, p[a]));
      if (differs.length) {
        resolution.diffs.push({
          regdNo: p.regdNo, paperCode: p.paperCode, studentProgramme: student?.programme, studentSemester: student?.semester,
          sheetCourse: legacy.course?.code ?? null, engineCourse: precise.course?.code ?? null, method: precise.method,
          fields: Object.fromEntries(differs.map(a => [a, { sheet: p[a], engine: precise.course?.[a] ?? null }]))
        });
      } else resolution.sameCourse++;
    }

    if (!byStudent.has(p.regdNo)) byStudent.set(p.regdNo, []);
    byStudent.get(p.regdNo).push({ paperCode: p.paperCode, result: out });
  }

  const students = {};
  let compared = 0, withheld = 0;
  for (const fo of fx.finalOutput) {
    if (fo.withheld === "WITHHELD") { withheld++; continue; }
    const s = computeStudent(fx.students[fo.regdNo], byStudent.get(fo.regdNo) || [], fx.reference);
    compared++;
    const checks = {
      sumCredits: [s.sumCredits, fo.sumCredits],
      sumCreditNP: [s.sumCreditNP, fo.sumCreditNP],
      calculatedGPA: [s.calculatedGPA, fo.calculatedGPA],
      publishedGPA: [s.publishedGPA, fo.publishedGPA],
      letterGrade: [s.letterGrade, fo.letterGrade],
      qualifier: [s.qualifier, fo.qa],
      isAbsent: [s.isAbsent, fo.isAbsent],
      failedCourses: [s.failedCourses.join(", "), fo.failedCourses]
    };
    for (const [k, [got, exp]] of Object.entries(checks)) {
      if (!same(got, exp)) push(students, k, { regdNo: fo.regdNo, got, expected: exp });
    }
  }

  return { papers: fx.papers.length, computation, resolution, compared, withheld, students };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const fx = loadFixtures();
  if (!fx) { console.log("No fixtures"); process.exit(0); }
  const r = runGolden(fx);
  const dump = (title, bag) => {
    const keys = Object.keys(bag);
    console.log(`${title}: ${keys.length ? keys.map(k => `${k}=${bag[k].length}`).join(", ") : "0 differences"}`);
    for (const k of keys) for (const d of bag[k].slice(0, 4)) console.log("   ", k, JSON.stringify(d));
  };
  console.log(`Paper rows: ${r.papers}`);
  dump("Computation differences", r.computation);
  console.log(`Students compared: ${r.compared} (withheld skipped: ${r.withheld})`);
  dump("Student differences", r.students);
  const res = r.resolution;
  console.log(`Course resolution: ${res.sameCourse} same, ${res.diffs.length} different, ${res.manualRows} rows with hand-typed course values`);
  const grouped = {};
  for (const d of res.diffs) (grouped[`${d.paperCode} | ${d.studentProgramme} ${d.studentSemester} | sheet=${d.sheetCourse} engine=${d.engineCourse} (${d.method})`] ||= []).push(d);
  for (const [k, v] of Object.entries(grouped)) console.log(`    ${v.length}× ${k} ${JSON.stringify(v[0].fields)}`);
}
