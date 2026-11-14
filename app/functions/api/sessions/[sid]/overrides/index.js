import { json, readJson, requireFields, HttpError } from "../../../../_lib/http.js";
import { all, first, run, audit } from "../../../../_lib/db.js";
import { STUDENT_FIELDS, MARK_FIELDS, cleanStudentValue, cleanMark, asText } from "../../../../_lib/edits.js";
import { requireRole } from "../../../../_lib/auth.js";

const RULES = {
  "accept": { role: "operator", fields: ["code"] },
  "skip-validation": { role: "admin", fields: ["paperCode"] },
  "exclude-paper": { role: "admin", fields: ["paperCode"] },
  "exclude-student": { role: "admin", fields: ["regdNo"] },
  "student-batch": { role: "admin", fields: ["regdNo", "value"] },
  "course-field": { role: "admin", fields: ["regdNo", "paperCode", "field", "value"] },
  "mark": { role: "admin", fields: ["regdNo", "paperCode", "field", "value"] },
  "student-field": { role: "admin", fields: ["regdNo", "field", "value"] }
};
// Edits replace the earlier edit of the same field rather than stacking on it.
const SINGLE = new Set(["course-field", "mark", "student-field"]);
const COURSE_FIELDS = ["cieMax", "eseMax", "credits", "calcType", "passCategory", "cieWeight", "eseWeight"];

export async function onRequestGet({ env, params }) {
  const rows = await all(env.DB, "SELECT * FROM overrides WHERE session_id = ? ORDER BY revoked_at IS NOT NULL, id DESC", params.sid);
  return json(rows.map(o => ({
    id: o.id, type: o.type, code: o.code, batchKey: o.batch_key, regdNo: o.regd_no, paperCode: o.paper_code, field: o.field, value: o.value,
    reason: o.reason, by: o.created_by, at: o.created_at, revokedBy: o.revoked_by, revokedAt: o.revoked_at
  })));
}

export async function onRequestPost({ env, request, params, data }) {
  const body = await readJson(request);
  const rule = RULES[body.type];
  if (!rule) throw new HttpError(400, `Unknown override type ${body.type}`);
  requireRole(data.user, rule.role);
  requireFields(body, [...rule.fields, "reason"]);
  if (body.reason.trim().length < 5) throw new HttpError(400, "Give a real reason — it is shown in the audit trail");
  if (body.type === "accept" && body.code === "SUPP_NO_BASE_RESULT") throw new HttpError(400, "A supplementary result needs an approved result in the base session; approve it there first");
  if (body.type === "course-field" && !COURSE_FIELDS.includes(body.field)) throw new HttpError(400, `Field must be one of ${COURSE_FIELDS.join(", ")}`);
  if (body.type === "course-field" && !Number.isFinite(Number(body.value))) throw new HttpError(400, "Course values must be numbers");
  if (body.type === "mark" && !MARK_FIELDS.includes(body.field)) throw new HttpError(400, "A mark edit is for CIE or ESE");
  if (body.type === "student-field" && !STUDENT_FIELDS[body.field]) throw new HttpError(400, `Field must be one of ${Object.keys(STUDENT_FIELDS).join(", ")}`);

  const db = env.DB;
  let value = body.value === undefined ? null : String(body.value).trim();
  let sheetValue = null;
  let previous = null;
  if (SINGLE.has(body.type)) {
    previous = await first(db, `SELECT * FROM overrides WHERE session_id = ? AND type = ? AND regd_no IS ? AND paper_code IS ? AND field = ? AND revoked_at IS NULL
      ORDER BY id DESC LIMIT 1`, params.sid, body.type, body.regdNo ?? null, body.paperCode ?? null, body.field);
  }
  if (body.type === "mark") {
    value = cleanMark(body.value);
    const m = await first(db, "SELECT raw FROM marks WHERE session_id = ? AND regd_no = ? AND paper_code = ? AND component = ?", params.sid, body.regdNo, body.paperCode, body.field);
    sheetValue = asText(m?.raw);
  }
  if (body.type === "student-field") {
    const col = STUDENT_FIELDS[body.field];
    const s = await first(db, `SELECT ${col} AS v FROM students WHERE session_id = ? AND regd_no = ?`, params.sid, body.regdNo);
    if (!s) throw new HttpError(404, `Student ${body.regdNo} is not in the SMF for this session`);
    const clean = cleanStudentValue(body.field, body.value);
    value = String(clean);
    // The sheet value is what the SMF said before any edit, so keep it from the edit being replaced.
    sheetValue = previous ? previous.sheet_value : asText(s.v);
    await run(db, `UPDATE students SET ${col} = ? WHERE session_id = ? AND regd_no = ?`, clean, params.sid, body.regdNo);
  }
  if (previous) {
    await run(db, "UPDATE overrides SET revoked_by = ?, revoked_at = datetime('now') WHERE id = ?", data.user.email, previous.id);
  }

  const res = await run(db,
    "INSERT INTO overrides (session_id, type, code, batch_key, regd_no, paper_code, field, value, sheet_value, reason, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    params.sid, body.type, body.code ?? null, body.batchKey ?? null, body.regdNo ?? null, body.paperCode ?? null, body.field ?? null,
    value, sheetValue, body.reason.trim(), data.user.email);
  await run(env.DB, "UPDATE exceptions SET accepted = 1 WHERE session_id = ? AND code = ? AND IFNULL(batch_key,'') = ? AND IFNULL(regd_no,'') = ? AND IFNULL(paper_code,'') = ?",
    params.sid, body.code ?? "", body.batchKey ?? "", body.regdNo ?? "", body.paperCode ?? "");
  await audit(db, data.user.email, params.sid, "override", body.type, { ...body, value, sheetValue, replaced: previous?.id ?? null });
  return json({ id: res.meta.last_row_id, recomputeNeeded: true }, 201);
}
