import { parseIntegralItems } from "../../../engine/src/index.js";
import { first, run, batchInsert, parseJson } from "./db.js";

const cell = v => (v === "X" ? "X" : String(v));

export async function loadIntegralItems(env, sessionId, files, actor, options) {
  const db = env.DB;
  const { rows, files: report, warnings } = parseIntegralItems(files, options);
  await run(db, "DELETE FROM integral_items WHERE session_id = ?", sessionId);
  await batchInsert(db, rows.map(r => db.prepare(
    "INSERT INTO integral_items (session_id, regd_no, int1, int2, int3, int4, int5, total, items, source_file) VALUES (?,?,?,?,?,?,?,?,?,?)"
  ).bind(sessionId, r.regdNo, ...r.items.map(cell), r.total, r.count, r.sourceFile)));
  await run(db, `INSERT INTO integral_imports (session_id, loaded_at, loaded_by, files, warnings, row_count) VALUES (?, datetime('now'), ?, ?, ?, ?)
    ON CONFLICT (session_id) DO UPDATE SET loaded_at = excluded.loaded_at, loaded_by = excluded.loaded_by, files = excluded.files,
      warnings = excluded.warnings, row_count = excluded.row_count`,
    sessionId, actor, JSON.stringify(report), JSON.stringify(warnings), rows.length);
  return { rows: rows.length, files: report, warnings };
}

export async function integralImport(db, sessionId) {
  const m = await first(db, "SELECT * FROM integral_imports WHERE session_id = ?", sessionId);
  return {
    loadedAt: m?.loaded_at ?? null, loadedBy: m?.loaded_by ?? null, rowCount: m?.row_count ?? 0,
    files: parseJson(m?.files, []), warnings: parseJson(m?.warnings, []), links: parseJson(m?.links, [])
  };
}

export const integralRow = r => ({
  regdNo: r.regd_no, items: [r.int1, r.int2, r.int3, r.int4, r.int5].map(v => (v === "X" || v === null ? "X" : Number(v))),
  total: r.total, count: r.items, sourceFile: r.source_file
});
