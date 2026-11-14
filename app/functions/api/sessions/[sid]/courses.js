import { json } from "../../../_lib/http.js";
import { all, parseJson } from "../../../_lib/db.js";

export async function onRequestGet({ env, params }) {
  const rows = await all(env.DB, "SELECT * FROM courses WHERE session_id = ? ORDER BY base_code, code", params.sid);
  return json(rows.map(c => ({ code: c.code, baseCode: c.base_code, title: c.title, programmes: c.programmes, semester: c.semester, batches: parseJson(c.batches, []),
    category: c.category, credits: c.credits, cieMax: c.cie_max, eseMax: c.ese_max, cieWeight: c.cie_weight, eseWeight: c.ese_weight, calcType: c.calc_type, teachingDept: c.teaching_dept })));
}
