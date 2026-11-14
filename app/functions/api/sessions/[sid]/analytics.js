import { json, HttpError } from "../../../_lib/http.js";
import { all, first } from "../../../_lib/db.js";
import { latestRun } from "../../../_lib/compute.js";
import { aggregate } from "../../../_lib/analytics.js";

// The session's analytics, as worked out during its latest Compute and stored with the run. The database picks out the
// scope asked for and it is sent on as it is: never unpacked here, so the request stays within the free plan's 10 ms of CPU.
// A run computed before analytics were stored is added up here, the old (heavy) way, until the next Compute.
export async function onRequestGet({ env, params, request }) {
  const scope = new URL(request.url).searchParams.get("scope") === "all" ? "all" : "releasable";
  const session = await first(env.DB, "SELECT id FROM exam_sessions WHERE id = ?", params.sid);
  if (!session) throw new HttpError(404, "Session not found");
  const run = await latestRun(env.DB, params.sid);
  if (!run) return json({ run: null });
  const head = JSON.stringify({ id: run.id, startedAt: run.started_at });
  const stored = await first(env.DB, "SELECT json_extract(analytics, ?) AS a FROM runs WHERE id = ?", `$.${scope}`, run.id);
  if (stored?.a) return new Response(`{"run":${head},${stored.a.slice(1)}`, { headers: { "content-type": "application/json; charset=utf-8" } });
  const rows = await all(env.DB, "SELECT * FROM student_results WHERE run_id = ?", run.id);
  return json({ run: { id: run.id, startedAt: run.started_at }, ...aggregate(rows, { scope }) });
}
