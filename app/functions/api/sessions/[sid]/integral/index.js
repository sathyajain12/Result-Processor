import { json, readJson, HttpError } from "../../../../_lib/http.js";
import { all, audit } from "../../../../_lib/db.js";
import { requireRole } from "../../../../_lib/auth.js";
import { loadIntegralItems, integralImport, integralRow } from "../../../../_lib/integral.js";

export async function onRequestGet({ env, params }) {
  const rows = await all(env.DB, `SELECT i.*, s.name FROM integral_items i LEFT JOIN students s ON s.session_id = i.session_id AND s.regd_no = i.regd_no
    WHERE i.session_id = ? ORDER BY i.regd_no`, params.sid);
  return json({ ...(await integralImport(env.DB, params.sid)), rows: rows.map(r => ({ ...integralRow(r), name: r.name })) });
}

export async function onRequestPost({ env, request, params, data }) {
  requireRole(data.user, "operator");
  const body = await readJson(request);
  if (!Array.isArray(body.files) || !body.files.length) throw new HttpError(400, "Choose at least one Integral Items workbook");
  const files = body.files.map(f => ({ name: String(f.name || "Untitled"), values: Array.isArray(f.values) ? f.values : null }));
  const result = await loadIntegralItems(env, params.sid, files, data.user.email);
  await audit(env.DB, data.user.email, params.sid, "import-integral", null, { rows: result.rows, files: result.files.map(f => f.name) });
  return json(result);
}
