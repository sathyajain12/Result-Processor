import { HttpError } from "../../../../../_lib/http.js";
import { first } from "../../../../../_lib/db.js";
import { exportTabPdf, readRanges } from "../../../../../_lib/google.js";
import { marksStatementTab } from "../../../../../_lib/marksheets.js";

// One Marks Statement exactly as it looks in Google Sheets, as a PDF, for viewing inside the portal (read only).
// Served as /marksheets/sheet/<course code>.pdf?key=… so the browser's viewer is titled with the course code.
// Google renders it for the service account, so nobody appears among the sheet's viewers and staff need no access.
// It opens in a frame, so a problem is answered with a short page rather than JSON.
const problem = (status, message) => new Response(
  `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui,sans-serif;margin:32px;color:#1d2b57"><h3 style="margin:0 0 8px">Cannot show this Marks Statement</h3><p>${String(message).replace(/</g, "&lt;")}</p></body>`,
  { status, headers: { "content-type": "text/html; charset=utf-8" } });

export async function onRequestGet({ env, params, request }) {
  try {
    const key = new URL(request.url).searchParams.get("key");
    if (!key) throw new HttpError(400, "Which sheet? (key is missing)");
    const s = await first(env.DB, "SELECT spreadsheet_id, course_code, students FROM marksheets WHERE session_id = ? AND key = ?", params.sid, key);
    if (!s) throw new HttpError(404, "That sheet is not in this session.");
    if (!s.spreadsheet_id) throw new HttpError(404, "There is no file for this course yet.");
    const tab = await marksStatementTab(env, s.spreadsheet_id);
    if (!tab) throw new HttpError(404, "The file has no tabs.");
    // The current number of students, from the sheet itself (the stored count may be missing or out of date).
    let students = tab.numStudentsCell ? Number((await readRanges(env, s.spreadsheet_id, [tab.numStudentsCell]))[0]?.[0]?.[0]) : NaN;
    if (!(students >= 0) && s.students !== null) students = Number(s.students);
    // Rows in use: the header block, the students, and the details panel beside them (which runs to about row 45).
    const known = Number.isFinite(tab.firstStudentRow) && students >= 0;
    const area = known ? { r1: 0, c1: 0, r2: Math.max(tab.firstStudentRow + students, 45) + 1, c2: 90 } : null;
    const res = await exportTabPdf(env, s.spreadsheet_id, tab.gid, area, known && students <= 120);   // big or unknown: several pages
    const name = String(s.course_code || "Marks Statement").replace(/[^\w().-]+/g, "_");
    return new Response(res.body, { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${name}.pdf"`, "cache-control": "private, no-store" } });
  } catch (err) {
    if (err instanceof HttpError) return problem(err.status, err.message);
    return problem(err.status === 429 ? 429 : 502, err.status === 429 ? "Google's read limit was reached. Try again in a minute." : err.message);
  }
}
