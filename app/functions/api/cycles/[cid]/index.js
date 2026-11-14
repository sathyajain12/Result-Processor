import { json, readJson, requireFields, HttpError } from "../../../_lib/http.js";
import { first, run, audit } from "../../../_lib/db.js";
import { requireRole } from "../../../_lib/auth.js";

async function getCycle(db, id) {
  const cycle = await first(db, "SELECT * FROM exam_cycles WHERE id = ?", id);
  if (!cycle) throw new HttpError(404, "Cycle not found");
  return cycle;
}

export async function onRequestPut({ env, request, params, data }) {
  requireRole(data.user, "admin");
  const cycle = await getCycle(env.DB, params.cid);
  const body = await readJson(request);
  requireFields(body, ["name"]);
  await run(env.DB, "UPDATE exam_cycles SET name = ? WHERE id = ?", body.name.trim(), cycle.id);
  await audit(env.DB, data.user.email, null, "rename-cycle", cycle.id, { from: cycle.name, to: body.name.trim() });
  return json({ ok: true });
}

export async function onRequestDelete({ env, params, data }) {
  requireRole(data.user, "admin");
  const cycle = await getCycle(env.DB, params.cid);
  const { n } = await first(env.DB, "SELECT COUNT(*) AS n FROM exam_sessions WHERE cycle_id = ?", cycle.id);
  if (n > 0) throw new HttpError(409, `Move or remove the ${n} session(s) in ${cycle.name} before deleting it`);
  await run(env.DB, "DELETE FROM exam_cycles WHERE id = ?", cycle.id);
  await audit(env.DB, data.user.email, null, "delete-cycle", cycle.id, { name: cycle.name });
  return json({ ok: true });
}
