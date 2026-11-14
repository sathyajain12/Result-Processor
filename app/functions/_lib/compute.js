import { computePaper, POLICY } from "../../../engine/src/index.js";
import {
  QUERIES, referenceTables, buildInputs, evaluate, baseResults, previousMap, buildSave, diffExceptions, diffBatches, policyFor, ENGINE_VERSION, InputError,
  RESULT_COLUMNS
} from "../../shared/compute-core.js";
import { all, first, run, batchInsert, parseJson, audit } from "./db.js";
import { analyticsFor } from "../../shared/analytics-core.js";
import { HttpError } from "./http.js";
import { assertOpen } from "./lock.js";
import { approvalMap } from "./state.js";

const KEEP_RUNS = 40;   // deleting an old run costs as many writes as saving one, so runs are kept longer

// Compute itself is in ../../shared/compute-core.js, shared with the browser. On the live site (Cloudflare's free plan allows
// a request 10 ms of CPU) the browser grades and saves through the calc/ endpoints; runCompute below does it all in one
// request, which only fits where there is no such limit (a local server, tests).

export async function loadReferenceTables(db) {
  const [np, grade, weightage, programmes] = await Promise.all([all(db, QUERIES.np), all(db, QUERIES.grade), all(db, QUERIES.weightage), all(db, QUERIES.programmes)]);
  return referenceTables({ np, grade, weightage, programmes });
}

export async function loadInputs(db, sessionId) {
  const [tables, courses, students, marks, markEdits, sld, overrides, previous, session] = await Promise.all([
    loadReferenceTables(db), all(db, QUERIES.courses, sessionId), all(db, QUERIES.students, sessionId), all(db, QUERIES.marks, sessionId),
    all(db, QUERIES.markEdits, sessionId), all(db, QUERIES.sld, sessionId), all(db, QUERIES.overrides, sessionId), all(db, QUERIES.previous, sessionId),
    first(db, "SELECT thresholds FROM exam_sessions WHERE id = ?", sessionId)
  ]);
  return buildInputs({ tables, courses, students, marks, markEdits, sld, overrides, previous, thresholds: session?.thresholds });
}

// Each student's approved result in a session, with the full stored papers from the run it was approved in, as rows for
// baseResults(). `afterRegd` and `limit` read them a page at a time.
export async function loadBaseRows(db, baseSessionId, { afterRegd = "", limit = null } = {}) {
  const approvals = await approvalMap(db, baseSessionId);
  if (!approvals.size) return { rows: [], last: null, more: false };
  const runs = [...new Set([...approvals.values()].map(a => a.runId))];
  const rows = await all(db, `SELECT run_id, regd_no, digest, batch_key, sum_credits, published_gpa, papers FROM student_results
    WHERE run_id IN (${runs.map(() => "?").join(",")}) AND regd_no > ? ORDER BY regd_no${limit ? " LIMIT ?" : ""}`, ...runs, afterRegd, ...(limit ? [limit] : []));
  const out = [];
  for (const r of rows) {
    const a = approvals.get(r.regd_no);
    if (!a || a.runId !== r.run_id || a.digest !== r.digest) continue;
    out.push({ ...r, approved_at: a.at, approved_by: a.by });
  }
  return { rows: out, last: rows.length ? rows[rows.length - 1].regd_no : null, more: !!limit && rows.length === limit };
}

export async function loadBaseResults(db, baseSessionId) {
  return baseResults((await loadBaseRows(db, baseSessionId)).rows, baseSessionId);
}

// The supplementary's base session, checked: a supplementary builds on the approved results of its regular session.
export async function suppBaseSession(db, session) {
  const baseSession = await first(db, "SELECT id, kind FROM exam_sessions WHERE id = ?", session.base_session_id);
  if (!baseSession || baseSession.kind !== "regular") throw new HttpError(400, "This supplementary session is not linked to a regular session");
  return baseSession;
}

