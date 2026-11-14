import { json, readJson, HttpError } from "../../../_lib/http.js";
import { first, run, audit, parseJson } from "../../../_lib/db.js";
import { requireRole } from "../../../_lib/auth.js";
import { DEFAULT_THRESHOLDS, THRESHOLD_LIMITS, effectiveThresholds } from "../../../_lib/thresholds.js";

async function load(db, sid) {
  const s = await first(db, "SELECT thresholds FROM exam_sessions WHERE id = ?", sid);
  if (!s) throw new HttpError(404, "Session not found");
  return parseJson(s.thresholds, null);
}

const view = stored => ({
  values: effectiveThresholds(stored), defaults: DEFAULT_THRESHOLDS, limits: THRESHOLD_LIMITS,
  customised: !!stored, updatedBy: stored?.updatedBy ?? null, updatedAt: stored?.updatedAt ?? null
});

export async function onRequestGet({ env, params }) {
  return json(view(await load(env.DB, params.sid)));
}

export async function onRequestPut({ env, request, params, data }) {
  requireRole(data.user, "admin");
  const before = await load(env.DB, params.sid);
  const body = await readJson(request);
  let stored = null;
  if (!body.reset) {
    const values = {};
    for (const [k, { min, max }] of Object.entries(THRESHOLD_LIMITS)) {
      const v = body[k] === undefined ? effectiveThresholds(before)[k] : Number(body[k]);
      if (!Number.isFinite(v) || v < min || v > max) throw new HttpError(400, `${k} must be between ${min * 100}% and ${max * 100}%`);
      values[k] = Math.round(v * 1000) / 1000;
    }
    const isDefault = Object.keys(values).every(k => values[k] === DEFAULT_THRESHOLDS[k]);
    stored = isDefault ? null : { ...values, updatedBy: data.user.email, updatedAt: new Date().toISOString().replace("T", " ").slice(0, 19) };
  }
  await run(env.DB, "UPDATE exam_sessions SET thresholds = ? WHERE id = ?", stored ? JSON.stringify(stored) : null, params.sid);
  await audit(env.DB, data.user.email, params.sid, "edit-thresholds", params.sid, { before: effectiveThresholds(before), after: effectiveThresholds(stored) });
  return json({ ...view(stored), recomputeNeeded: true });
}
