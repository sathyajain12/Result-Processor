import { FAIL_4, FAIL_5 } from "./constants.js";
import { isNum } from "./math.js";

export function lookupNP(percent, tables, tableCode) {
  const table = tables?.[tableCode];
  if (!table || !isNum(percent)) return { ok: false };

  let row = null;
  for (const r of table) {
    if (isNum(r.ll) && r.ll <= percent) row = r;
    else if (isNum(r.ll) && r.ll > percent) break;
  }
  if (!row) return { ok: false };

  if (row.np === "Fails") {
    return { ok: true, value: tableCode === "I-B" ? FAIL_5 : FAIL_4, band: row, table: tableCode };
  }
  return { ok: true, value: row.np, band: row, table: tableCode };
}

export function letterGrade(gpa, gradeTables, tableCode) {
  const code = gradeTables?.[tableCode] ? tableCode : "II-A";
  const table = gradeTables?.[code] || [];
  for (const r of table) {
    if (isNum(r.ll) && isNum(r.ul) && gpa >= r.ll && gpa <= r.ul) {
      return { letter: r.lg, qualifier: r.qa, table: code, band: r };
    }
  }
  return { letter: "", qualifier: "", table: code, band: null };
}
