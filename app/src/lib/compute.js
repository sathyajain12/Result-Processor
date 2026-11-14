// Compute, run in the browser. Cloudflare's free plan allows each server request only 10 ms of CPU and grading a session
// takes seconds, so the browser downloads what grading needs (in pages), grades with the same engine the server used
// (shared/compute-core.js), and saves the results back in small pieces. Results are the same as a server Compute.
import { api, enc } from "../api.js";
import { referenceTables, buildInputs, evaluate, baseResults, previousMap, buildSave, diffExceptions, diffBatches, RESULT_COLUMNS } from "../../shared/compute-core.js";
import { analyticsFor } from "../../shared/analytics-core.js";
import { buildReport, liveRows } from "../../shared/completeness-core.js";

const RESULT_PAGE = 20;      // results saved per request (the server allows up to 20)
const CARRY_PAGE = 500;      // unchanged results copied per request (the server allows up to 500)
const CHANGE_PAGE = 60;      // issue changes saved per request (the server allows up to 60)

const objects = ({ fields, rows }) => rows.map(r => Object.fromEntries(fields.map((f, i) => [f, r[i]])));

async function pages(get, onPage) {
  const all = [];
  for (let after = null, guard = 0; guard < 1000; guard++) {
    const page = await get(after);
    all.push(...(page.fields ? objects(page) : page.rows));
    onPage?.(all.length);
    if (!page.next) break;
    after = page.next;
  }
  return all;
}

// Downloads and grades, saving nothing. Used by Compute, and by Completeness' "Check now".
export async function evaluateInBrowser(sid, { onProgress } = {}) {
  const base = `/sessions/${enc(sid)}/calc/inputs`;
  const step = (label, done, total) => onProgress?.({ stage: "load", label, done, total });
  step("Reading the session", 0, null);
  const meta = await api.get(`${base}?part=meta`);
  const part = (name, extra = "") => pages(after => api.get(`${base}?part=${name}${extra}${after ? `&after=${encodeURIComponent(after)}` : ""}`), n => step(`Reading ${name}`, n, null));
  const courses = await part("courses");
  const students = await part("students");
  const marks = await part("marks");
  const previous = await part("previous");
  let baseMap = null, basePrevious = null;
  if (meta.session.kind === "supplementary") {
    const rows = await pages(after => api.get(`${base}?part=base${after ? `&after=${encodeURIComponent(after)}` : ""}`), n => step("Reading the approved base results", n, null));
    baseMap = baseResults(rows, meta.supp.baseSessionId);
    if (!previous.length) basePrevious = previousMap(await part("previous", "&from=base"));
  }
  step("Grading", 0, null);
  await new Promise(r => setTimeout(r, 0));   // let the page show "Grading" before the browser is busy for a second or two
  const inputs = buildInputs({ tables: referenceTables(meta.tables), courses, students, marks, markEdits: meta.markEdits, sld: meta.sld,
    overrides: meta.overrides, previous, thresholds: meta.session.thresholds });
  const evaluated = evaluate(inputs, { kind: meta.session.kind, base: baseMap, attempt: meta.supp?.attempt ?? 1, basePrevious });
  return { meta, inputs, evaluated, raw: { courses, students, marks } };
}

// Completeness as the latest Compute left it, built here from the stored rows (downloaded in pages, several at once).
// On Cloudflare's free plan the server cannot build it within a request's 10 ms of CPU.
export async function storedReportInBrowser(sid, { onProgress } = {}) {
  const base = `/sessions/${enc(sid)}`;
  onProgress?.({ stage: "load", label: "Reading the report", done: 0, total: null });
  const extras = await api.get(`${base}/completeness?part=extras`);
  if (!extras.runId) return { run: null, marksDirty: extras.marksDirty };
  const paged = (path, label) => pages(after => api.get(`${path}${after ? `&after=${encodeURIComponent(after)}` : ""}`), n => onProgress?.({ stage: "load", label, done: n, total: null }));
  const [exceptions, results, batchRows, students, marks, courses] = await Promise.all([
    paged(`${base}/completeness?part=exceptions`, "Reading issues"),
    paged(`${base}/completeness?part=results&runId=${encodeURIComponent(extras.runId)}`, "Reading results"),
    api.get(`${base}/completeness?part=batches&runId=${encodeURIComponent(extras.runId)}`),
    paged(`${base}/calc/inputs?part=students`, "Reading students"),
    paged(`${base}/calc/inputs?part=marks`, "Reading marks"),
    paged(`${base}/calc/inputs?part=courses`, "Reading courses")
  ]);
  // As the server ordered them: by batch, student and paper, blanks first.
  const cmp = (a, b) => (a === b ? 0 : a === null ? -1 : b === null ? 1 : a < b ? -1 : 1);
  exceptions.sort((a, b) => cmp(a.batch_key, b.batch_key) || cmp(a.regd_no, b.regd_no) || cmp(a.paper_code, b.paper_code));
  return {
    run: { id: extras.runId, startedAt: extras.lastComputedAt }, marksDirty: extras.marksDirty,
    ...buildReport({ exceptions, batches: batchRows.rows, results, students, marks, courses, overrides: extras.overrides, detentionRows: extras.detentionRows })
  };
}

// Completeness' "Check now": the report from grading the marks, CMF and SMF as they are now, saving nothing.
export async function checkInBrowser(sid, { onProgress } = {}) {
  const { evaluated, raw } = await evaluateInBrowser(sid, { onProgress });
  onProgress?.({ stage: "report", label: "Building the report", done: 0, total: null });
  const extras = await api.get(`/sessions/${enc(sid)}/completeness?part=extras`);
  const rows = liveRows(evaluated.out, new Map(extras.batchIds.map(b => [b.key, b.id])));
  return {
    run: { live: true, checkedAt: new Date().toISOString(), lastComputedAt: extras.lastComputedAt }, marksDirty: extras.marksDirty,
    ...buildReport({ ...rows, students: raw.students, marks: raw.marks, courses: raw.courses, overrides: extras.overrides, detentionRows: extras.detentionRows })
  };
}

