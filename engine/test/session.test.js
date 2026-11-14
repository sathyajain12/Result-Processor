import { test } from "node:test";
import assert from "node:assert/strict";
import { loadFixtures } from "./golden.js";
import { processSession, EXCEPTION } from "../src/index.js";
import { legacyOverrides } from "../../tools/legacy_overrides.mjs";

const fx = loadFixtures();

test("session layer reproduces FinalOutput for every releasable student", { skip: !fx && "no fixtures" }, () => {
  const cie = fx.papers.map(p => ({ regdNo: p.regdNo, paperCode: p.paperCode, raw: p.cie }));
  const ese = fx.papers.map(p => ({ regdNo: p.regdNo, paperCode: p.paperCode, raw: p.ese }));
  const overrides = [
    { type: "skip-validation", paperCode: "UCOM-604(imb26_mg139)", reason: "Swayam-Portal exam" },
    ...legacyOverrides(fx)
  ];
  const out = processSession({ reference: fx.reference, students: fx.students, cie, ese, overrides });

  const withheldInSheet = new Set(fx.finalOutput.filter(f => f.withheld === "WITHHELD").map(f => f.regdNo));
  const fo = new Map(fx.finalOutput.map(f => [f.regdNo, f]));
  const mismatches = out.results
    .filter(r => r.releasable && !withheldInSheet.has(r.regdNo))
    .filter(r => { const f = fo.get(r.regdNo); return !f || f.publishedGPA !== r.publishedGPA || (f.letterGrade ?? "") !== r.letterGrade; })
    .map(r => r.regdNo);

  assert.deepEqual(mismatches, []);
  assert.ok(out.results.filter(r => r.releasable).length >= 1550);
});

test("holds are explained, never silent", { skip: !fx && "no fixtures" }, () => {
  const cie = fx.papers.map(p => ({ regdNo: p.regdNo, paperCode: p.paperCode, raw: p.cie }));
  const ese = fx.papers.map(p => ({ regdNo: p.regdNo, paperCode: p.paperCode, raw: p.ese }));
  const out = processSession({ reference: fx.reference, students: fx.students, cie, ese });
  const withReason = new Set(out.exceptions.filter(e => e.severity === "block").flatMap(e => e.regdNo ? [e.regdNo] : out.results.filter(r => r.batchKey === e.batchKey).map(r => r.regdNo)));
  for (const r of out.results.filter(r => !r.releasable)) assert.ok(withReason.has(r.regdNo), `${r.regdNo} held without a reason`);
});

test("left students are excluded and not-in-SMF students are reported", () => {
  const reference = { weightage: { 1: { cie: 0.5, ese: 0.5 } }, npTables: {}, gradeTables: {}, programmes: {}, courses: [] };
  const students = { "1": { regdNo: "1", programme: "BSH-M", semester: "II", batch: "2025" } };
  const out = processSession({ reference, students, cie: [{ regdNo: "1", paperCode: "X", raw: "L" }, { regdNo: "9", paperCode: "X", raw: 10 }] });
  assert.equal(out.results.length, 0);
  assert.ok(out.exceptions.some(e => e.code === EXCEPTION.LEFT_STUDENT && e.regdNo === "1"));
  assert.ok(out.exceptions.some(e => e.code === EXCEPTION.NOT_IN_SMF && e.regdNo === "9"));
});