// The attempt number decides how much grace is left: this session's place among the regular session's supplementaries.
export async function suppAttempt(db, session) {
  const siblings = await all(db, "SELECT id FROM exam_sessions WHERE base_session_id = ? AND kind = 'supplementary' ORDER BY created_at, id", session.base_session_id);
  return siblings.findIndex(s => s.id === session.id) + 1 || 1;
}

export function explainPaper(paper, tables) {
  const reference = { ...tables, courses: [] };
  const course = paper.course ? { ...paper.course, code: paper.courseCode } : null;
  return computePaper({ cie: paper.cie, ese: paper.ese, eseGraced: paper.grace?.gracedMarks ?? null }, course, reference, POLICY.DEFAULT, paper.overrides).trace;
}

const asHttp = err => (err instanceof InputError ? new HttpError(err.status, err.message) : err);

// Works out every result, batch and issue from the data loaded now, in memory, saving nothing.
export async function evaluateSession(db, session, { base = null } = {}) {
  const isSupp = session.kind === "supplementary";
  let attempt = 1, basePrevious = null;
  if (isSupp) {
    const baseSession = await suppBaseSession(db, session);
    if (!base) base = await loadBaseResults(db, baseSession.id);
    attempt = await suppAttempt(db, session);
    basePrevious = previousMap(await all(db, QUERIES.previous, baseSession.id));
  }
  const inputs = await loadInputs(db, session.id);
  try {
    return { ...evaluate(inputs, { kind: session.kind, base, attempt, basePrevious }), inputs };
  } catch (err) { throw asHttp(err); }
}

// Run bookkeeping shared by runCompute and the calc/ endpoints the browser saves through.
export async function startRun(db, session, actor, fingerprint) {
  const latest = await latestRun(db, session.id);
  if (latest && parseJson(latest.summary, {})?.fingerprint === fingerprint) return { unchanged: true, runId: latest.id, latest };
  const runId = crypto.randomUUID();
  await run(db, "INSERT INTO runs (id, session_id, triggered_by, engine_version, policy) VALUES (?, ?, ?, ?, ?)",
    runId, session.id, actor, ENGINE_VERSION, JSON.stringify(policyFor(session.kind)));
  return { unchanged: false, runId, latest };
}

export const resultStatement = (db, runId, sessionId, row, hash = null) => db.prepare(
  `INSERT OR REPLACE INTO student_results (run_id, session_id, ${RESULT_COLUMNS.join(", ")}, row_hash) VALUES (?,?,${RESULT_COLUMNS.map(() => "?").join(",")},?)`
).bind(runId, sessionId, ...row, hash);

export function batchStatements(db, sessionId, runId, upserts) {
  return upserts.map(b => db.prepare(
    `INSERT INTO batches (session_id, id, key, programme, semester, batch, run_id, stats) VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT (session_id, key) DO UPDATE SET run_id = excluded.run_id, stats = excluded.stats`
  ).bind(sessionId, b.id, b.key, b.programme, b.semester, b.batch, runId, b.stats));
}

