import { json } from "../../_lib/http.js";
import { all } from "../../_lib/db.js";
import { loadReferenceTables } from "../../_lib/compute.js";

export async function onRequestGet({ env }) {
  const tables = await loadReferenceTables(env.DB);
  const programmes = await all(env.DB, "SELECT * FROM programmes ORDER BY code");
  return json({ ...tables, programmes: programmes.map(p => ({ code: p.code, passCategory: p.pass_category, cieNP: p.cie_np, eseNP: p.ese_np, combNP: p.comb_np, gradeTable: p.grade_table, customised: !!p.customised, updatedAt: p.updated_at, updatedBy: p.updated_by })) });
}
