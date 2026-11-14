import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCMF, parseSMF, parseMarks, parsePrevious, programmeDefaults, normalizeRegdNo, normalizeSemester } from "../src/ingest.js";
import { loadFixtures } from "./golden.js";

const CMF_HEAD = ["Programme Code", "Semester", "Course Code", "Course Title", "Course Category", "Credits", "CIE Max", "ESE Max", "Exam Type", "Teaching Department", "CIE WTG", "ESE WTG", "Batch"];

test("CMF: duplicate codes get legacy suffixes, _ASSIGN adds credits, _IHA and SWAYAM NC handled", () => {
  const { courses, skipped } = parseCMF([
    CMF_HEAD,
    ["BSH-M/BSHR-M", "II", "UMAT-201", "Calculus", "DSC", 3, 70, 100, 2, "Maths", 50, 50, 2025],
    ["BSH-P/BSHR-P", "II", "UMAT-201", "Calculus", "IDM", 3, 70, 100, 2, "Maths", 50, 50, 2025],
    ["BCOMH/BCOMHR", "IV", "UCOM-401", "Accounts", "DSC", 3, 50, 50, 2, "Commerce", 50, 50, 2024],
    ["BCOMH/BCOMHR", "IV", "UCOM-401_ASSIGN", "Accounts assignment", "DSC", 1, 50, 0, 3, "Commerce", 100, 0, 2024],
    ["BED", "II", "BEDN-201_IHA", "Pedagogy", "DSC", 4, 30, 70, 2, "Education", 30, 70, 2025],
    ["BSH-C", "IV", "noc26_ch40", "NPTEL", "IDM", 3, "NC", 100, 4, "SWAYAM NC", "", "", 2024]
  ]);
  const codes = courses.map(c => c.code).sort();
  assert.deepEqual(codes, ["BEDN-201", "UCOM-401", "UMAT-201-Science-Sem-II-DSC", "UMAT-201-Science-Sem-II-IDM"]);
  assert.equal(courses.find(c => c.code === "UCOM-401").credits, 4);
  assert.equal(courses.find(c => c.code === "BEDN-201").cieWeight, 0.3);
  assert.deepEqual(courses.find(c => c.code === "UCOM-401").batches, ["2024"]);
  assert.equal(skipped.swayamNC, 1);
});

test("CMF: _IHA credits are added to the main paper, which keeps its own title and maximums", () => {
  const main = ["BBAH", "VII", "UBBA-703(imb26_mg236)", "Social Entrepreneurship", "IDM", 3, 25, 75, 2, "SWAYAM Portal-Exam", 25, 75, 2023];
  const iha = ["BBAH", "VII", "UBBA-703(imb26_mg236)_IHA", "Assignment: Social Entrepreneurship", "IDM", 1, 50, 0, 3, "SWAYAM Inhouse-Assignment", 100, 0, 2023];
  for (const rows of [[main, iha], [iha, main]]) {
    const { courses } = parseCMF([CMF_HEAD, ...rows]);
    assert.equal(courses.length, 1);
    assert.equal(courses[0].credits, 4);
    assert.equal(courses[0].title, "Social Entrepreneurship");
    assert.equal(courses[0].cieMax, 25);
    assert.equal(courses[0].eseMax, 75);
    assert.equal(courses[0].calcType, 2);
  }
});

test("CMF: a paper shared by programmes counts its _IHA credits once", () => {
  const rows = ["BAH-E/BAHR-E", "BBAH", "BCOMH/BCOMHR"].flatMap(p => [
    [p, "III", "UCES-001(ugc26_ge10)", "Community Engagement", "MDC", 2, 50, 0, 3, "SWAYAM Inhouse-Exam", 100, 0, 2025],
    [p, "III", "UCES-001(ugc26_ge10)_IHA", "Assignment: Community Engagement", "MDC", 1, 50, 0, 3, "SWAYAM Inhouse-Assignment", 100, 0, 2025]
  ]);
  const { courses } = parseCMF([CMF_HEAD, ...rows]);
  assert.equal(courses.length, 1);
  assert.equal(courses[0].credits, 3);
  // CIE-only: the in-house exam (50) and the in-house assignment (50) are one CIE out of 100, also counted once.
  assert.equal(courses[0].cieMax, 100);
  assert.equal(courses[0].eseMax, 0);
  assert.equal(courses[0].programmes, "BAH-E/BAHR-E/BBAH/BCOMH/BCOMHR");
});