export function exceptionStatements(db, sessionId, runId, { inserts = [], updates = [], deletes = [] }) {
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  return [
    ...updates.map(e => db.prepare("UPDATE exceptions SET run_id = ?, severity = ?, message = ?, details = ?, accepted = ? WHERE session_id = ? AND key = ?")
      .bind(runId, e.severity, e.message, e.details, e.accepted, sessionId, e.key)),
    ...inserts.map(e => db.prepare(
      `INSERT OR REPLACE INTO exceptions (session_id, key, run_id, code, severity, batch_key, regd_no, paper_code, course_code, message, details, accepted, first_seen)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(sessionId, e.key, runId, e.code, e.severity, e.batchKey, e.regdNo, e.paperCode, e.courseCode, e.message, e.details, e.accepted, now)),
    ...deletes.map(key => db.prepare("DELETE FROM exceptions WHERE session_id = ? AND key = ?").bind(sessionId, key))
  ];
}

export async function finishRun(db, sessionId, actor, { runId, unchanged, summary, latest }) {
  const summaryJson = JSON.stringify(summary);
  if (unchanged) {
    if (latest?.summary !== summaryJson) await run(db, "UPDATE runs SET summary = ? WHERE id = ?", summaryJson, runId);
  } else {
    await run(db, "UPDATE runs SET status = 'done', finished_at = datetime('now'), summary = ? WHERE id = ?", summaryJson, runId);
  }
  await run(db, "UPDATE exam_sessions SET marks_dirty = 0 WHERE id = ? AND marks_dirty != 0", sessionId);
  const { fingerprint, ...shown } = summary;
  await audit(db, actor, sessionId, "compute", runId, unchanged ? { ...shown, unchanged: true } : shown);
  if (!unchanged) await pruneRuns(db, sessionId);
  return { runId, unchanged, ...shown };
}

// The whole Compute in one request. Fits only where requests may use seconds of CPU; the live site computes in the browser.
export async function runCompute(env, sessionId, actor) {
  const db = env.DB;
  const session = await first(db, "SELECT * FROM exam_sessions WHERE id = ?", sessionId);
  if (!session) throw new HttpError(404, "Session not found");
  await assertOpen(db, sessionId);

  const evaluated = await evaluateSession(db, session);
  const save = await buildSave(evaluated, evaluated.inputs);
  const summary = { ...save.summary, fingerprint: save.fingerprint };
  const started = await startRun(db, session, actor, save.fingerprint);
  const { runId, unchanged } = started;
  try {
    // If every result is what the latest run already holds, that run stands and no copy is saved.
    if (!unchanged) await batchInsert(db, save.rows.map((row, i) => resultStatement(db, runId, sessionId, row, save.hashes[i])), 50);
    const storedBatches = await all(db, "SELECT id, key, run_id, stats FROM batches WHERE session_id = ?", sessionId);
    await batchInsert(db, batchStatements(db, sessionId, runId, diffBatches(storedBatches, save.batches, runId)));
    // Only issues that appeared, changed or went away are written: rewriting them all uses up D1's daily write limit.
    const stored = await all(db, "SELECT key, severity, message, details, accepted FROM exceptions WHERE session_id = ?", sessionId);
    await batchInsert(db, exceptionStatements(db, sessionId, runId, diffExceptions(stored, save.exceptions)));
    const { releasable, all: everyone, cycle } = analyticsFor(save.rows.map(r => Object.fromEntries(RESULT_COLUMNS.map((c, i) => [c, r[i]]))));
    await run(db, "UPDATE runs SET analytics = ?, analytics_cycle = ? WHERE id = ?", JSON.stringify({ releasable, all: everyone }), JSON.stringify(cycle), runId);
    return await finishRun(db, sessionId, actor, { ...started, summary });
  } catch (err) {
    if (!unchanged) await run(db, "UPDATE runs SET status = 'failed', finished_at = datetime('now'), summary = ? WHERE id = ?", JSON.stringify({ error: err.message }), runId);
    throw err;
  }
}

export async function pruneRuns(db, sessionId) {
  const old = await all(db,
    `SELECT id FROM runs WHERE session_id = ? AND id NOT IN (SELECT DISTINCT run_id FROM approvals WHERE session_id = ?)
     ORDER BY started_at DESC LIMIT -1 OFFSET ?`, sessionId, sessionId, KEEP_RUNS);
  for (const r of old) {
    await db.batch([
      db.prepare("DELETE FROM student_results WHERE run_id = ?").bind(r.id),
      db.prepare("DELETE FROM runs WHERE id = ?").bind(r.id)
    ]);
  }
}

// Not the stored analytics (a few hundred KB): only the Analytics pages read those, by themselves.
export async function latestRun(db, sessionId) {
  return first(db, `SELECT id, session_id, started_at, finished_at, triggered_by, engine_version, policy, summary, status FROM runs
    WHERE session_id = ? AND status = 'done' ORDER BY started_at DESC, rowid DESC LIMIT 1`, sessionId);
}
