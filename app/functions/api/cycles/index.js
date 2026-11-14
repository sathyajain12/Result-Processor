import { json, readJson, requireFields, HttpError } from "../../_lib/http.js";
import { all, first, run, audit } from "../../_lib/db.js";
import { requireRole } from "../../_lib/auth.js";
import { slug } from "../../_lib/slug.js";

export async function onRequestGet({ env }) {
  const rows = await all(env.DB, `
    SELECT c.*, (SELECT COUNT(*) FROM exam_sessions s WHERE s.cycle_id = c.id) AS session_count
    FROM exam_cycles c ORDER BY c.created_at DESC, c.rowid DESC`);
  return json(rows.map(r => ({ id: r.id, name: r.name, createdAt: r.created_at, sessionCount: r.session_count })));
}

export async function onRequestPost({ env, request, data }) {
  requireRole(data.user, "admin");
  const body = await readJson(request);
  requireFields(body, ["name"]);
  const id = slug(body.name);
  if (!id) throw new HttpError(400, "Cycle name needs letters or digits");
  if (await first(env.DB, "SELECT id FROM exam_cycles WHERE id = ?", id)) throw new HttpError(409, `Cycle ${id} already exists`);
  await run(env.DB, "INSERT INTO exam_cycles (id, name, created_by) VALUES (?, ?, ?)", id, body.name.trim(), data.user.email);
  await audit(env.DB, data.user.email, null, "create-cycle", id, { name: body.name });
  return json({ id }, 201);
}
