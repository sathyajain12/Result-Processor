// Results analytics (pass rates, grades, GPA spread, per course and batch) from stored result rows. Shared by the server and
// the browser, which works them out during Compute so the Analytics pages only read what was stored.
const parseJson = (v, fallback = null) => {
  if (v === null || v === undefined || v === "") return fallback;
  try { return JSON.parse(v); } catch { return fallback; }
};

const round = (v, dp = 1) => (v === null || v === undefined ? null : Math.round(v * 10 ** dp) / 10 ** dp);
const pct = (n, d) => (d ? round((n / d) * 100) : null);

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function gpaSpread(values) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return { n: 0, mean: null, min: null, q1: null, median: null, q3: null, max: null };
  return {
    n: v.length, mean: round(v.reduce((a, b) => a + b, 0) / v.length, 2),
    min: v[0], q1: round(quantile(v, 0.25), 2), median: round(quantile(v, 0.5), 2), q3: round(quantile(v, 0.75), 2), max: v[v.length - 1]
  };
}

// Per-paper (or per-course) pass/fail counts and mean percentages. `keyOf` picks the grouping.
export function aggregatePapers(papers, keyOf = p => p.paperCode) {
  const map = new Map();
  for (const p of papers) {
    const key = keyOf(p);
    const s = map.get(key) || { key, paperCode: p.paperCode, courseCode: p.courseCode, title: p.title, credits: p.credits,
      students: 0, pass: 0, fail: 0, absent: 0, pending: 0, error: 0, comb: [0, 0], cie: [0, 0], ese: [0, 0] };
    s.students++;
    if (p.status === "Pass") s.pass++;
    else if (p.status === "Fails") s.fail++;
    else if (p.status === "Absent") s.absent++;
    else if (p.status === "Pending") s.pending++;
    else s.error++;
    if (p.status !== "Pending") {
      for (const [k, v] of [["comb", p.combPct], ["cie", p.ciePct], ["ese", p.eseComptPct]]) if (typeof v === "number") { s[k][0] += v; s[k][1]++; }
    }
    map.set(key, s);
  }
  return [...map.values()].map(({ comb, cie, ese, ...s }) => ({
    ...s,
    meanComb: comb[1] ? Math.round(comb[0] / comb[1]) : null,
    meanCie: cie[1] ? Math.round(cie[0] / cie[1]) : null,
    meanEse: ese[1] ? Math.round(ese[0] / ese[1]) : null,
    passRate: pct(s.pass, s.pass + s.fail + s.absent)
  }));
}

const outcome = r => {
  if (r.state === "Withheld") return "withheld";
  if (r.state !== "Result") return "held";
  if (r.published_gpa === "Absent") return "absent";
  if (r.published_gpa === "Fail") return "failed";
  return "passed";
};

function summarise(rows) {
  const c = { students: rows.length, passed: 0, failed: 0, absent: 0, withheld: 0, held: 0 };
  const gpas = [];
  for (const r of rows) {
    c[outcome(r)]++;
    const g = Number(r.published_gpa);
    if (r.state === "Result" && r.published_gpa !== null && Number.isFinite(g)) gpas.push(g);
  }
  return { ...c, passPct: pct(c.passed, c.passed + c.failed + c.absent), gpa: gpaSpread(gpas) };
}

