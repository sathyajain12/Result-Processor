import { json, HttpError } from "../../../../_lib/http.js";
import { all, first } from "../../../../_lib/db.js";
import { approvalMap, studentStatus } from "../../../../_lib/state.js";

// Morning summary: what one morning check (by default today's) found. Sheets newly certified, marks corrected after they
// were fetched, sheets reopened by teachers or with a problem. For each correction: the sheet and teacher it came from,
// what it did to the result (the paper, COMB %, GPA and grade before and after, once a Compute has included it), whether
// the student's result is approved, and whether the office has ticked it as reviewed (marksheets/review.js).
// The morning check runs 05:30–15:30 IST, two sheets a minute, so today's summary fills in through the day.
// Cloudflare's free plan allows 10 ms of CPU a request, so the database unpacks the stored papers (json_each) and only the
// corrected students are read. `brief=1` (the banner on the Batches page) returns the counts only.
const PROBLEM = ["no_access", "template", "missing_data", "error"];
const MAX_CORRECTIONS = 1000;
const FAILED = new Set(["Fails", "Absent"]);

const runOut = r => r && { id: r.id, startedAt: r.started_at, finishedAt: r.finished_at, checked: r.checked, fetched: r.fetched, changed: r.changed, errors: r.errors };
const placeholders = list => list.map(() => "?").join(",");

async function inChunks(list, size, fn) {
  for (let i = 0; i < list.length; i += size) await fn(list.slice(i, i + size));
}

// Each corrected student's result in one run: the student's GPA, grade and state, and each paper's status and COMB %.
async function snapshot(db, runId, regds) {
  const out = new Map();
  await inChunks(regds, 90, async part => {
    const rows = await db.prepare(`SELECT r.regd_no, r.state, r.published_gpa, r.letter_grade,
        json_extract(p.value, '$.paperCode'), json_extract(p.value, '$.courseCode'), json_extract(p.value, '$.status'),
        json_extract(p.value, '$.combPct'), json_extract(p.value, '$.grace') IS NOT NULL
      FROM student_results r JOIN json_each(r.papers) p WHERE r.run_id = ? AND r.regd_no IN (${placeholders(part)})`).bind(runId, ...part).raw();
    for (const [regd, state, gpa, grade, paperCode, courseCode, status, comb, graced] of rows) {
      if (!out.has(regd)) out.set(regd, { state, gpa, grade, papers: new Map() });
      const paper = { status, comb, graced: !!graced };
      const papers = out.get(regd).papers;
      if (paperCode) papers.set(paperCode, paper);
      if (courseCode && !papers.has(courseCode)) papers.set(courseCode, paper);
    }
  });
  return out;
}

const resultIn = (snap, regd, code) => {
  const s = snap?.get(regd);
  if (!s) return null;
  const p = s.papers.get(code);
  return { paper: p?.status ?? null, comb: p?.comb ?? null, graced: p?.graced ?? false, gpa: s.gpa ?? null, grade: s.grade ?? null, state: s.state };
};

