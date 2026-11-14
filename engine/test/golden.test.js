import { test } from "node:test";
import assert from "node:assert/strict";
import { loadFixtures, runGolden } from "./golden.js";

const fx = loadFixtures();

test("legacy computation matches every Consolidated Result row", { skip: !fx && "no fixtures" }, () => {
  const r = runGolden(fx);
  const counts = Object.fromEntries(Object.entries(r.computation).map(([k, v]) => [k, v.length]));
  assert.deepEqual(counts, {});
});

test("legacy aggregation matches every FinalOutput student", { skip: !fx && "no fixtures" }, () => {
  const r = runGolden(fx);
  const counts = Object.fromEntries(Object.entries(r.students).map(([k, v]) => [k, v.length]));
  assert.deepEqual(counts, {});
  assert.equal(r.compared, 1572);
});