// rows: student_results rows of one run. scope "releasable" keeps only results that can be approved.
export function aggregate(rows, { scope = "releasable" } = {}) {
  const shown = scope === "all" ? rows : rows.filter(r => r.releasable);
  const gradeDistribution = {};
  const histogram = Array.from({ length: 20 }, (_, i) => ({ from: i / 2, to: i / 2 + 0.5, count: 0 }));
  const byBatch = new Map(), byProgramme = new Map();
  const papers = [];

  for (const r of shown) {
    const o = outcome(r);
    if (o === "passed" || o === "failed" || o === "absent") {
      const g = o === "passed" ? r.letter_grade || "No grade" : o === "failed" ? "Fail" : "Absent";
      gradeDistribution[g] = (gradeDistribution[g] || 0) + 1;
    }
    const gpa = Number(r.published_gpa);
    if (o === "passed" && Number.isFinite(gpa)) histogram[Math.min(19, Math.floor(gpa * 2))].count++;
    const [programme, semester, batch] = r.batch_key.split("|");
    (byBatch.get(r.batch_key) || byBatch.set(r.batch_key, { key: r.batch_key, programme, semester, batch, rows: [] }).get(r.batch_key)).rows.push(r);
    (byProgramme.get(programme) || byProgramme.set(programme, { programme, rows: [] }).get(programme)).rows.push(r);
    for (const p of parseJson(r.papers, [])) papers.push(p);
  }

  const byCourse = aggregatePapers(papers, p => p.courseCode || p.paperCode).sort((a, b) => a.key.localeCompare(b.key));
  const hardest = byCourse.filter(c => c.students >= 10 && c.passRate !== null)
    .sort((a, b) => a.passRate - b.passRate || (a.meanComb ?? 0) - (b.meanComb ?? 0)).slice(0, 10);

  return {
    scope,
    totals: summarise(shown),
    gradeDistribution,
    histogram,
    byBatch: [...byBatch.values()].map(({ rows: rs, ...b }) => ({ ...b, ...summarise(rs) })).sort((a, b) => a.key.localeCompare(b.key)),
    byProgramme: [...byProgramme.values()].map(({ rows: rs, ...p }) => ({ ...p, ...summarise(rs) })).sort((a, b) => a.programme.localeCompare(b.programme)),
    byCourse,
    hardest
  };
}

// ── Stored with each run (Compute works them out, in the browser on the live site) ──

const COUNT_KEYS = ["students", "passed", "failed", "absent", "withheld", "held"];

// What a cycle's overview needs from one session (releasable results, as aggregate's default): per programme and in total,
// the counts and every GPA, so sessions can be combined exactly (GPA quartiles cannot be added up, the GPAs can).
export function cycleParts(rows) {
  const part = () => ({ students: 0, passed: 0, failed: 0, absent: 0, withheld: 0, held: 0, gpas: [] });
  const totals = part(), programmes = {};
  for (const r of rows.filter(x => x.releasable)) {
    const programme = r.batch_key.split("|")[0];
    const p = (programmes[programme] ||= part());
    const o = outcome(r);
    const g = Number(r.published_gpa);
    for (const t of [totals, p]) {
      t.students++; t[o]++;
      if (r.state === "Result" && r.published_gpa !== null && Number.isFinite(g)) t.gpas.push(g);
    }
  }
  return { totals, programmes };
}

const fromPart = ({ gpas, ...c }) => ({ ...c, passPct: pct(c.passed, c.passed + c.failed + c.absent), gpa: gpaSpread(gpas) });

// One session's overview, or several sessions combined, in the shape aggregate() gives (totals, byProgramme).
export function combineCycle(partsList) {
  const add = (into, from) => { for (const k of COUNT_KEYS) into[k] += from[k]; into.gpas.push(...from.gpas); return into; };
  const empty = () => ({ students: 0, passed: 0, failed: 0, absent: 0, withheld: 0, held: 0, gpas: [] });
  const totals = empty(), programmes = {};
  for (const parts of partsList) {
    add(totals, parts.totals);
    for (const [programme, p] of Object.entries(parts.programmes)) add(programmes[programme] ||= empty(), p);
  }
  return {
    totals: fromPart(totals),
    byProgramme: Object.entries(programmes).map(([programme, p]) => ({ programme, ...fromPart(p) })).sort((a, b) => a.programme.localeCompare(b.programme))
  };
}

// Everything the Analytics pages show for one run, from its result rows (objects with the stored column names).
export function analyticsFor(rows) {
  return { releasable: aggregate(rows, { scope: "releasable" }), all: aggregate(rows, { scope: "all" }), cycle: cycleParts(rows) };
}
