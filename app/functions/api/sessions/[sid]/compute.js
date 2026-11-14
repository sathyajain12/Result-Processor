import { json } from "../../../_lib/http.js";
import { requireRole } from "../../../_lib/auth.js";
import { runCompute } from "../../../_lib/compute.js";

export async function onRequestPost({ env, params, data }) {
  requireRole(data.user, "operator");
  return json(await runCompute(env, params.sid, data.user.email));
}
