import { json, readJson, HttpError } from "../../../../_lib/http.js";
import { all, parseJson } from "../../../../_lib/db.js";
import { finishRun } from "../../../../_lib/compute.js";
import { saving } from "../../../../_lib/calcsave.js";

// Step 5: the run becomes the latest result (or, unchanged, keeps standing). Checks every result was saved first.
export async function onRequestPost({ env, params, request, data }) {
  const body = await readJson(request);
  const unchanged = !!body.unchanged;
  const { db, runRow } = await saving(env, params, data, body.runId, { allowDone: unchanged });
  const summary = body.summary || {};
  if (!/^[0-9a-f]{64}$/.test(summary.fingerprint || "")) throw new HttpError(400, "The summary needs the fingerprint");
  if (!unchanged) {
    const [{ n }] = await all(db, "SELECT COUNT(*) AS n FROM student_results WHERE run_id = ?", body.runId);
    if (n !== summary.students) throw new HttpError(409, `Only ${n} of ${summary.students} results were saved; run Compute again`);
  }
  const latest = unchanged ? { summary: runRow.summary } : null;
  if (unchanged && parseJson(runRow.summary, {})?.fingerprint !== summary.fingerprint) throw new HttpError(409, "The results changed meanwhile; run Compute again");
  return json(await finishRun(db, params.sid, data.user.email, { runId: body.runId, unchanged, summary, latest }));
}