export async function onRequestGet({ env, params, request }) {
  const db = env.DB;
  const sid = params.sid;
  const url = new URL(request.url);
  const brief = url.searchParams.get("brief") === "1";
  const wanted = Number(url.searchParams.get("run")) || null;

  const runs = await all(db, `SELECT id, started_at, finished_at, checked, fetched, changed, errors FROM marksheet_runs
    WHERE session_id = ? AND trigger = 'daily' ORDER BY id DESC LIMIT ${brief ? 1 : 14}`, sid);
  const daily = wanted ? runs.find(r => r.id === wanted) || await first(db, `SELECT id, started_at, finished_at, checked, fetched, changed, errors FROM marksheet_runs
    WHERE id = ? AND session_id = ? AND trigger = 'daily'`, wanted, sid) : runs[0];
  if (wanted && !daily) throw new HttpError(404, "That morning check is not in this session");
  const session = await first(db, "SELECT marks_dirty FROM exam_sessions WHERE id = ?", sid);
  if (!daily) return json({ run: null, runs: [], marksDirty: !!session?.marks_dirty });

  const tag = `marksheet:${daily.id}`;
  // Stored times are UTC; the check starts at 05:30 IST, which is 00:00 UTC, so the UTC date is the IST date too.
  const today = new Date().toISOString().slice(0, 10) === String(daily.started_at).slice(0, 10);

  if (brief) {
    const c = await first(db, `SELECT COALESCE(SUM(added > 0), 0) AS newSheets, COALESCE(SUM(added), 0) AS newMarks, COALESCE(SUM(changed + removed), 0) AS corrections,
      COALESCE(SUM(changed + removed > 0), 0) AS correctedSheets, COALESCE(SUM(to_status = 'reopened'), 0) AS reopened,
      COALESCE(SUM(to_status IN (${placeholders(PROBLEM)})), 0) AS problems FROM marksheet_events WHERE run_id = ? AND session_id = ?`, ...PROBLEM, daily.id, sid);
    // Corrections are counted from mark_changes, so checks from before the events table count too; only unreviewed ones raise the alarm.
    let approvedAffected = 0, unreviewed = 0;
    const changes = await all(db, `SELECT c.regd_no, r.change_id IS NOT NULL AS done FROM mark_changes c LEFT JOIN correction_reviews r ON r.change_id = c.id
      WHERE c.sync_id = ? AND c.session_id = ?`, tag, sid);
    const open = changes.filter(x => !x.done);
    unreviewed = open.length;
    if (open.length) {
      const approvals = await approvalMap(db, sid);
      approvedAffected = new Set(open.map(x => x.regd_no).filter(r => approvals.has(r))).size;
    }
    return json({ run: runOut(daily), today, marksDirty: !!session?.marks_dirty, counts: { ...c, corrections: changes.length, unreviewed, approvedAffected } });
  }

  const [events, corrections, due, computes] = await Promise.all([
    // The sheet's own title, teacher and paper code (from the course master or the sheet), looked up by its key.
    all(db, `SELECT e.sheet_key, e.component, e.campus, e.course_code, e.from_status, e.to_status, e.added, e.changed, e.removed, e.error, e.at,
        m.course_title, m.paper_code
      FROM marksheet_events e LEFT JOIN marksheets m ON m.session_id = e.session_id AND m.key = e.sheet_key
      WHERE e.run_id = ? AND e.session_id = ? ORDER BY e.component, e.course_code, e.campus`, daily.id, sid),
    all(db, `SELECT c.id, c.regd_no, c.paper_code, c.component, c.old_raw, c.new_raw, c.changed_at, r.reviewed_by, r.reviewed_at
      FROM mark_changes c LEFT JOIN correction_reviews r ON r.change_id = c.id
      WHERE c.sync_id = ? AND c.session_id = ? ORDER BY c.component, c.paper_code, c.regd_no LIMIT ${MAX_CORRECTIONS + 1}`, tag, sid),
    first(db, "SELECT COUNT(*) AS n FROM marksheets WHERE session_id = ? AND in_master = 1 AND spreadsheet_id IS NOT NULL", sid),
    // Recent Computes, newest first: the one before each correction and the latest one give "before" and "after".
    all(db, "SELECT id, started_at FROM runs WHERE session_id = ? AND status = 'done' ORDER BY started_at DESC, rowid DESC LIMIT 60", sid)
  ]);
  const more = corrections.length > MAX_CORRECTIONS;
  if (more) corrections.length = MAX_CORRECTIONS;
  const latest = computes[0] || null;
  const regds = [...new Set(corrections.map(c => c.regd_no))];

  // Names, approvals and where each result stands now.
  const names = new Map(), current = new Map();
  const approvals = regds.length ? await approvalMap(db, sid) : new Map();
  await inChunks(regds, 90, async part => {
    for (const s of await all(db, `SELECT regd_no, name FROM students WHERE session_id = ? AND regd_no IN (${placeholders(part)})`, sid, ...part)) names.set(s.regd_no, s.name);
    if (latest) for (const r of await all(db, `SELECT regd_no, state, releasable, digest FROM student_results WHERE run_id = ? AND regd_no IN (${placeholders(part)})`, latest.id, ...part)) current.set(r.regd_no, r);
  });

  // Before and after: the Compute just before the correction, and the latest one if it came after the correction.
  const runBefore = at => computes.find(r => r.started_at < at) || null;
  const neededRuns = new Map();   // run id -> students to read in it
  const need = (run, regd) => { if (run) (neededRuns.get(run.id) || neededRuns.set(run.id, new Set()).get(run.id)).add(regd); };
  for (const c of corrections) {
    const before = runBefore(c.changed_at);
    need(before, c.regd_no);
    if (latest && latest.started_at > c.changed_at && latest.id !== before?.id) need(latest, c.regd_no);
  }
  const snaps = new Map();
  for (const [runId, set] of neededRuns) snaps.set(runId, await snapshot(db, runId, [...set]));

  // Which sheet each correction came from: the student's row on the marks list, else (a student removed from the sheet)
  // the sheet of this check with that paper code.
  const rowSheet = new Map();
  for (const component of [...new Set(corrections.map(c => c.component))]) {
    const forComponent = [...new Set(corrections.filter(c => c.component === component).map(c => c.regd_no))];
    await inChunks(forComponent, 90, async part => {
      for (const r of await all(db, `SELECT regd_no, course_code, sheet_key FROM marksheet_rows WHERE session_id = ? AND component = ? AND regd_no IN (${placeholders(part)})`,
        sid, component, ...part)) rowSheet.set(`${component}|${r.regd_no}|${r.course_code}`, r.sheet_key);
    });
  }
  const eventSheet = new Map();
  for (const e of events) if (e.changed + e.removed > 0 && e.paper_code) eventSheet.set(`${e.component}|${e.paper_code}`, e.sheet_key);
  const sheetOf = c => rowSheet.get(`${c.component}|${c.regd_no}|${c.paper_code}`) || eventSheet.get(`${c.component}|${c.paper_code}`) || null;

  const keys = [...new Set([...corrections.map(sheetOf), ...events.map(e => e.sheet_key)].filter(Boolean))];
  const sheets = {};
  await inChunks(keys, 90, async part => {
    for (const s of await all(db, `SELECT key, campus, course_code, course_title, teacher_name, teacher_email, file_url FROM marksheets
        WHERE session_id = ? AND key IN (${placeholders(part)})`, sid, ...part)) {
      sheets[s.key] = { campus: s.campus, courseCode: s.course_code, title: s.course_title, teacher: s.teacher_name, email: s.teacher_email, url: s.file_url };
    }
  });

  // Course titles for corrected papers whose sheet is not known, from the CMF.
  const titles = new Map();
  const untitled = [...new Set(corrections.filter(c => !sheets[sheetOf(c)]?.title).map(c => c.paper_code))];
  await inChunks(untitled, 90, async part => {
    for (const c of await all(db, `SELECT code, title FROM courses WHERE session_id = ? AND code IN (${placeholders(part)})`, sid, ...part)) titles.set(c.code, c.title);
  });

  return json({
    run: runOut(daily), today, runs: runs.map(runOut), sheetsTotal: due?.n ?? 0, marksDirty: !!session?.marks_dirty,
    lastComputedAt: latest?.started_at ?? null,
    sheets,
    events: events.map(e => ({ key: e.sheet_key, component: e.component, campus: e.campus, courseCode: e.course_code, title: e.course_title ?? null,
      from: e.from_status, to: e.to_status, added: e.added, changed: e.changed, removed: e.removed, error: e.error, at: e.at })),
    corrections: corrections.map(c => {
      const a = approvals.get(c.regd_no), now = current.get(c.regd_no);
      const sheetKey = sheetOf(c);
      const beforeRun = runBefore(c.changed_at);
      // Results computed after this correction already include it.
      const computed = !!latest && latest.started_at > c.changed_at;
      const before = beforeRun ? resultIn(snaps.get(beforeRun.id), c.regd_no, c.paper_code) : null;
      const after = computed ? resultIn(snaps.get(latest.id), c.regd_no, c.paper_code) : null;
      const flip = before?.paper && after?.paper
        ? (!FAILED.has(before.paper) && FAILED.has(after.paper) ? "worse" : FAILED.has(before.paper) && !FAILED.has(after.paper) ? "better" : null) : null;
      return {
        id: c.id, regdNo: c.regd_no, name: names.get(c.regd_no) ?? null, paperCode: c.paper_code, component: c.component, sheetKey,
        title: sheets[sheetKey]?.title ?? titles.get(c.paper_code) ?? null,
        old: c.old_raw, new: c.new_raw, at: c.changed_at, approved: !!a, status: now ? studentStatus(now, a) : null, computed,
        before, after, flip,
        reviewed: c.reviewed_by ? { by: c.reviewed_by, at: c.reviewed_at } : null
      };
    }),
    moreCorrections: more
  });
}
