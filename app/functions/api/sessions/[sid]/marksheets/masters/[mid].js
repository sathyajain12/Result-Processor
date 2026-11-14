import { json, HttpError } from "../../../../../_lib/http.js";
import { first, run, audit } from "../../../../../_lib/db.js";
import { requireRole } from "../../../../../_lib/auth.js";

// Unlink a course master. Its sheets stay in the list (and their fetched marks stay) but are no longer checked.
export async function onRequestDelete({ env, params, data }) {
  requireRole(data.user, "admin");
  const m = await first(env.DB, "SELECT * FROM marksheet_masters WHERE session_id = ? AND id = ?", params.sid, Number(params.mid));
  if (!m) throw new HttpError(404, "Course master not found");
  await run(env.DB, "DELETE FROM marksheet_masters WHERE id = ?", m.id);
  await run(env.DB, "UPDATE marksheets SET in_master = 0 WHERE session_id = ? AND master_id = ?", params.sid, m.id);
  await audit(env.DB, data.user.email, params.sid, "unlink-course-master", m.spreadsheet_id, { component: m.component, campus: m.campus });
  return json({ ok: true });
}
