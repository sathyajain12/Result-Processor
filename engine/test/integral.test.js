import { test } from "node:test";
import assert from "node:assert/strict";
import { parseIntegralItems, integralItemValue } from "../src/ingest.js";

const HEAD = ["S.No", "Regd.No.", "Name", "Item-1-NP", "Item-2-NP", "Item-3-NP", "Item-4-NP", "Item-5-NP"];
const FILE = "BSc Integral Items-Data Entry";

test("integral: item values follow the sheet, including 0 becoming X", () => {
  assert.equal(integralItemValue(7.5), 7.5);
  assert.equal(integralItemValue("8"), 8);
  assert.equal(integralItemValue(" 6.25 "), 6.25);
  assert.equal(integralItemValue("12abc"), 12);
  for (const v of [0, "", "  ", null, undefined, "AB", "-", false]) assert.equal(integralItemValue(v), "X", String(v));
  assert.equal(integralItemValue("0"), 0); // a typed "0" string is truthy, so the sheet keeps it
});

test("integral: totals, item counts and 2dp rounding", () => {
  const { rows, files } = parseIntegralItems([{ name: FILE, values: [HEAD,
    [1, "2401001", "A", 8, 7.5, "", "AB", 9],
    [2, 2401002, "B", 0.1, 0.2, 0.335, 0, null]
  ] }]);
  assert.deepEqual(rows[0], { regdNo: "2401001", items: [8, 7.5, "X", "X", 9], sourceFile: FILE, total: 24.5, count: 3 });
  assert.equal(rows[1].regdNo, "2401002");
  assert.equal(rows[1].total, 0.64);
  assert.equal(rows[1].count, 3);
  assert.deepEqual(files, [{ name: FILE, rows: 2, skipped: false, reason: null }]);
});

test("integral: files without the tab, rows or a required column are skipped", () => {
  const { rows, files } = parseIntegralItems([
    { name: `${FILE} 1`, values: null },
    { name: `${FILE} 2`, values: [HEAD] },
    { name: `${FILE} 3`, values: [HEAD.filter(h => h !== "Item-4-NP"), [1, "2401003", "C", 1, 2, 3, 5]] },
    { name: `${FILE} 4`, values: [[" Regd.No. ", "Item-1-NP", "Item-2-NP", "Item-3-NP", "Item-4-NP", "Item-5-NP"], ["2401004", 1, 1, 1, 1, 1]] }
  ]);
  assert.deepEqual(files.map(f => [f.skipped, f.reason]), [
    [true, 'No "Consolidated" tab'], [true, "No data rows"], [true, "Missing column(s) Item-4-NP"], [false, null]
  ]);
  assert.deepEqual(rows.map(r => r.regdNo), ["2401004"]);
});

test("integral: blank regd nos skipped, last file wins with a warning, output sorted", () => {
  const { rows, warnings } = parseIntegralItems([
    { name: `${FILE} A`, values: [HEAD, [1, "2401009", "Z", 1, 1, 1, 1, 1], [2, "", "blank", 9, 9, 9, 9, 9], [3, "2401005", "Y", 2, 2, 2, 2, 2]] },
    { name: `${FILE} B`, values: [HEAD, [1, "2401005", "Y", 3, 3, 3, 3, 3]] },
    { name: "Other workbook", values: [HEAD, [1, "2401001", "X", 4, 4, 4, 4, 4]] }
  ]);
  assert.deepEqual(rows.map(r => r.regdNo), ["2401001", "2401005", "2401009"]);
  assert.equal(rows.find(r => r.regdNo === "2401005").total, 15);
  assert.ok(warnings.some(w => w.startsWith("2401005: also in")));
  assert.ok(warnings.some(w => w.startsWith("Other workbook: file name")));
});
