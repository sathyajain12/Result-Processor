import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { courseGroup } from "../engine/src/index.js";

const fx = n => JSON.parse(readFileSync(new URL(`../fixtures/${n}.json`, import.meta.url)));
const reference = fx("reference"), students = fx("students"), papers = fx("papers");
const out = process.argv[2];
mkdirSync(out, { recursive: true });

const SUFFIX = /^(.*?)(?:-(Arts|Science))?-Sem-([IVX]+)-(.*)$/;
const cmf = [["Programme Code", "Semester", "Course Code", "Course Title", "Course Category", "Credits", "CIE Max", "ESE Max", "Exam Type", "Teaching Department", "CIE WTG", "ESE WTG"]];
for (const c of reference.courses) {
  const m = c.code.match(SUFFIX);
  const base = m ? m[1] : c.code;
  const category = m ? m[4] : (c.category ?? "DSC");
  const bed = /(^|\/)BED($|\/)/.test(c.programmes || "");
  const [cw, ew] = c.calcType === 2 ? (bed ? [30, 70] : [50, 50]) : c.calcType === 3 || c.calcType === 1 ? [100, 0] : c.calcType === 4 ? [0, 100] : ["", ""];
  const row = [c.programmes, c.semester, base, c.title, category, c.credits, c.cieMax ?? "", c.eseMax ?? "", c.calcType ?? "", "", cw, ew];
  cmf.push(row);
  if (m) cmf.push(row);
}

const smf = [["Sl. No.", "Campus", "Regd. No.", "Semester", "Name", "Programme Code", "Batch"]];
let i = 0;
for (const s of Object.values(students)) smf.push([++i, s.campus, s.regdNo, s.semester, s.name, s.programme, ""]);

const cie = [["Regd. No.", "Paper Code", "CIE Marks", "Programme", "Semester"]];
const ese = [["Regd. No.", "Paper Code", "ESE Marks", "Programme", "Semester"]];
for (const p of papers) {
  const s = students[p.regdNo] || {};
  if (p.cie !== null && p.cie !== undefined) cie.push([p.regdNo, p.paperCode, p.cie, s.programme, s.semester]);
  else if (p.calcType !== 4) cie.push([p.regdNo, p.paperCode, "", s.programme, s.semester]);
  if (p.ese !== null && p.ese !== undefined) ese.push([p.regdNo, p.paperCode, p.ese, s.programme, s.semester]);
}

for (const [k, v] of Object.entries({ CMF: cmf, SMF: smf, CIE: cie, ESE: ese })) {
  writeFileSync(`${out}/${k}.json`, JSON.stringify({ kind: k, values: v }));
  console.log(k, v.length - 1, "rows");
}