// The whole Compute. Returns what the old server Compute returned: { runId, unchanged, students, releasable, held, withheld, ... }.
export async function computeInBrowser(sid, { onProgress } = {}) {
  const root = `/sessions/${enc(sid)}/calc`;
  const { inputs, evaluated } = await evaluateInBrowser(sid, { onProgress });
  onProgress?.({ stage: "save", label: "Preparing the results", done: 0, total: null });
  const save = await buildSave(evaluated, inputs);
  const summary = { ...save.summary, fingerprint: save.fingerprint };

  const { unchanged, runId, previousRunId } = await api.post(`${root}/start`, { fingerprint: save.fingerprint });
  let changed = 0;
  if (!unchanged) {
    // Only results that differ from the latest run are sent; the database copies the rest from it.
    let send = save.rows.map((_, i) => i);
    if (previousRunId) {
      onProgress?.({ stage: "save", label: "Comparing with the last results", done: 0, total: null });
      const stored = new Map((await pages(after => api.get(`${root}/hashes?runId=${encodeURIComponent(previousRunId)}${after ? `&after=${encodeURIComponent(after)}` : ""}`)))
        .map(r => [r.regdNo, r.hash]));
      const same = [];
      send = [];
      save.rows.forEach((r, i) => (stored.get(r[0]) && stored.get(r[0]) === save.hashes[i] ? same : send).push(i));
      for (let i = 0; i < same.length; i += CARRY_PAGE) {
        onProgress?.({ stage: "save", label: "Keeping unchanged results", done: i, total: same.length });
        await api.post(`${root}/carry`, { runId, from: previousRunId, regdNos: same.slice(i, i + CARRY_PAGE).map(j => save.rows[j][0]) });
      }
    }
    changed = send.length;
    for (let i = 0; i < send.length; i += RESULT_PAGE) {
      onProgress?.({ stage: "save", label: "Saving changed results", done: i, total: send.length });
      const part = send.slice(i, i + RESULT_PAGE);
      await api.post(`${root}/results`, { runId, rows: part.map(j => save.rows[j]), hashes: part.map(j => save.hashes[j]) });
    }
  }
  onProgress?.({ stage: "save", label: "Saving batches", done: 0, total: null });
  const { batches: storedBatches } = await api.get(`${root}/batches`);
  const upserts = diffBatches(storedBatches, save.batches, runId);
  for (let i = 0; i < upserts.length; i += CHANGE_PAGE) await api.post(`${root}/batches`, { runId, upserts: upserts.slice(i, i + CHANGE_PAGE) });

  onProgress?.({ stage: "save", label: "Saving issues", done: 0, total: null });
  const stored = await pages(after => api.get(`${root}/exceptions${after ? `?after=${encodeURIComponent(after)}` : ""}`));
  const { inserts, updates, deletes } = diffExceptions(stored, save.exceptions);
  const changes = [...inserts.map(e => ["inserts", e]), ...updates.map(e => ["updates", e]), ...deletes.map(k => ["deletes", k])];
  for (let i = 0; i < changes.length; i += CHANGE_PAGE) {
    onProgress?.({ stage: "save", label: "Saving issues", done: i, total: changes.length });
    const body = { runId, inserts: [], updates: [], deletes: [] };
    for (const [kind, v] of changes.slice(i, i + CHANGE_PAGE)) body[kind].push(v);
    await api.post(`${root}/exceptions`, body);
  }
  // The Analytics pages show what is worked out here, once, rather than adding up every result on each visit.
  onProgress?.({ stage: "save", label: "Saving analytics", done: 0, total: null });
  const objectsOf = save.rows.map(r => Object.fromEntries(RESULT_COLUMNS.map((c, i) => [c, r[i]])));
  const { releasable, all, cycle } = analyticsFor(objectsOf);
  await api.postText(`${root}/analytics?runId=${encodeURIComponent(runId)}`, `{"analytics":${JSON.stringify({ releasable, all })},"cycle":${JSON.stringify(cycle)}}`);

  onProgress?.({ stage: "save", label: "Finishing", done: 0, total: null });
  return { ...(await api.post(`${root}/finish`, { runId, unchanged, summary })), changedResults: unchanged ? 0 : changed };
}

// The usual message after a Compute.
export const computedMessage = r => `${r.unchanged ? "Nothing changed since the last compute" : "Computed"}: ${r.releasable} of ${r.students} results ready`
  + (!r.unchanged && typeof r.changedResults === "number" ? ` (${r.changedResults.toLocaleString()} result${r.changedResults === 1 ? "" : "s"} changed)` : "");

// One Compute at a time, shown by <ComputeStatus> on every session page. Pages call compute(sid) in place of the old
// POST /compute. Leaving the page while results are being saved asks first (the run would be left unfinished).
let current = null;
const listeners = new Set();
const publish = value => { current = value; for (const f of listeners) f(value); };
export const computeState = { subscribe: f => { listeners.add(f); return () => listeners.delete(f); }, get: () => current };

export async function compute(sid) {
  if (current) throw new Error("A Compute is already running; wait for it to finish");
  const leave = e => { e.preventDefault(); e.returnValue = ""; };
  publish({ stage: "load", label: "Starting", done: 0, total: null });
  window.addEventListener("beforeunload", leave);
  try {
    return await computeInBrowser(sid, { onProgress: publish });
  } finally {
    window.removeEventListener("beforeunload", leave);
    publish(null);
  }
}
