import { json, HttpError } from "../../../../_lib/http.js";
import { all, first } from "../../../../_lib/db.js";
import { requireRole } from "../../../../_lib/auth.js";
import { QUERIES } from "../../../../../shared/compute-core.js";
import { latestRun, loadBaseRows, suppBaseSession, suppAttempt } from "../../../../_lib/compute.js";

// What the browser needs to compute, a part at a time. Cloudflare's free plan allows each request 10 ms of CPU, so big
// parts come in pages (values only, no object per row), read in the same order as QUERIES in shared/compute-core.js.
//   ?part=meta                      session, reference tables, mark edits, SLD sheets, overrides, supplementary details
//   ?part=courses|students|marks|previous&after=<cursor>   one page; `next` is the cursor for the following page
//   ?part=previous&from=base        the base session's previous semesters (a supplementary without its own)
//   ?part=base&after=<regd>         a supplementary's approved base results
const PAGES = {
  courses: { size: 200, key: ["code"], fields: ["code", "base_code", "title", "programmes", "semester", "batches", "category", "credits", "cie_max", "ese_max",
    "cie_weight", "ese_weight", "calc_type", "course_type", "sequence", "teaching_dept"], table: "courses" },
  students: { size: 300, key: ["regd_no"], fields: ["regd_no", "name", "campus", "programme", "semester", "batch", "sem_credits", "electives"], table: "students" },
  marks: { size: 1500, key: ["regd_no", "paper_code", "component"], fields: ["regd_no", "paper_code", "component", "raw"], table: "marks" },
  previous: { size: 1500, key: ["regd_no", "semester_no"], fields: ["regd_no", "semester_no", "credit_np", "credits", "gpa"], table: "previous_semesters" }
};

async function page(db, part, sessionId, after) {
  const p = PAGES[part];
  const cursor = after ? JSON.parse(after) : null;
  const keyList = p.key.join(", ");
  const rows = await db.prepare(`SELECT ${p.fields.join(", ")} FROM ${p.table} WHERE session_id = ?${cursor ? ` AND (${keyList}) > (${p.key.map(() => "?").join(", ")})` : ""}
    ORDER BY ${keyList} LIMIT ?`).bind(sessionId, ...(cursor || []), p.size).raw();
  const last = rows[rows.length - 1];
  return { fields: p.fields, rows, next: rows.length === p.size ? JSON.stringify(p.key.map(k => last[p.fields.indexOf(k)])) : null };
}

export async function onRequestGet({ env, params, request, data }) {
  requireRole(data.user, "viewer");   // reading only: anyone signed in may "Check now"; saving a Compute needs an operator
  const db = env.DB;
  const url = new URL(request.url);
  const part = url.searchParams.get("part");
  const session = await first(db, "SELECT id, name, kind, status, base_session_id, thresholds FROM exam_sessions WHERE id = ?", params.sid);
  if (!session) throw new HttpError(404, "Session not found");

  if (part === "meta") {
    const [np, grade, weightage, programmes, markEdits, sld, overrides, latest] = await Promise.all([
      all(db, QUERIES.np), all(db, QUERIES.grade), all(db, QUERIES.weightage), all(db, QUERIES.programmes),
      all(db, QUERIES.markEdits, session.id), all(db, QUERIES.sld, session.id), all(db, QUERIES.overrides, session.id), latestRun(db, session.id)
    ]);
    let supp = null;
    if (session.kind === "supplementary") {
      const base = await suppBaseSession(db, session);
      supp = { baseSessionId: base.id, attempt: await suppAttempt(db, session) };
    }
    return json({ session: { id: session.id, name: session.name, kind: session.kind, status: session.status, thresholds: session.thresholds },
      tables: { np, grade, weightage, programmes }, markEdits, sld, overrides, supp, latestRunId: latest?.id ?? null });
  }
  if (part === "base") {
    if (session.kind !== "supplementary") throw new HttpError(400, "Only a supplementary session has a base session");
    const base = await suppBaseSession(db, session);
    const { rows, last, more } = await loadBaseRows(db, base.id, { afterRegd: url.searchParams.get("after") || "", limit: 25 });
    return json({ rows, next: more ? last : null });
  }
  if (PAGES[part]) {
    let sessionId = session.id;
    if (part === "previous" && url.searchParams.get("from") === "base") sessionId = (await suppBaseSession(db, session)).id;
    return json(await page(db, part, sessionId, url.searchParams.get("after")));
  }
  throw new HttpError(400, "Unknown part");
}
