import { json, HttpError } from "../../../../_lib/http.js";
import { run } from "../../../../_lib/db.js";
import { saving } from "../../../../_lib/calcsave.js";

// Step 4b: the run's analytics, worked out in the browser, stored as sent (POST ?runId=, body: { analytics, cycle } as JSON
// text). Not parsed here: reading a few hundred KB of JSON would cost more CPU than the free plan's 10 ms allows.
const MAX = 1500000;
export async function onRequestPost({ env, params, request, data }) {
  const runId = new URL(request.url).searchParams.get("runId");
  const { db } = await saving(env, params, data, runId, { allowDone: true });
  const text = await request.text();
  if (!text.startsWith('{"analytics":') || text.length > MAX) throw new HttpError(400, "Send { analytics, cycle } as JSON");
  // The two parts are split by a marker the browser puts between them, so each is stored as it came.
  const at = text.lastIndexOf(',"cycle":');
  if (at < 0 || !text.endsWith("}")) throw new HttpError(400, "Send { analytics, cycle } as JSON");
  await run(db, "UPDATE runs SET analytics = ?, analytics_cycle = ? WHERE id = ? AND session_id = ?",
    text.slice('{"analytics":'.length, at), text.slice(at + ',"cycle":'.length, -1), runId, params.sid);
  return json({ saved: true });
}
