// Invented demo data for walking through the processor. Writes Excel files to demo/:
//   1-regular/        CMF, SMF, PREV, CIE, ESE for "Demo April 2026 · ESE Regular" (110 students, 3 programmes)
//   2-corrections/    corrected CIE, ESE and SMF that clear the planted problems
//   3-supplementary/  CMF, SMF, CIE, ESE for the supplementary of the corrected regular result
// Usage (from the repo root): node tools/make_demo_data.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(new URL("../app/package.json", import.meta.url));
const XLSX = require("xlsx");
const OUT = new URL("../demo/", import.meta.url);

// Deterministic pseudo-random numbers so the demo is the same every time.
let seed = 20260422;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const between = (lo, hi) => lo + rand() * (hi - lo);

const PROGRAMMES = [
  { code: "BSH-M", semester: "II", campus: "PSN", prefix: 2421, count: 45, courses: [
    ["TMAT-201", "Real Analysis", "DSC", 4, "Mathematics"], ["TMAT-202", "Linear Algebra", "DSC", 4, "Mathematics"],
    ["TPHY-203", "Mechanics", "DSC", 4, "Physics"], ["TCSC-204", "Programming in Python", "DSC", 4, "Computer Science"],
    ["TENG-205", "English Communication", "AEC", 2, "English"], ["TVAL-206", "Awareness Course", "VBC", 2, "Value Education"]] },
  { code: "BCOMH", semester: "IV", campus: "BLR", prefix: 2341, count: 40, courses: [
    ["UCOM-401", "Corporate Accounting", "DSC", 4, "Commerce"], ["UCOM-402", "Cost Accounting", "DSC", 4, "Commerce"],
    ["UCOM-403", "Business Law", "DSC", 4, "Commerce"], ["UECO-404", "Indian Economy", "DSC", 4, "Economics"],
    ["UENG-405", "Business English", "AEC", 2, "English"]] },
  { code: "MSC-P", semester: "II", campus: "PSN", prefix: 2522, count: 25, courses: [
    ["PPHY-201", "Quantum Mechanics", "DSC", 4, "Physics"], ["PPHY-202", "Electrodynamics", "DSC", 4, "Physics"],
    ["PPHY-203", "Statistical Mechanics", "DSC", 4, "Physics"], ["PPHY-204", "Advanced Physics Lab", "DSC", 4, "Physics"]] }
];

const FIRST = ["Aarav", "Ananya", "Arjun", "Bhavana", "Chaitanya", "Deepa", "Eshwar", "Gayathri", "Harish", "Ishita", "Jayant", "Kavya", "Lakshmi", "Manoj",
  "Meera", "Nikhil", "Pooja", "Pranav", "Rahul", "Revathi", "Sai Kiran", "Sandhya", "Srinivas", "Swathi", "Tejas", "Uma", "Varun", "Vidya", "Yamini", "Kiran"];
const LAST = ["Rao", "Reddy", "Iyer", "Nair", "Sharma", "Kulkarni", "Menon", "Naidu", "Pillai", "Hegde", "Joshi", "Patil", "Varma", "Shetty", "Prasad"];

// Planted fails (ESE well below 40%) and absences. Everything else scores 55%+ so nobody fails by accident.
const FAILS = { "2421004": ["TMAT-201"], "2421011": ["TPHY-203"], "2421019": ["TMAT-202", "TCSC-204"], "2421030": ["TMAT-201"],
  "2341006": ["UCOM-402"], "2341021": ["UCOM-401"], "2341033": ["UECO-404"], "2522008": ["PPHY-201"], "2522017": ["PPHY-203"] };
const ABSENT = { "2421025": "TPHY-203", "2341014": "UCOM-403" };

const header = {
  CMF: ["Programme Code", "Semester", "Course Code", "Course Title", "Course Category", "Credits", "CIE Max", "ESE Max", "Exam Type", "Teaching Department", "CIE WTG", "ESE WTG", "Batch"],
  SMF: ["Sl. No.", "Campus", "Regd. No.", "Semester", "Name", "Programme Code", "Batch", "Sem-Credits"],
  CIE: ["Regd. No.", "Paper Code", "CIE Marks", "Programme", "Semester"],
  ESE: ["Regd. No.", "Paper Code", "ESE Marks", "Programme", "Semester"]
};

const cmf = [header.CMF];
const smf = [header.SMF];
const cie = [header.CIE];
const ese = [header.ESE];
const prev = [["Regd. No.", "S01_EARNEDCREDS", "S01_EARNEDCRXNP", "S01_GPA", "S02_EARNEDCREDS", "S02_EARNEDCRXNP", "S02_GPA", "S03_EARNEDCREDS", "S03_EARNEDCRXNP", "S03_GPA"]];
const names = {};

