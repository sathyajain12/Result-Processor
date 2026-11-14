import { json } from "../../../../_lib/http.js";
import { audit } from "../../../../_lib/db.js";
import { requireRole } from "../../../../_lib/auth.js";
import { refreshList } from "../../../../_lib/marksheets.js";

// Re-read the course masters into the Mark sheets list (new courses appear; fetch progress is kept).
export async function onRequestPost({ env, params, data }) {
  requireRole(data.user, "operator");
  const report = await refreshList(env, params.sid);
  await audit(env.DB, data.user.email, params.sid, "refresh-marksheets", null, report);
  return json({ masters: report });
}
