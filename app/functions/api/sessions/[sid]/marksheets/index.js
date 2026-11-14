import { json } from "../../../../_lib/http.js";
import { all, first } from "../../../../_lib/db.js";

// The order of the values in each sheet row sent to the page.
const SHEET_FIELDS = ["key", "component", "campus", "programme", "courseCode", "courseTitle", "semester", "teacherName", "teacherEmail", "dueDate",
  "hasFile", "inMaster", "status", "paperCode", "students", "marksCount", "lastCheckedAt", "lastChanges", "lastError"];

// The Mark sheets page: linked course masters, every teacher's sheet with its status, and recent fetch runs.
// Cloudflare's free plan allows each request 10 ms of CPU, so only the columns the page shows are read, and the tab counts
// come from the sheets' own mark counts (counting the stored rows read about 16,000 rows on every load).
export async function onRequestGet({ env, params }) {
  const db = env.DB;
  const [masters, sheets, runs, session] = await Promise.all([
    all(db, "SELECT * FROM marksheet_masters WHERE session_id = ? ORDER BY component, campus", params.sid),
    // Values only, in SHEET_FIELDS order, so the server never builds an object per sheet; the page names them.
    db.prepare(`SELECT key, component, campus, programme, course_code, course_title, semester, teacher_name, teacher_email, due_date,
      file_url IS NOT NULL, in_master, status, paper_code, students, marks_count, last_checked_at, last_changes, last_error FROM marksheets
      WHERE session_id = ? ORDER BY component, programme, course_code, campus`).bind(params.sid).raw(),
    all(db, "SELECT * FROM marksheet_runs WHERE session_id = ? ORDER BY id DESC LIMIT 10", params.sid),
    first(db, "SELECT marks_dirty FROM exam_sessions WHERE id = ?", params.sid)
  ]);
  const rowCounts = { CIE: 0, ESE: 0 };
  const COMPONENT = SHEET_FIELDS.indexOf("component"), MARKS = SHEET_FIELDS.indexOf("marksCount");
  for (const s of sheets) if (s[MARKS] && s[COMPONENT] in rowCounts) rowCounts[s[COMPONENT]] += s[MARKS];
  return json({
    marksDirty: !!session?.marks_dirty,
    rowCounts,
    masters: masters.map(m => ({ id: m.id, kind: m.kind || "master", component: m.component, campus: m.campus, spreadsheetId: m.spreadsheet_id, sheetName: m.sheet_name, title: m.title,
      lastReadAt: m.last_read_at, rowCount: m.row_count, lastError: m.last_error })),
    sheetFields: SHEET_FIELDS,
    sheets,
    runs: runs.map(r => ({ id: r.id, trigger: r.trigger, component: r.component, startedAt: r.started_at, finishedAt: r.finished_at, checked: r.checked, fetched: r.fetched, changed: r.changed, errors: r.errors, by: r.by }))
  });
}
