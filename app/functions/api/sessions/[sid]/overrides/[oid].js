import { json, HttpError } from "../../../../_lib/http.js";
import { first, run, audit } from "../../../../_lib/db.js";
import { requireRole } from "../../../../_lib/auth.js";
import { STUDENT_FIELDS } from "../../../../_lib/edits.js";

export async function onRequestDelete({ env, params, data }) {
  const o = await first(env.DB, "SELECT * FROM overrides WHERE session_id = ? AND id = ?", params.sid, Number(params.oid));
  if (!o) throw new HttpError(404, "Override not found");
  requireRole(data.user, o.type === "accept" ? "operator" : "admin");
  await run(env.DB, "UPDATE overrides SET revoked_by = ?, revoked_at = datetime('now') WHERE id = ?", data.user.email, o.id);
  if (o.type === "student-field" && STUDENT_FIELDS[o.field]) {
    const v = o.field === "semCredits" ? (o.sheet_value === null ? null : Number(o.sheet_value)) : o.sheet_value;
    await run(env.DB, `UPDATE students SET ${STUDENT_FIELDS[o.field]} = ? WHERE session_id = ? AND regd_no = ?`, v, params.sid, o.regd_no);
  }
  if (o.type === "accept") {
    await run(env.DB, "UPDATE exceptions SET accepted = 0 WHERE session_id = ? AND code = ? AND IFNULL(batch_key,'') = IFNULL(?, '') AND IFNULL(regd_no,'') = IFNULL(?, '') AND IFNULL(paper_code,'') = IFNULL(?, '')",
      params.sid, o.code, o.batch_key, o.regd_no, o.paper_code);
  }
  await audit(env.DB, data.user.email, params.sid, "revoke-override", String(o.id), { type: o.type, reason: o.reason });
  return json({ ok: true });
}
