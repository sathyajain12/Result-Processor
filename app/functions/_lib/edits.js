import { all, first, run } from "./db.js";
import { HttpError } from "./http.js";

// Student details that can be overridden from the student page, with their students-table column.
// These are written through to the students table so every page shows the edited value;
// the override row keeps the sheet's value and is re-applied after each SMF import.
export const STUDENT_FIELDS = { name: "name", campus: "campus", batch: "batch", semCredits: "sem_credits" };
export const MARK_FIELDS = ["CIE", "ESE"];

const asText = v => (v === null || v === undefined ? null : String(v));

export function cleanStudentValue(field, value) {
  const v = String(value ?? "").trim();
  if (field === "semCredits") {
    const n = Number(v);
    if (v === "" || !Number.isFinite(n) || n < 0) throw new HttpError(400, "Sem-Credits must be a number");
    return n;
  }
  if (field === "name" && !v) throw new HttpError(400, "Name cannot be blank");
  return v;
}

// A mark as typed in the sheet: a number from 0 up, or A (absent) / L (left).
export function cleanMark(value) {
  const v = String(value ?? "").trim().toUpperCase();
  if (v === "A" || v === "AB") return "A";
  if (v === "L") return "L";
  const n = Number(v);
  if (v === "" || !Number.isFinite(n) || n < 0) throw new HttpError(400, 'A mark must be a number, "A" for absent or "L" for left');
  return String(n);
}

// After an SMF import: remember what the sheet now says, then put the edited value back.
export async function reapplyStudentEdits(db, sessionId) {
  const edits = await all(db, "SELECT * FROM overrides WHERE session_id = ? AND type = 'student-field' AND revoked_at IS NULL ORDER BY id", sessionId);
  for (const o of edits) {
    const col = STUDENT_FIELDS[o.field];
    if (!col) continue;
    const s = await first(db, `SELECT ${col} AS v FROM students WHERE session_id = ? AND regd_no = ?`, sessionId, o.regd_no);
    if (!s) continue;
    await run(db, "UPDATE overrides SET sheet_value = ? WHERE id = ?", asText(s.v), o.id);
    await run(db, `UPDATE students SET ${col} = ? WHERE session_id = ? AND regd_no = ?`, o.field === "semCredits" ? Number(o.value) : o.value, sessionId, o.regd_no);
  }
}

// After a CIE or ESE import: record the sheet's current mark against each mark edit, so a later sheet correction is visible.
export async function refreshMarkEdits(db, sessionId, component) {
  await run(db, `UPDATE overrides SET sheet_value = (
      SELECT m.raw FROM marks m WHERE m.session_id = overrides.session_id AND m.regd_no = overrides.regd_no
        AND m.paper_code = overrides.paper_code AND m.component = overrides.field)
    WHERE session_id = ? AND type = 'mark' AND field = ? AND revoked_at IS NULL`, sessionId, component);
}

export { asText };
