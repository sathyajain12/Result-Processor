import { json, readJson, HttpError } from "../../../_lib/http.js";
import { all, run, audit } from "../../../_lib/db.js";
import { requireRole } from "../../../_lib/auth.js";
import { readSheet } from "../../../_lib/google.js";
import { importSource, SOURCE_KINDS } from "../../../_lib/sources.js";
import { runCompute } from "../../../_lib/compute.js";

const ORDER = ["CMF", "SMF", "PREV", "CIE", "ESE"];

export async function onRequestPost({ env, request, params, data }) {
  requireRole(data.user, "operator");
  const body = await readJson(request).catch(() => ({}));
  const wanted = (body.kinds?.length ? body.kinds : SOURCE_KINDS).filter(k => SOURCE_KINDS.includes(k));
  const sources = (await all(env.DB, "SELECT * FROM sources WHERE session_id = ? AND spreadsheet_id IS NOT NULL", params.sid))
    .filter(s => wanted.includes(s.kind))
    .sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  if (!sources.length) throw new HttpError(400, "No Google Sheets are linked for this session yet");

  const results = [];
  for (const s of sources) {
    try {
      const values = await readSheet(env, s.spreadsheet_id, s.sheet_name);
      results.push(await importSource(env, params.sid, s.kind, values, data.user.email));
    } catch (err) {
      results.push({ kind: s.kind, error: err.message });
    }
  }
  await audit(env.DB, data.user.email, params.sid, "sync", null, results.map(r => ({ kind: r.kind, detail: r.detail, error: r.error })));

  // Compute takes seconds of CPU, more than Cloudflare's free plan allows a request, so the page computes in the browser
  // after a sync. The session is marked as having changes not yet computed. ({ compute: true } still computes here, for a
  // local server without that limit.)
  if (results.some(r => !r.error)) await run(env.DB, "UPDATE exam_sessions SET marks_dirty = 1 WHERE id = ?", params.sid);
  const compute = body.compute === true ? await runCompute(env, params.sid, data.user.email).catch(err => ({ error: err.message })) : null;
  return json({ sources: results, compute });
}
