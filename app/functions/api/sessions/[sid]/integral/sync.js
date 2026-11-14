import { json, HttpError } from "../../../../_lib/http.js";
import { audit } from "../../../../_lib/db.js";
import { requireRole } from "../../../../_lib/auth.js";
import { readSheet } from "../../../../_lib/google.js";
import { loadIntegralItems, integralImport } from "../../../../_lib/integral.js";

export async function onRequestPost({ env, params, data }) {
  requireRole(data.user, "operator");
  const { links } = await integralImport(env.DB, params.sid);
  if (!links.length) throw new HttpError(400, "No Integral Items sheets are linked for this session yet");
  const files = [], errors = [];
  for (const id of links) {
    try {
      files.push({ name: `Linked sheet ${id.slice(0, 10)}…`, values: await readSheet(env, id, "Consolidated") });
    } catch (err) {
      errors.push(`${id}: ${err.message}`);
    }
  }
  // Sheets cannot tell a missing tab from a sharing problem, so stop rather than replace good data with a partial load.
  if (errors.length) throw new HttpError(400, `Could not read ${errors.length} linked sheet(s); nothing was changed. ${errors.join(" ")}`);
  // Linked sheets are chosen one by one, so the Drive file-name filter does not apply.
  const result = await loadIntegralItems(env, params.sid, files, data.user.email, { checkNames: false });
  await audit(env.DB, data.user.email, params.sid, "sync-integral", null, { rows: result.rows });
  return json(result);
}
