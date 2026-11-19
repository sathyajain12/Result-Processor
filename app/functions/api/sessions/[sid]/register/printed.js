import { json, HttpError } from "../../../../_lib/http.js";
import { all, audit, parseJson } from "../../../../_lib/db.js";

// A record of the Grade register prints made from the portal: one Runs and audit entry ("print-register") each time the
// print dialog opens. The browser does not say whether the person then printed or cancelled, so it records the dialog.
// Anyone who can open the Grade register may record a print, and prints are recorded even in a locked session.
const ACTION = "print-register";
const MAX_REGD = 2000;

export async function onRequestPost({ env, params, request, data }) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") throw new HttpError(400, "Send the print as JSON.");
  const regdNos = Array.isArray(body.regdNos) ? body.regdNos.map(String).slice(0, MAX_REGD) : [];
  const text = (v, n = 200) => (typeof v === "string" ? v.slice(0, n) : null);
  const label = text(body.label) || "All programmes";
  await audit(env.DB, data.user.email, params.sid, ACTION, label, {
    group: text(body.group), q: text(body.q), count: Number(body.count) || regdNos.length, regdNos, computedAt: text(body.computedAt, 40)
  });
  return json({ ok: true });
}

// The latest 300 prints, newest first. The session's audit rows are few (hundreds), so this reads little.
export async function onRequestGet({ env, params }) {
  const rows = await all(env.DB, "SELECT id, at, actor, entity, detail FROM audit_log WHERE session_id = ? AND action = ? ORDER BY id DESC LIMIT 300", params.sid, ACTION);
  return json(rows.map(r => {
    const d = parseJson(r.detail, {});
    return { id: r.id, at: r.at, by: r.actor, label: r.entity, group: d.group ?? null, q: d.q ?? null, count: d.count ?? 0, regdNos: d.regdNos ?? [], computedAt: d.computedAt ?? null };
  }));
}
