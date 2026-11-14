import { normalizeRegdNo } from "../../../engine/src/index.js";
import { all, first, run, batchInsert, parseJson } from "./db.js";
import { readSheet, readLayout, readRanges, listSpreadsheets, SheetAccessError } from "./google.js";

// Mark sheets: read the course masters (never written to), keep a list of every teacher's Marks Statement,
// and fetch certified marks straight into the session. Port of the Fetch CIE / Fetch ESE Apps Scripts.

export const folderIdOf = url => String(url || "").match(/\/folders\/([a-zA-Z0-9-_]+)/)?.[1] || (/^[a-zA-Z0-9-_]{20,}$/.test(String(url || "").trim()) ? String(url).trim() : null);
export const spreadsheetIdOf = url => String(url || "").match(/\/d\/([a-zA-Z0-9-_]+)/)?.[1] || (/^[a-zA-Z0-9-_]{25,}$/.test(String(url || "").trim()) ? String(url).trim() : null);

// Headers are compared in upper case with any bracketed note dropped, so "Course Code (CC)" matches "COURSE CODE".
const H = s => String(s ?? "").replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim().toUpperCase();
const MASTER_COLUMNS = {
  programme: ["PROGRAMME SHORT NAME", "PROGRAMME", "PROGRAM"],
  courseCode: ["COURSE CODE", "PAPER CODE"],
  courseTitle: ["COURSE TITLE", "PAPER TITLE"],
  courseType: ["COURSE TYPE", "PAPER TYPE"],
  semester: ["SEMESTER"],
  campus: ["CAMPUS"],
  teacherName: ["TEACHER_NAME", "TEACHER NAME", "T1"],
  teacherEmail: ["TEACHER_EMAIL", "TEACHER EMAIL"],
  maxMarks: ["CIE MAX", "ESE MAX"],
  dueDate: ["DUE DATE"],
  examDate: ["DATE OF EXAM"],
  fileUrl: ["MARKS FILE URL", "MARKS FILE"]
};
export const CAMPUSES = ["ATP", "BRN", "NDG", "PSN"];
// Campus from a course master's file name, as the Apps Script did (Course_Master-Apr 2026-PSN gives PSN); none for "-ALL".
export const campusFromTitle = title => { const c = String(title || "").trim().slice(-3).toUpperCase(); return CAMPUSES.includes(c) ? c : null; };

