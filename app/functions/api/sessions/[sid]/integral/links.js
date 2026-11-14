import { json, readJson, HttpError } from "../../../../_lib/http.js";
import { run, audit } from "../../../../_lib/db.js";
import { requireRole } from "../../../../_lib/auth.js";

const ID = /\/d\/([a-zA-Z0-9-_]+)/;

export async function onRequestPut({ env, request, params, data }) {
  requireRole(data.user, "admin");
  const body = await readJson(request);
  if (!Array.isArray(body.links)) throw new HttpError(400, "links must be a list of spreadsheet URLs or IDs");
  const links = [...new Set(body.links.map(l => String(l).trim()).filter(Boolean).map(l => l.match(ID)?.[1] || l))];
  await run(env.DB, `INSERT INTO integral_imports (session_id, links) VALUES (?, ?)
    ON CONFLICT (session_id) DO UPDATE SET links = excluded.links`, params.sid, JSON.stringify(links));
  await audit(env.DB, data.user.email, params.sid, "configure-integral", null, { links });
  return json({ links });
}
