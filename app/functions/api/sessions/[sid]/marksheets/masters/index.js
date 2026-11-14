import { json, readJson, HttpError } from "../../../../../_lib/http.js";
import { run, audit } from "../../../../../_lib/db.js";
import { requireRole } from "../../../../../_lib/auth.js";
import { readLayout, driveItem } from "../../../../../_lib/google.js";
import { spreadsheetIdOf, folderIdOf, campusFromTitle } from "../../../../../_lib/marksheets.js";

// Link a course master. The portal only reads it. A per-campus course master gets its campus from the last three
// letters of the file name, as the Apps Script did (Course_Master-Apr 2026-PSN gives PSN). A combined one
// (Course_Master-Nov 2026-ALL) has no campus of its own: each row's Campus column is used instead.
export async function onRequestPost({ env, request, params, data }) {
  requireRole(data.user, "admin");
  const body = await readJson(request);
  const component = body.component === "ESE" ? "ESE" : body.component === "CIE" ? "CIE" : null;
  if (!component) throw new HttpError(400, "Choose CIE or ESE");
  // Either a course master (a Google Sheet) or a Drive folder of Marks Statements.
  const kind = body.kind === "folder" ? "folder" : "master";
  const id = kind === "folder" ? folderIdOf(body.url) : spreadsheetIdOf(body.url);
  if (!id) throw new HttpError(400, kind === "folder" ? "Paste the link to the Google Drive folder" : "Paste the link to the course master in Google Sheets");
  let title = null;
  if (kind === "folder") {
    let item;
    try { item = await driveItem(env, id); } catch (err) { throw new HttpError(400, `Cannot open the folder: ${err.message}`); }
    if (item.mimeType !== "application/vnd.google-apps.folder") throw new HttpError(400, `"${item.name}" is not a folder`);
    title = item.name;
  } else {
    try { title = (await readLayout(env, id)).properties?.title ?? null; } catch (err) { throw new HttpError(400, `Cannot open the course master: ${err.message}`); }
  }
  const campus = component === "CIE" ? String(body.campus || "").trim().toUpperCase() || campusFromTitle(title) : null;
  await run(env.DB, `INSERT INTO marksheet_masters (session_id, component, campus, spreadsheet_id, sheet_name, title, created_by, kind) VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT (session_id, component, spreadsheet_id) DO UPDATE SET campus = excluded.campus, sheet_name = excluded.sheet_name, title = excluded.title, kind = excluded.kind`,
    params.sid, component, campus, id, kind === "folder" ? null : String(body.sheetName || "").trim() || null, title, data.user.email, kind);
  await audit(env.DB, data.user.email, params.sid, kind === "folder" ? "link-marksheet-folder" : "link-course-master", id, { component, campus, title });
  return json({ ok: true, title, campus, kind }, 201);
}
