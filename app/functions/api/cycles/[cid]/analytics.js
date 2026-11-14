import { json, HttpError } from "../../../_lib/http.js";
import { all, first, parseJson } from "../../../_lib/db.js";
import { latestRun } from "../../../_lib/compute.js";
import { cycleParts, combineCycle } from "../../../_lib/analytics.js";
import { canSee } from "../../../../shared/tabs.js";

// A cycle's overview: each session's totals and programmes, and the regular sessions combined. Built from the small summary
// each Compute stores with its run (counts and GPAs per programme), so nobody's papers are read here. A session last
// computed before those were stored is added up from its results, the old (heavy) way, until its next Compute.
export async function onRequestGet({ env, params, data }) {
  if (!canSee(data.user, "analytics")) throw new HttpError(403, "You do not have access to Analytics. Ask an admin to give you that tab on the People page.");
  const db = env.DB;
  const cycle = await first(db, "SELECT * FROM exam_cycles WHERE id = ?", params.cid);
  if (!cycle) throw new HttpError(404, "Cycle not found");
  const sessions = await all(db, "SELECT * FROM exam_sessions WHERE cycle_id = ? ORDER BY created_at, rowid", cycle.id);
  const out = [];
  const regular = [];
  for (const s of sessions) {
    const kind = s.kind || "regular";
    const run = await latestRun(db, s.id);
    let parts = { totals: { students: 0, passed: 0, failed: 0, absent: 0, withheld: 0, held: 0, gpas: [] }, programmes: {} };
    if (run) {
      const stored = await first(db, "SELECT analytics_cycle FROM runs WHERE id = ?", run.id);
      parts = parseJson(stored?.analytics_cycle) || cycleParts(await all(db, "SELECT batch_key, state, releasable, published_gpa FROM student_results WHERE run_id = ?", run.id));
    }
    // Supplementary students already appear in their regular session, so only regular sessions are combined.
    if (kind === "regular") regular.push(parts);
    const a = combineCycle([parts]);
    out.push({ id: s.id, name: s.name, kind, status: s.status, computedAt: run?.started_at ?? null, totals: a.totals, byProgramme: a.byProgramme });
  }
  return json({ id: cycle.id, name: cycle.name, sessions: out, combined: combineCycle(regular) });
}
