import { json, HttpError } from "../../../../_lib/http.js";
import { run } from "../../../../_lib/db.js";
import { saving } from "../../../../_lib/calcsave.js";

// Step 4c: the completeness report's parts that need every mark, student and course (arrivalPart in
// shared/completeness-core.js), worked out in the browser and stored as sent (POST ?runId=, JSON text). Not parsed here:
// on the free plan a request has 10 ms of CPU.
const MAX = 1500000;
export async function onRequestPost({ env, params, request, data }) {
  const runId = new URL(request.url).searchParams.get("runId");
  const { db } = await saving(env, params, data, runId, { allowDone: true });
  const text = await request.text();
  if (!text.startsWith('{"rule1a":') || !text.endsWith("}") || text.length > MAX) throw new HttpError(400, "Send { rule1a, noFetch, names } as JSON");
  await run(db, "UPDATE runs SET arrival = ? WHERE id = ? AND session_id = ?", text, runId, params.sid);
  return json({ saved: true });
}
