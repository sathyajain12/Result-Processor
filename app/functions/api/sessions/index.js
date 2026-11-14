import { json, readJson, requireFields, HttpError } from "../../_lib/http.js";
import { all, first, run, audit, parseJson } from "../../_lib/db.js";
import { requireRole } from "../../_lib/auth.js";
import { slug } from "../../_lib/slug.js";
import { approvalMap } from "../../_lib/state.js";
import { latestRun } from "../../_lib/compute.js";

export async function onRequestGet({ env }) {
  const rows = await all(env.DB, `
    SELECT s.*, c.name AS cycle_name, b.name AS base_session_name,
           (SELECT summary FROM runs r WHERE r.session_id = s.id AND r.status = 'done' ORDER BY started_at DESC LIMIT 1) AS last_summary,
           (SELECT MAX(started_at) FROM runs r WHERE r.session_id = s.id AND r.status = 'done') AS last_run_at
    FROM exam_sessions s LEFT JOIN exam_cycles c ON c.id = s.cycle_id LEFT JOIN exam_sessions b ON b.id = s.base_session_id
    ORDER BY s.created_at DESC`);
  // Approved results still matching the latest compute, per session.
  const approved = new Map();
  for (const r of rows) {
    const run = await latestRun(env.DB, r.id);
    if (!run) continue;
    const approvals = await approvalMap(env.DB, r.id);
    if (!approvals.size) { approved.set(r.id, 0); continue; }
    const current = await all(env.DB, "SELECT regd_no, digest FROM student_results WHERE run_id = ? AND releasable = 1", run.id);
    approved.set(r.id, current.filter(c => approvals.get(c.regd_no)?.digest === c.digest).length);
  }
  return json(rows.map(r => ({
    id: r.id, name: r.name, status: r.status, closedAt: r.closed_at, cycleId: r.cycle_id, cycleName: r.cycle_name,
    kind: r.kind, baseSessionId: r.base_session_id, baseSessionName: r.base_session_name,
    createdAt: r.created_at, lastRunAt: r.last_run_at, summary: parseJson(r.last_summary), approved: approved.get(r.id) || 0
  })));
}

export async function onRequestPost({ env, request, data }) {
  requireRole(data.user, "admin");
  const body = await readJson(request);
  requireFields(body, ["name"]);
  const cycleId = body.cycleId || null;
  if (cycleId && !(await first(env.DB, "SELECT id FROM exam_cycles WHERE id = ?", cycleId))) throw new HttpError(400, `Cycle ${cycleId} not found`);
  const kind = body.kind === "supplementary" ? "supplementary" : "regular";
  const baseSessionId = kind === "supplementary" ? body.baseSessionId || null : null;
  if (kind === "supplementary") {
    const baseSession = baseSessionId && await first(env.DB, "SELECT id, kind FROM exam_sessions WHERE id = ?", baseSessionId);
    if (!baseSession) throw new HttpError(400, "Choose the regular session this supplementary builds on");
    if (baseSession.kind !== "regular") throw new HttpError(400, "A supplementary session must build on a regular session");
  }
  // Session names like "ESE Regular" repeat across cycles, so prefix the cycle to keep ids unique.
  let id = slug(body.id || body.name);
  if (cycleId && !id.startsWith(cycleId)) id = `${cycleId}-${id}`;
  if (await first(env.DB, "SELECT id FROM exam_sessions WHERE id = ?", id)) throw new HttpError(409, `Session ${id} already exists`);
  await run(env.DB, "INSERT INTO exam_sessions (id, name, cycle_id, kind, base_session_id, created_by) VALUES (?, ?, ?, ?, ?, ?)",
    id, body.name.trim(), cycleId, kind, baseSessionId, data.user.email);
  if (body.copySourcesFrom) {
    await run(env.DB, `INSERT INTO sources (session_id, kind, spreadsheet_id, sheet_name)
      SELECT ?, kind, spreadsheet_id, sheet_name FROM sources WHERE session_id = ?`, id, body.copySourcesFrom);
  }
  await audit(env.DB, data.user.email, id, "create-session", id, { name: body.name, cycleId, kind, baseSessionId });
  return json({ id }, 201);
}