// Google returns dates as serial numbers when values are unformatted; typed dates like "24 - 10 - 2026" are day-month-year.
const asDate = v => {
  if (typeof v === "number" && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  if (v === null || v === undefined || v === "") return null;
  const m = String(v).trim().match(/^(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : String(v).trim();
};
const text = v => (v === null || v === undefined || v === "" ? null : String(v).trim());

// Read one course master into Mark sheet rows (the old Tracking Sheet). Columns are found by header name.
export function parseMaster(values, master) {
  if (!values?.length) return { rows: [], warnings: ["The course master is empty"] };
  const head = values[0].map(H);
  const col = Object.fromEntries(Object.entries(MASTER_COLUMNS).map(([k, names]) => [k, head.findIndex(h => names.includes(h))]));
  const missing = ["courseCode", "fileUrl"].filter(k => col[k] < 0);
  if (missing.length) return { rows: [], warnings: [`Course master has no ${missing.map(k => k === "fileUrl" ? '"Marks File Url"' : '"Course Code"').join(" or ")} column`] };
  const get = (r, k) => (col[k] >= 0 ? r[col[k]] : null);
  const rows = [];
  values.slice(1).forEach((r, i) => {
    const code = text(get(r, "courseCode"));
    if (!code) return;
    const url = text(get(r, "fileUrl"));
    const sheetId = spreadsheetIdOf(url);
    // A combined course master ("-ALL") gives each row's campus in a Campus column; a per-campus one names it in the file name.
    const campus = (text(get(r, "campus")) || "").toUpperCase() || master.campus || null;
    rows.push({
      key: `${master.component}|${campus || ""}|${sheetId || `row${i + 2}:${code}`}`,
      component: master.component, campus, masterId: master.id,
      programme: text(get(r, "programme")), courseCode: code, courseTitle: text(get(r, "courseTitle")), courseType: text(get(r, "courseType")),
      semester: text(get(r, "semester")), teacherName: text(get(r, "teacherName")), teacherEmail: text(get(r, "teacherEmail")),
      maxMarks: Number.isFinite(Number(get(r, "maxMarks"))) && get(r, "maxMarks") !== "" ? Number(get(r, "maxMarks")) : null,
      dueDate: asDate(get(r, "dueDate")), examDate: asDate(get(r, "examDate")), fileUrl: url, spreadsheetId: sheetId
    });
  });
  return { rows, warnings: [] };
}

// A folder of Marks Statements: one row per Google Sheet in it (and its subfolders). Files named like a course master are
// skipped. The campus comes from the file name ("MBAG-303(F-FRM)_BRN"), else the folder name, else the link; the course
// code is the file name without the campus. Programme, semester, title and teacher are filled in from the sheet itself.
export function folderRows(files, master) {
  const rows = [];
  for (const f of files) {
    if (/course[\s_-]*master/i.test(f.name)) continue;
    const m = String(f.name).trim().match(/^(.*?)[\s_-]+(ATP|BRN|NDG|PSN)$/i);
    const campus = (m?.[2] || campusFromTitle(f.folder) || master.campus || "").toUpperCase() || null;
    rows.push({
      key: `${master.component}|${campus || ""}|${f.id}`, component: master.component, campus, masterId: master.id,
      programme: null, courseCode: (m ? m[1] : f.name).trim(), courseTitle: null, courseType: null, semester: null,
      teacherName: null, teacherEmail: null, maxMarks: null, dueDate: null, examDate: null,
      fileUrl: `https://docs.google.com/spreadsheets/d/${f.id}/edit`, spreadsheetId: f.id
    });
  }
  return rows;
}

// Rebuild the Mark sheets list from every linked course master or folder. Fetch progress on existing rows is kept.
// With `component`, only that component's course masters / folders are read.
export async function refreshList(env, sessionId, component = null) {
  const db = env.DB;
  const masters = (await all(db, "SELECT * FROM marksheet_masters WHERE session_id = ? ORDER BY component, campus", sessionId))
    .filter(m => !component || m.component === component);
  const seen = new Set();
  const report = [];
  // The list is written only where it changed: re-saving every sheet each morning costs a write per sheet for nothing.
  const stored = new Map((await all(db, `SELECT key, master_id, in_master, course_code, programme, course_title, course_type, semester, teacher_name, teacher_email,
    max_marks, due_date, exam_date, file_url, spreadsheet_id FROM marksheets WHERE session_id = ?`, sessionId)).map(r => [r.key, r]));
  const same = (a, b) => String(a ?? "") === String(b ?? "");
  // Fields the upsert below keeps as they are when the new value is blank.
  const unchangedRow = (r, s) => s && s.in_master === 1 && same(s.master_id, r.masterId) && same(s.course_code, r.courseCode) && same(s.file_url, r.fileUrl) && same(s.spreadsheet_id, r.spreadsheetId)
    && [[r.programme, s.programme], [r.courseTitle, s.course_title], [r.courseType, s.course_type], [r.semester, s.semester], [r.teacherName, s.teacher_name],
        [r.teacherEmail, s.teacher_email], [r.maxMarks, s.max_marks], [r.dueDate, s.due_date], [r.examDate, s.exam_date]].every(([n, o]) => n === null || n === undefined || same(n, o));
  for (const m of masters) {
    try {
      const { rows, warnings } = m.kind === "folder"
        ? { rows: folderRows(await listSpreadsheets(env, m.spreadsheet_id), m), warnings: [] }
        : parseMaster(await readSheet(env, m.spreadsheet_id, m.sheet_name || "Sheet1"), m);
      await batchInsert(db, rows.filter(r => !unchangedRow(r, stored.get(r.key))).map(r => db.prepare(
        `INSERT INTO marksheets (session_id, key, master_id, component, campus, programme, course_code, course_title, course_type, semester,
           teacher_name, teacher_email, max_marks, due_date, exam_date, file_url, spreadsheet_id, in_master, status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1, CASE WHEN ? IS NULL THEN 'no_file' ELSE 'pending' END)
         ON CONFLICT (session_id, key) DO UPDATE SET master_id = excluded.master_id, course_code = excluded.course_code,
           programme = COALESCE(excluded.programme, marksheets.programme), course_title = COALESCE(excluded.course_title, marksheets.course_title),
           course_type = COALESCE(excluded.course_type, marksheets.course_type), semester = COALESCE(excluded.semester, marksheets.semester),
           teacher_name = COALESCE(excluded.teacher_name, marksheets.teacher_name), teacher_email = COALESCE(excluded.teacher_email, marksheets.teacher_email),
           max_marks = COALESCE(excluded.max_marks, marksheets.max_marks), due_date = COALESCE(excluded.due_date, marksheets.due_date),
           exam_date = COALESCE(excluded.exam_date, marksheets.exam_date), file_url = excluded.file_url, spreadsheet_id = excluded.spreadsheet_id, in_master = 1`
      ).bind(sessionId, r.key, r.masterId, r.component, r.campus, r.programme, r.courseCode, r.courseTitle, r.courseType, r.semester,
        r.teacherName, r.teacherEmail, r.maxMarks, r.dueDate, r.examDate, r.fileUrl, r.spreadsheetId, r.spreadsheetId)));
      rows.forEach(r => seen.add(r.key));
      await run(db, "UPDATE marksheet_masters SET last_read_at = datetime('now'), row_count = ?, last_error = ? WHERE id = ?", rows.length, warnings[0] || null, m.id);
      report.push({ id: m.id, component: m.component, campus: m.campus, rows: rows.length, warnings });
    } catch (err) {
      await run(db, "UPDATE marksheet_masters SET last_read_at = datetime('now'), last_error = ? WHERE id = ?", err.message, m.id);
      report.push({ id: m.id, component: m.component, campus: m.campus, rows: 0, error: err.message });
    }
  }
  // Rows no longer in any master that could be read are kept (their marks stay) but flagged.
  const readOk = new Set(report.filter(r => !r.error).map(r => r.id));
  for (const r of stored.values()) {
    if (r.in_master === 1 && !seen.has(r.key) && readOk.has(r.master_id)) await run(db, "UPDATE marksheets SET in_master = 0 WHERE session_id = ? AND key = ?", sessionId, r.key);
  }
  return report;
}

const colLetter = n => { let s = ""; n += 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const quote = t => `'${String(t).replace(/'/g, "''")}'`;
const yes = v => String(v ?? "").trim().toLowerCase() === "yes";

// Read one teacher's Marks Statement: certification cells and, when ready, every student's marks.
// Same rules as the Apps Scripts: CIE needs certified + all filled; ESE also needs validation;
// internship papers (code with -INT at characters 5-8) are taken row by row when a row is marked ready.
export async function readMarksStatement(env, spreadsheetId, component) {
  const layout = await readLayout(env, spreadsheetId);
  const titles = new Map((layout.sheets || []).map(s => [s.properties.sheetId, s.properties.title]));
  const named = new Map((layout.namedRanges || []).map(n => [n.name, n.range]));
  const pick = (...names) => names.map(n => named.get(n)).find(Boolean) || null;
  const cell = r => `${quote(titles.get(r.sheetId ?? 0) ?? "Marks Statement")}!${colLetter(r.startColumnIndex ?? 0)}${(r.startRowIndex ?? 0) + 1}`;

  const start = pick("marksStatementRegdNoStart");
  const certify = component === "ESE" ? pick("examinerCertifyCell", "certifyCell") : pick("certifyCell", "examinerCertifyCell");
  const marks = component === "CIE" ? pick("cieTotalMarks", "totalMarks") : pick("totalMarks");
  const need = { marksStatementRegdNoStart: start, numStudentsCell: pick("numStudentsCell"), paperCode: pick("paperCode"), allFilledCell: pick("allFilledCell"),
    [component === "ESE" ? "examinerCertifyCell" : "certifyCell"]: certify, [component === "CIE" ? "cieTotalMarks" : "totalMarks"]: marks };
  const missing = Object.entries(need).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) return { status: "template", error: `Marks Statement template is missing named cell(s): ${missing.join(", ")}` };

  const validation = pick("validationCell"), teacher = pick("teacher"), ready = pick("ready"), title = pick("paperTitle"), maxMarks = pick("maxMarks", "qnPaperTotalMarks");
  // Optional: the sheet's own percent and num. points columns, shown on the CIE / ESE marks tabs.
  const percent = component === "CIE" ? pick("ciePercent") : pick("esePercent");
  const points = component === "CIE" ? pick("cieNP") : pick("eseNP");
  const singles = [need.numStudentsCell, need.paperCode, need.allFilledCell, certify, validation, teacher, title, maxMarks].map(r => (r ? cell(r) : null));
  const sheetTitle = titles.get(start.sheetId ?? 0) ?? "Marks Statement";
  const firstRow = (start.startRowIndex ?? 0) + 1;
  const colOf = r => (r ? r.startColumnIndex ?? 0 : null);
  const cols = { regd: colOf(start), marks: colOf(marks), ready: colOf(ready), percent: colOf(percent), points: colOf(points) };
  const lastCol = Math.max(1, cols.regd, cols.marks, cols.ready ?? 0, cols.percent ?? 0, cols.points ?? 0);
  const block = `${quote(sheetTitle)}!A${firstRow}:${colLetter(lastCol)}${firstRow + 1999}`;
  const got = await readRanges(env, spreadsheetId, [...singles.filter(Boolean), block]);
  const values = {};
  let i = 0;
  ["num", "paper", "allFilled", "certified", "validation", "teacher", "title", "max"].forEach((k, j) => { if (singles[j]) values[k] = got[i++]?.[0]?.[0]; });
  const rows = got[i] || [];

  const paperCode = text(values.paper);
  const n = Math.max(0, Math.min(2000, Number(values.num) || 0));
  const flags = { certified: yes(values.certified), allFilled: yes(values.allFilled), validated: validation ? yes(values.validation) : null };
  const base = { paperCode, students: n, teacher: text(values.teacher), title: text(values.title), maxMarks: Number.isFinite(Number(values.max)) && values.max !== "" ? Number(values.max) : null, ...flags };
  if (!paperCode || !normalizeRegdNo(rows[0]?.[cols.regd])) return { ...base, status: "missing_data", error: "Paper code or the first Regd No is blank in the Marks Statement" };

  const cellValue = (r, c) => (c === null || r[c] === undefined || r[c] === "" ? null : r[c]);
  const studentRows = rows.slice(0, n).map((r, i) => ({
    regdNo: normalizeRegdNo(r[cols.regd]), programme: text(r[0]), semester: text(r[1]), rowNo: firstRow + i,
    raw: cellValue(r, cols.marks), percent: cellValue(r, cols.percent), points: cellValue(r, cols.points),
    ready: cols.ready !== null ? yes(r[cols.ready]) : false
  })).filter(r => r.regdNo);
  base.programme = studentRows.find(r => r.programme)?.programme ?? null;
  base.semester = studentRows.find(r => r.semester)?.semester ?? null;

  const complete = flags.certified && flags.allFilled;
  if (component === "ESE" && complete && validation && !flags.validated) return { ...base, status: "validation", error: "Certified, but the validation check is not Yes" };
  if (complete) return { ...base, status: "fetched", marks: studentRows };
  const internship = component === "CIE" && paperCode.substring(4, 8) === "-INT";
  if (internship && ready) {
    const done = studentRows.filter(r => r.ready && r.raw !== null);
    if (done.length) return { ...base, status: done.length === studentRows.length ? "fetched" : "partial", marks: done, partial: done.length < studentRows.length };
  }
  return { ...base, status: "filling" };
}

const pairKey = (regd, paper) => `${regd}|${paper}`;

// Which tab holds the Marks Statement: the one with the marksStatementRegdNoStart named range, else one called
// "Marks Statement", else the first.
export async function marksStatementTab(env, spreadsheetId) {
  const layout = await readLayout(env, spreadsheetId);
  const tabs = (layout.sheets || []).map(t => t.properties);
  const start = (layout.namedRanges || []).find(n => n.name === "marksStatementRegdNoStart")?.range;
  const tab = (start && tabs.find(t => t.sheetId === (start.sheetId ?? 0))) || tabs.find(t => /marks statement/i.test(t.title)) || tabs[0];
  if (!tab) return null;
  const onTab = r => r && (r.sheetId ?? 0) === tab.sheetId;
  const num = (layout.namedRanges || []).find(n => n.name === "numStudentsCell" && onTab(n.range))?.range;
  return { gid: tab.sheetId, title: tab.title, file: layout.properties?.title ?? null,
    firstStudentRow: onTab(start) ? start.startRowIndex ?? null : null,
    numStudentsCell: num ? `${quote(tab.title)}!${colLetter(num.startColumnIndex ?? 0)}${(num.startRowIndex ?? 0) + 1}` : null };
}

// Store a sheet's marks: new marks are added, changed ones recorded as corrections, students who left the sheet removed.
async function applyMarks(db, sessionId, sheet, result, runTag) {
  const component = sheet.component;
  const previous = new Set(parseJson(sheet.regd_nos, []));
  const incoming = new Map(result.marks.map(m => [pairKey(m.regdNo, result.paperCode), m.raw === null ? null : String(m.raw)]));
  // Students now on the sheet plus those on it last time (to notice removals), looked up in one go.
  const regds = [...new Set([...result.marks.map(m => m.regdNo), ...[...previous].map(k => k.split("|")[0])])];
  // The paper code now, and any the sheet had before: when a sheet's code is corrected (noc26_ma102 to
  // UMAT-704(noc26_ma102)), its marks under the old code are found and removed below, not left behind as a stray paper.
  const codes = [...new Set([result.paperCode, ...[...previous].map(k => k.slice(k.indexOf("|") + 1))])];
  const existing = new Map();
  for (let i = 0; i < regds.length; i += 60) {   // D1 takes at most 100 values per query
    const part = regds.slice(i, i + 60);
    for (const m of await all(db, `SELECT regd_no, paper_code, raw FROM marks WHERE session_id = ? AND component = ?
        AND paper_code IN (${codes.map(() => "?").join(",")}) AND regd_no IN (${part.map(() => "?").join(",")})`,
      sessionId, component, ...codes, ...part)) existing.set(pairKey(m.regd_no, m.paper_code), m.raw);
  }
  const stmts = [];
  let added = 0, changed = 0, removed = 0;
  for (const [k, raw] of incoming) {
    const [regd, paper] = k.split("|");
    if (!existing.has(k)) {
      added++;
      stmts.push(db.prepare(`INSERT INTO marks (session_id, regd_no, paper_code, component, raw) VALUES (?,?,?,?,?)
        ON CONFLICT (session_id, regd_no, paper_code, component) DO UPDATE SET raw = excluded.raw, updated_at = datetime('now')`)
        .bind(sessionId, regd, paper, component, raw));
    } else if (existing.get(k) !== raw) {
      changed++;
      stmts.push(db.prepare("UPDATE marks SET raw = ?, updated_at = datetime('now') WHERE session_id = ? AND regd_no = ? AND paper_code = ? AND component = ?").bind(raw, sessionId, regd, paper, component));
      stmts.push(db.prepare("INSERT INTO mark_changes (session_id, regd_no, paper_code, component, old_raw, new_raw, sync_id) VALUES (?,?,?,?,?,?,?)")
        .bind(sessionId, regd, paper, component, existing.get(k), raw, runTag));
    }
  }
  // Partial (internship) fetches only add rows; a full fetch also drops students no longer on the sheet.
  if (!result.partial) {
    for (const k of previous) {
      if (incoming.has(k)) continue;
      const [regd, paper] = k.split("|");
      if (!existing.has(k)) continue;
      const old = { raw: existing.get(k) };
      removed++;
      stmts.push(db.prepare("DELETE FROM marks WHERE session_id = ? AND regd_no = ? AND paper_code = ? AND component = ?").bind(sessionId, regd, paper, component));
      stmts.push(db.prepare("INSERT INTO mark_changes (session_id, regd_no, paper_code, component, old_raw, new_raw, sync_id) VALUES (?,?,?,?,?,NULL,?)")
        .bind(sessionId, regd, paper, component, old.raw, runTag));
    }
  }
  stmts.push(...await rowStatements(db, sessionId, sheet, result));
  const keep = result.partial ? [...new Set([...previous, ...incoming.keys()])] : [...incoming.keys()];
  return { added, changed, removed, keys: keep, stmts };
}

// These columns hold numbers or text, so rows are compared as strings.
const rowSignature = values => values.map(v => String(v ?? "")).join("\u0001");

// Keep the sheet's rows as shown (marks, percent, num. points, programme, semester) for the CIE / ESE marks tabs.
// Only rows that differ are written, because rewriting unchanged sheets every day uses up D1's daily write limit.
// A full fetch also removes students who left the sheet; a partial (internship) fetch only adds or updates rows.
async function rowStatements(db, sessionId, sheet, result) {
  const stored = new Map((await all(db, `SELECT regd_no, course_code, campus, marks, percent, num_points, programme, semester, row_no
      FROM marksheet_rows WHERE session_id = ? AND component = ? AND sheet_key = ?`, sessionId, sheet.component, sheet.key))
    .map(r => [r.regd_no, rowSignature([r.course_code, r.campus, r.marks, r.percent, r.num_points, r.programme, r.semester, r.row_no])]));
  const incoming = new Map(result.marks.map(m => [m.regdNo, m]));
  const stmts = [];
  if (!result.partial) {
    for (const regd of stored.keys()) {
      if (!incoming.has(regd)) stmts.push(db.prepare("DELETE FROM marksheet_rows WHERE session_id = ? AND component = ? AND sheet_key = ? AND regd_no = ?").bind(sessionId, sheet.component, sheet.key, regd));
    }
  }
  for (const m of incoming.values()) {
    if (stored.get(m.regdNo) === rowSignature([result.paperCode, sheet.campus, m.raw, m.percent, m.points, m.programme, m.semester, m.rowNo])) continue;
    stmts.push(db.prepare(`INSERT INTO marksheet_rows (session_id, component, sheet_key, regd_no, course_code, campus, marks, percent, num_points, programme, semester, row_no)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT (session_id, component, sheet_key, regd_no) DO UPDATE SET course_code = excluded.course_code, campus = excluded.campus, marks = excluded.marks,
        percent = excluded.percent, num_points = excluded.num_points, programme = excluded.programme, semester = excluded.semester, row_no = excluded.row_no`)
      .bind(sessionId, sheet.component, sheet.key, m.regdNo, result.paperCode, sheet.campus ?? null, m.raw ?? null, m.percent ?? null, m.points ?? null,
        m.programme ?? null, m.semester ?? null, m.rowNo ?? null));
  }
  return stmts;
}

// Check one Mark sheet and store its marks when they are ready.
export async function checkSheet(env, sessionId, sheet, runTag) {
  const db = env.DB;
  let result;
  try {
    result = await readMarksStatement(env, sheet.spreadsheet_id, sheet.component);
  } catch (err) {
    if ((err instanceof SheetAccessError && err.status === 429) || /too many subrequests/i.test(err.message)) {
      return { status: sheet.status, error: err.message, changes: 0, fetched: false, retryLater: true };
    }
    const status = err instanceof SheetAccessError && (err.status === 403 || err.status === 404) ? "no_access" : "error";
    await run(db, "UPDATE marksheets SET status = ?, last_error = ?, last_checked_at = datetime('now') WHERE session_id = ? AND key = ?", status, err.message, sessionId, sheet.key);
    return { status, error: err.message, changes: 0, fetched: false };
  }
  let applied = null;
  if (result.marks) applied = await applyMarks(db, sessionId, sheet, result, `marksheet:${runTag}`);
  // A sheet that was fetched and is now back to "filling" keeps its marks; the status says the teacher reopened it.
  const status = !result.marks && sheet.last_fetched_at && result.status === "filling" ? "reopened" : result.status;
  // Everything this sheet writes goes in one batch: Cloudflare's free plan allows only 50 calls per request.
  const changes = applied ? applied.added + applied.changed + applied.removed : 0;
  const stmts = applied ? applied.stmts : [];
  stmts.push(db.prepare(`UPDATE marksheets SET course_title = COALESCE(course_title, ?), teacher_name = COALESCE(teacher_name, ?), programme = COALESCE(programme, ?),
      semester = COALESCE(semester, ?), max_marks = COALESCE(max_marks, ?), status = ?, certified = ?, all_filled = ?, validated = ?, paper_code = ?, students = ?, last_error = ?,
      last_checked_at = datetime('now'), last_fetched_at = CASE WHEN ? THEN datetime('now') ELSE last_fetched_at END,
      marks_count = COALESCE(?, marks_count), regd_nos = COALESCE(?, regd_nos), last_changes = COALESCE(?, last_changes)
    WHERE session_id = ? AND key = ?`)
    .bind(result.title ?? null, result.teacher ?? null, result.programme ?? null, result.semester ?? null, result.maxMarks ?? null,
      status, result.certified ? 1 : 0, result.allFilled ? 1 : 0, result.validated === null || result.validated === undefined ? null : result.validated ? 1 : 0,
      result.paperCode ?? null, result.students ?? null, result.error ?? null, applied ? 1 : 0,
      applied ? applied.keys.length : null, applied ? JSON.stringify(applied.keys) : null, applied ? applied.changed + applied.removed : null,
      sessionId, sheet.key));
  if (changes) stmts.push(db.prepare("UPDATE exam_sessions SET marks_dirty = 1 WHERE id = ?").bind(sessionId));
  await batchInsert(db, stmts, 1000);
  return { status, changes, corrections: applied ? applied.changed + applied.removed : 0, fetched: !!applied };
}

// Check the next batch of sheets not checked since `before` (a run's start, or "a day ago" for the daily job),
// least recently checked first. The page calls this repeatedly until nothing is left.
// `skipFetched` (the Fetch buttons) leaves out sheets whose marks are already in; the daily job still re-reads them
// once a day, which is how a mark a teacher changes after certifying is caught as a correction.
const DUE = "in_master = 1 AND spreadsheet_id IS NOT NULL AND (last_checked_at IS NULL OR last_checked_at < ?)";
export const NOT_FETCHED = " AND status <> 'fetched'";
export async function fetchBatch(env, sessionId, { limit = 25, runId, before, component = null, exactRemaining = true, skipFetched = false }) {
  const db = env.DB;
  const only = (component ? " AND component = ?" : "") + (skipFetched ? NOT_FETCHED : "");
  const extra = component ? [component] : [];
  const sheets = await all(db, `SELECT * FROM marksheets WHERE session_id = ? AND ${DUE}${only} ORDER BY last_checked_at LIMIT ?`, sessionId, before, ...extra, limit);
  const totals = { checked: 0, fetched: 0, changed: 0, errors: 0, rateLimited: false };
  for (const s of sheets) {
    const r = await checkSheet(env, sessionId, s, runId);
    if (r.retryLater) { totals.rateLimited = true; break; }
    totals.checked++;
    if (r.fetched) totals.fetched++;
    totals.changed += r.changes;
    if (r.status === "error" || r.status === "no_access" || r.status === "template") totals.errors++;
  }
  if (runId) {
    await run(db, "UPDATE marksheet_runs SET checked = checked + ?, fetched = fetched + ?, changed = changed + ?, errors = errors + ? WHERE id = ?",
      totals.checked, totals.fetched, totals.changed, totals.errors, runId);
  }
  // The page shows how many are left. The daily job only needs to know whether any are, which reads far fewer rows.
  if (!exactRemaining) {
    const any = await first(db, `SELECT 1 AS n FROM marksheets WHERE session_id = ? AND ${DUE}${only} ORDER BY last_checked_at LIMIT 1`, sessionId, before, ...extra);
    return { ...totals, remaining: any ? 1 : 0 };
  }
  const { n } = await first(db, `SELECT COUNT(*) AS n FROM marksheets WHERE session_id = ? AND ${DUE}${only}`, sessionId, before, ...extra);
  return { ...totals, remaining: n };
}

// The daily job: for every open session that uses Mark sheets, check sheets not checked in the last 20 hours,
// within a per-run budget (Google read limits and Cloudflare sub-request limits). It runs every few minutes in
// the early morning until each session is done, then recomputes sessions whose marks changed.
export async function runDaily(env, { budget = Number(env.DAILY_BUDGET) || 2, compute } = {}) {
  const db = env.DB;
  const sessions = await all(db, "SELECT DISTINCT s.id FROM exam_sessions s JOIN marksheet_masters m ON m.session_id = s.id WHERE s.status = 'open'");
  const summary = [];
  for (const { id } of sessions) {
    if (budget <= 0) break;
    let runRow = await first(db, "SELECT * FROM marksheet_runs WHERE session_id = ? AND trigger = 'daily' AND date(started_at) = date('now') ORDER BY id DESC LIMIT 1", id);
    if (runRow?.finished_at) continue;
    if (!runRow) {
      const res = await run(db, "INSERT INTO marksheet_runs (session_id, trigger, by) VALUES (?, 'daily', 'daily job')", id);
      runRow = { id: res.meta.last_row_id };
      await refreshList(env, id).catch(err => summary.push({ id, refreshError: err.message }));   // new files and courses first
    }
    const before = (await first(db, "SELECT datetime('now', '-20 hours') AS t")).t;
    const r = await fetchBatch(env, id, { limit: budget, runId: runRow.id, before, exactRemaining: false });
    budget -= r.checked;
    if (r.remaining === 0) {
      await run(db, "UPDATE marksheet_runs SET finished_at = datetime('now') WHERE id = ?", runRow.id);
      const s = await first(db, "SELECT marks_dirty FROM exam_sessions WHERE id = ?", id);
      if (s?.marks_dirty && compute) await compute(env, id, "Mark sheets (daily)").catch(err => summary.push({ id, computeError: err.message }));
    }
    summary.push({ id, ...r });
    if (r.rateLimited) break;
  }
  return summary;
}