test("CMF: an _IHA row with no main paper keeps its own credits", () => {
  const iha = ["BED", "II", "BEDN-201_IHA", "Pedagogy", "DSC", 4, 30, 70, 2, "Education", 30, 70, 2025];
  assert.equal(parseCMF([CMF_HEAD, iha]).courses[0].credits, 4);
  assert.equal(parseCMF([CMF_HEAD, iha, ["BCOMH", "II", "BEDN-201_IHA", "Pedagogy", "DSC", 4, 30, 70, 2, "Education", 30, 70, 2025]]).courses[0].credits, 4);
});

test("CMF: NC max marks become 0", () => {
  const { courses } = parseCMF([CMF_HEAD, ["MSC-M", "IV", "PMAT-405", "Project", "DSC", 6, "NC", 100, 4, "Maths", 0, 100, 2024]]);
  assert.equal(courses[0].cieMax, 0);
  assert.equal(courses[0].eseMax, 100);
});

test("SMF: reads batch, Sem-Credits and elective columns", () => {
  const { students, warnings } = parseSMF([
    ["Sl. No.", "Campus", "Regd. No.", "Semester", "Name", "Programme Code", "Batch", "Sem-Credits", "IDM Course", "DSE Course"],
    [1, "Brindavan", 24010107001, "IV", "A Student", "BSH-M/BSHR-M", 2024, 22, "UCOM-604", ""]
  ]);
  assert.deepEqual(warnings, []);
  const s = students["24010107001"];
  assert.equal(s.batch, "2024");
  assert.equal(s.semCredits, 22);
  assert.deepEqual(s.electives, ["UCOM-604"]);
});

test("marks: regd numbers normalised, _IHA stripped, duplicates flagged", () => {
  const { rows, warnings } = parseMarks([
    ["Regd. No.", "Paper Code", "CIE Marks", "Programme", "Semester"],
    [2.4010107001e10, "UMAT-401_IHA", 45, "BSH-M", "IV"],
    ["24010107001", "UMAT-401", 46, "BSH-M", "IV"]
  ], "CIE");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].regdNo, "24010107001");
  assert.equal(rows[0].paperCode, "UMAT-401");
  assert.equal(rows[0].raw, 46);
  assert.equal(warnings.length, 1);
});

test("previous semesters parsed from S0n columns", () => {
  const { rows } = parsePrevious([
    ["Batch", "Regd. No.", "Name", "S01_EARNEDCRxNP", "S01_EARNEDCREDS", "S01_GPA", "S02_EARNEDCRxNP", "S02_EARNEDCREDS", "S02_GPA"],
    [2023, 234501, "X", 199, 25, 8, 153, 19, 8.1]
  ]);
  assert.deepEqual(rows.map(r => [r.semesterNo, r.creditNP, r.credits]), [[1, 199, 25], [2, 153, 19]]);
});

test("normalisers", () => {
  assert.equal(normalizeRegdNo(221902.0), "221902");
  assert.equal(normalizeSemester(4), "IV");
  assert.equal(normalizeSemester("Sem-II"), "II");
});

const fx = loadFixtures();
test("programme defaults reproduce the legacy Programs Table", { skip: !fx && "no fixtures" }, () => {
  const diffs = [];
  for (const [code, p] of Object.entries(fx.reference.programmes)) {
    const d = programmeDefaults(code);
    const legacy = { passCategory: p.passCategory, cieNP: p.cieNP, eseNP: p.eseNP, combNP: p.combNP, gradeTable: p.gradeTable ?? null };
    const mine = { passCategory: d.passCategory, cieNP: d.cieNP, eseNP: d.eseNP, combNP: d.combNP, gradeTable: d.gradeTable ?? null };
    if (JSON.stringify(legacy) !== JSON.stringify(mine)) diffs.push({ code, legacy, mine });
  }
  assert.deepEqual(diffs, []);
});
