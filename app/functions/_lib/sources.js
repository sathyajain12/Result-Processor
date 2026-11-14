import { parseCMF, parseSMF, parseMarks, parsePrevious, programmeDefaults } from "../../../engine/src/index.js";
import { all, first, run, batchInsert, sha256 } from "./db.js";
import { HttpError } from "./http.js";
import { reapplyStudentEdits, refreshMarkEdits } from "./edits.js";

export const SOURCE_KINDS = ["CMF", "SMF", "CIE", "ESE", "PREV"];

const text = v => (v === null || v === undefined ? null : String(v));

export async function importSource(env, sessionId, kind, values, actor) {
  if (!SOURCE_KINDS.includes(kind)) throw new HttpError(400, `Unknown source kind ${kind}`);
  const db = env.DB;
  // A session takes CIE (or ESE) marks either from Mark sheets or from an aggregate sheet or upload, never both,
  // because an import replaces every mark of that kind.
  if ((kind === "CIE" || kind === "ESE") && await first(db, "SELECT id FROM marksheet_masters WHERE session_id = ? AND component = ? LIMIT 1", sessionId, kind)) {
    throw new HttpError(400, `${kind} marks in this session come from Mark sheets. Unlink the ${kind} course master there to load an aggregate sheet instead.`);
  }
  const checksum = await sha256(JSON.stringify(values));
  let summary;

  if (kind === "CMF") {
    const { courses, warnings, skipped } = parseCMF(values);
    await run(db, "DELETE FROM courses WHERE session_id = ?", sessionId);
    await batchInsert(db, courses.map(c => db.prepare(
      `INSERT INTO courses (session_id, code, base_code, title, programmes, semester, batches, category, credits, cie_max, ese_max,
        cie_weight, ese_weight, calc_type, course_type, teaching_dept, sequence) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(sessionId, c.code, c.baseCode, c.title, c.programmes, c.semester, JSON.stringify(c.batches), c.category, c.credits,
      c.cieMax, c.eseMax, c.cieWeight, c.eseWeight, c.calcType, c.courseType, c.teachingDept, c.sequence)));
    await ensureProgrammes(db, courses.map(c => c.programmes));
    summary = { rows: courses.length, warnings, detail: `${courses.length} courses (${skipped.swayamNC} SWAYAM NC rows skipped)` };
  }

  else if (kind === "SMF") {
    const { students, warnings, electiveColumns } = parseSMF(values);
    const list = Object.values(students);
    await run(db, "DELETE FROM students WHERE session_id = ?", sessionId);
    await batchInsert(db, list.map(s => db.prepare(
      "INSERT INTO students (session_id, regd_no, name, campus, programme, semester, batch, sem_credits, electives) VALUES (?,?,?,?,?,?,?,?,?)"
    ).bind(sessionId, s.regdNo, s.name, s.campus, s.programme, s.semester, s.batch, s.semCredits, s.electives ? JSON.stringify(s.electives) : null)));
    await ensureProgrammes(db, list.map(s => s.programme));
    await reapplyStudentEdits(db, sessionId);
    summary = { rows: list.length, warnings, detail: `${list.length} students${electiveColumns.length ? `; elective columns: ${electiveColumns.join(", ")}` : ""}` };
  }

  else if (kind === "CIE" || kind === "ESE") {
    const { rows, warnings } = parseMarks(values, kind);
    const existing = new Map((await all(db,
      "SELECT regd_no, paper_code, raw FROM marks WHERE session_id = ? AND component = ?", sessionId, kind
    )).map(r => [`${r.regd_no}|${r.paper_code}`, r.raw]));

    const syncId = crypto.randomUUID();
    const stmts = [];
    let added = 0, changed = 0, removed = 0;
    const incoming = new Set();

    for (const r of rows) {
      const k = `${r.regdNo}|${r.paperCode}`;
      incoming.add(k);
      const raw = text(r.raw);
      if (!existing.has(k)) {
        added++;
        stmts.push(db.prepare("INSERT INTO marks (session_id, regd_no, paper_code, component, raw) VALUES (?,?,?,?,?)")
          .bind(sessionId, r.regdNo, r.paperCode, kind, raw));
      } else if (existing.get(k) !== raw) {
        changed++;
        stmts.push(db.prepare("UPDATE marks SET raw = ?, updated_at = datetime('now') WHERE session_id = ? AND regd_no = ? AND paper_code = ? AND component = ?")
          .bind(raw, sessionId, r.regdNo, r.paperCode, kind));
        stmts.push(db.prepare("INSERT INTO mark_changes (session_id, regd_no, paper_code, component, old_raw, new_raw, sync_id) VALUES (?,?,?,?,?,?,?)")
          .bind(sessionId, r.regdNo, r.paperCode, kind, existing.get(k), raw, syncId));
      }
    }
    for (const [k, raw] of existing) {
      if (incoming.has(k)) continue;
      removed++;
      const [regdNo, paperCode] = k.split("|");
      stmts.push(db.prepare("DELETE FROM marks WHERE session_id = ? AND regd_no = ? AND paper_code = ? AND component = ?")
        .bind(sessionId, regdNo, paperCode, kind));
      stmts.push(db.prepare("INSERT INTO mark_changes (session_id, regd_no, paper_code, component, old_raw, new_raw, sync_id) VALUES (?,?,?,?,?,NULL,?)")
        .bind(sessionId, regdNo, paperCode, kind, raw, syncId));
    }
    await batchInsert(db, stmts);
    await refreshMarkEdits(db, sessionId, kind);
    const firstSync = existing.size === 0;
    summary = {
      rows: rows.length, warnings, added, changed, removed,
      detail: firstSync ? `${rows.length} marks loaded` : `${added} new, ${changed} corrected, ${removed} removed`
    };
  }

  else if (kind === "PREV") {
    const { rows, warnings } = parsePrevious(values);
    await run(db, "DELETE FROM previous_semesters WHERE session_id = ?", sessionId);
    await batchInsert(db, rows.map(r => db.prepare(
      "INSERT INTO previous_semesters (session_id, regd_no, semester_no, credit_np, credits, gpa) VALUES (?,?,?,?,?,?)"
    ).bind(sessionId, r.regdNo, r.semesterNo, r.creditNP, r.credits, r.gpa)));
    summary = { rows: rows.length, warnings, detail: `${rows.length} previous-semester records` };
  }

  await run(db,
    `INSERT INTO sources (session_id, kind, last_synced_at, last_synced_by, row_count, checksum, warnings)
     VALUES (?, ?, datetime('now'), ?, ?, ?, ?)
     ON CONFLICT (session_id, kind) DO UPDATE SET last_synced_at = excluded.last_synced_at, last_synced_by = excluded.last_synced_by,
       row_count = excluded.row_count, checksum = excluded.checksum, warnings = excluded.warnings`,
    sessionId, kind, actor, summary.rows, checksum, JSON.stringify(summary.warnings || []));

  return { kind, ...summary };
}

async function ensureProgrammes(db, codes) {
  const unique = [...new Set(codes.filter(Boolean))];
  await batchInsert(db, unique.map(code => {
    const d = programmeDefaults(code);
    return db.prepare("INSERT OR IGNORE INTO programmes (code, pass_category, cie_np, ese_np, comb_np, grade_table) VALUES (?,?,?,?,?,?)")
      .bind(code, d.passCategory, d.cieNP, d.eseNP, d.combNP, d.gradeTable);
  }));
}
