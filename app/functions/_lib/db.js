export const all = async (db, sql, ...params) => (await db.prepare(sql).bind(...params).all()).results;
export const first = (db, sql, ...params) => db.prepare(sql).bind(...params).first();
export const run = (db, sql, ...params) => db.prepare(sql).bind(...params).run();

export async function batchInsert(db, statements, chunk = 100) {
  for (let i = 0; i < statements.length; i += chunk) {
    await db.batch(statements.slice(i, i + chunk));
  }
}

export const parseJson = (v, fallback = null) => {
  if (v === null || v === undefined || v === "") return fallback;
  try { return JSON.parse(v); } catch { return fallback; }
};

export async function audit(db, actor, sessionId, action, entity, detail) {
  await run(db, "INSERT INTO audit_log (actor, session_id, action, entity, detail) VALUES (?, ?, ?, ?, ?)",
    actor, sessionId ?? null, action, entity ?? null, detail ? JSON.stringify(detail) : null);
}

export async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}
