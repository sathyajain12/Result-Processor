import { json, readJson, requireFields, HttpError } from "../../_lib/http.js";
import { run, audit, first } from "../../_lib/db.js";
import { requireRole } from "../../_lib/auth.js";

export async function onRequestPut({ env, request, data }) {
  requireRole(data.user, "admin");
  const b = await readJson(request);
  requireFields(b, ["code", "passCategory", "cieNP", "eseNP", "combNP"]);
  if (![1, 2, 3].includes(Number(b.passCategory))) throw new HttpError(400, "Pass category must be 1, 2 or 3");
  const before = await first(env.DB, "SELECT * FROM programmes WHERE code = ?", b.code);
  await run(env.DB, `INSERT INTO programmes (code, pass_category, cie_np, ese_np, comb_np, grade_table, customised, updated_at, updated_by)
    VALUES (?,?,?,?,?,?,1,datetime('now'),?) ON CONFLICT (code) DO UPDATE SET pass_category = excluded.pass_category, cie_np = excluded.cie_np,
    ese_np = excluded.ese_np, comb_np = excluded.comb_np, grade_table = excluded.grade_table, customised = 1, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    b.code, Number(b.passCategory), b.cieNP, b.eseNP, b.combNP, b.gradeTable || null, data.user.email);
  await audit(env.DB, data.user.email, null, "edit-programme", b.code, { before, after: b });
  return json({ ok: true, recomputeNeeded: true });
}