for (const p of PROGRAMMES) {
  for (const [code, title, cat, credits, dept] of p.courses) cmf.push([p.code, p.semester, code, title, cat, credits, 50, 100, 2, dept, 50, 50, ""]);
  const semCredits = p.courses.reduce((n, c) => n + c[3], 0);
  const priorSems = { II: 1, IV: 3 }[p.semester];
  for (let i = 1; i <= p.count; i++) {
    const regd = String(p.prefix * 1000 + i);
    const name = `${FIRST[Math.floor(rand() * FIRST.length)]} ${LAST[Math.floor(rand() * LAST.length)]}`;
    names[regd] = name;
    smf.push([smf.length, p.campus, regd, p.semester, name, p.code, "", semCredits]);
    const ability = between(0.6, 0.93);
    for (const [code] of p.courses) {
      const cieMark = Math.round(50 * Math.min(0.98, ability + between(-0.05, 0.05)));
      let eseMark = Math.round(100 * Math.min(0.98, ability + between(-0.05, 0.04)));
      if (FAILS[regd]?.includes(code)) eseMark = Math.round(between(18, 30));
      cie.push([regd, code, cieMark, p.code, p.semester]);
      ese.push([regd, code, ABSENT[regd] === code ? "A" : eseMark, p.code, p.semester]);
    }
    // Earlier semesters for CGPA: 20 credits each at about this student's level.
    const row = [regd];
    for (let s = 1; s <= 3; s++) {
      if (s > priorSems) { row.push("", "", ""); continue; }
      const gpa = Math.round(Math.min(9.6, ability * 10 + between(-0.6, 0.4)) * 10) / 10;
      row.push(20, Math.round(gpa * 20), gpa);
    }
    prev.push(row);
  }
}

// ---- Planted problems in the first upload ----
const at = (rows, regd, code) => rows.find(r => r[0] === regd && r[1] === code);
const cieV1 = cie.map(r => [...r]), eseV1 = ese.map(r => [...r]), smfV1 = smf.map(r => [...r]);
at(eseV1, "2421007", "TMAT-202")[2] = "";                    // ESE mark not entered yet -> held (Mark not received)
at(eseV1, "2341012", "UCOM-402")[2] = 112;                   // above the 100 maximum -> warning (Rule 3B), graded as given
at(cieV1, "2341027", "UCOM-403")[1] = "UCOM-4O3";            // letter O typed for zero -> Paper not in course master
smfV1.find(r => r[2] === "2421015")[7] = 22;                 // SMF says 22 credits, papers add up to 20 -> Withheld
eseV1.push(["2421099", "TMAT-201", 64, "BSH-M", "II"]);      // marks for someone not in the SMF (left the programme)
at(cieV1, "2421040", "TENG-205")[2] = 0;                     // a zero CIE mark -> "check" warning only
// One BCOMH student has no Sem II record, so their CGPA is withheld (a warning-free example of CGPA rules).
const p2 = prev.find(r => r[0] === "2341018"); p2[4] = p2[5] = p2[6] = "";

// ---- Supplementary: everyone with a fail or absence re-appears for those papers ----
const suppPapers = [...Object.entries(FAILS).flatMap(([regd, codes]) => codes.map(c => [regd, c])), ...Object.entries(ABSENT)];
const suppCie = [header.CIE], suppEse = [header.ESE], suppSmf = [header.SMF];
const progOf = regd => PROGRAMMES.find(p => regd.startsWith(String(p.prefix)));
for (const [regd, code] of suppPapers) {
  const p = progOf(regd);
  const failsAgain = regd === "2421019" && code === "TCSC-204";  // one paper failed again
  suppCie.push([regd, code, Math.round(between(30, 40)), p.code, p.semester]);
  suppEse.push([regd, code, failsAgain ? 31 : Math.round(between(55, 78)), p.code, p.semester]);
}
for (const regd of [...new Set(suppPapers.map(([r]) => r))]) {
  const p = progOf(regd);
  suppSmf.push([suppSmf.length, p.campus, regd, p.semester, names[regd], p.code, "", p.courses.reduce((n, c) => n + c[3], 0)]);
}

function write(dir, files) {
  const path = new URL(`${dir}/`, OUT);
  mkdirSync(path, { recursive: true });
  for (const [name, rows] of Object.entries(files)) {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
    writeFileSync(new URL(`${name}.xlsx`, path), XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
  }
  console.log(`${dir}: ${Object.keys(files).join(", ")}`);
}

write("1-regular", { CMF: cmf, SMF: smfV1, PREV: prev, CIE: cieV1, ESE: eseV1 });
write("2-corrections", { CIE: cie, ESE: ese, SMF: smf });
write("3-supplementary", { CMF: cmf, SMF: suppSmf, CIE: suppCie, ESE: suppEse });
