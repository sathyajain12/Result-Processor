import { json, readJson, HttpError } from "../../../../_lib/http.js";
import { run, audit } from "../../../../_lib/db.js";
import { requireRole } from "../../../../_lib/auth.js";
import { SOURCE_KINDS } from "../../../../_lib/sources.js";

const ID = /\/d\/([a-zA-Z0-9-_]+)/;

export async function onRequestPut({ env, request, params, data }) {
  requireRole(data.user, "admin");
  if (!SOURCE_KINDS.includes(params.kind)) throw new HttpError(400, "Unknown source");
  const body = await readJson(request);
  const raw = String(body.spreadsheet || body.spreadsheetId || "").trim();
  const spreadsheetId = raw.match(ID)?.[1] || raw;
  if (!spreadsheetId) throw new HttpError(400, "Paste the spreadsheet URL or ID");
  await run(env.DB, `INSERT INTO sources (session_id, kind, spreadsheet_id, sheet_name) VALUES (?, ?, ?, ?)
    ON CONFLICT (session_id, kind) DO UPDATE SET spreadsheet_id = excluded.spreadsheet_id, sheet_name = excluded.sheet_name`,
    params.sid, params.kind, spreadsheetId, (body.sheetName || "").trim() || null);
  await audit(env.DB, data.user.email, params.sid, "configure-source", params.kind, { spreadsheetId, sheetName: body.sheetName });
  return json({ ok: true, spreadsheetId });
}
