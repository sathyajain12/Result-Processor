import { json, readJson, requireFields } from "../../../_lib/http.js";
import { audit } from "../../../_lib/db.js";
import { requireRole } from "../../../_lib/auth.js";
import { importSource } from "../../../_lib/sources.js";

export async function onRequestPost({ env, request, params, data }) {
  requireRole(data.user, "operator");
  const body = await readJson(request);
  requireFields(body, ["kind", "values"]);
  const result = await importSource(env, params.sid, body.kind, body.values, data.user.email);
  await audit(env.DB, data.user.email, params.sid, "import", body.kind, { detail: result.detail, file: body.fileName });
  return json(result);
}
