import { json, csv, HttpError } from "../../../../_lib/http.js";
import { all, first } from "../../../../_lib/db.js";

// The CIE / ESE marks tabs (the old Aggregate Sheets): every fetched row as the Marks Statement shows it.
// A mark edited on the student page (e.g. malpractice) shows the edited mark, with the edit's reason as the remark.
const PAGE = 200;

export const COLUMNS = {
  CIE: ["Regd. No.", "Campus", "Course Code", "CIE Marks", "CIE Percent", "CIE Num. Points", "Programme", "Semester", "Remarks"],
  ESE: ["Regd. No.", "Course Code", "ESE Marks", "ESE Percent", "ESE Num. Points", "Programme", "Semester", "Remarks"]
};

export async function onRequestGet({ env, params, request }) {
  const db = env.DB;
  const url = new URL(request.url);
  const q = Object.fromEntries(url.searchParams);
  const component = q.component === "ESE" ? "ESE" : q.component === "CIE" ? "CIE" : null;
  if (!component) throw new HttpError(400, "component must be CIE or ESE");

  const where = ["r.session_id = ?", "r.component = ?"];
  const args = [params.sid, component];
  if (q.course) { where.push("r.course_code = ?"); args.push(q.course); }
  if (q.campus) { where.push("r.campus = ?"); args.push(q.campus); }
  if (q.programme) { where.push("r.programme = ?"); args.push(q.programme); }
  if (q.q?.trim()) { where.push("(r.regd_no LIKE ? OR r.course_code LIKE ?)"); args.push(`%${q.q.trim()}%`, `%${q.q.trim()}%`); }
  if (q.edited === "1") where.push("o.value IS NOT NULL");

  // Latest active mark edit per student, paper and component.
  const from = `FROM marksheet_rows r
    LEFT JOIN (SELECT regd_no, paper_code, field, value, reason, MAX(id) AS id FROM overrides
               WHERE session_id = ? AND type = 'mark' AND revoked_at IS NULL GROUP BY regd_no, paper_code, field) o
      ON o.regd_no = r.regd_no AND o.paper_code = r.course_code AND o.field = r.component
    LEFT JOIN marksheets ms ON ms.session_id = r.session_id AND ms.key = r.sheet_key
    WHERE ${where.join(" AND ")}`;
  const fromArgs = [params.sid, ...args];
  const order = "ORDER BY r.programme, r.semester, r.course_code, r.campus, r.row_no, r.regd_no";
  const select = "SELECT r.regd_no, r.campus, r.course_code, r.marks, r.percent, r.num_points, r.programme, r.semester, o.value AS edited, o.reason, ms.max_marks";

  const shape = r => {
    if (r.edited === null || r.edited === undefined) {
      return { regdNo: r.regd_no, campus: r.campus, courseCode: r.course_code, marks: r.marks, percent: r.percent, points: r.num_points,
        programme: r.programme, semester: r.semester, remarks: null, sheetMarks: null };
    }
    // An edited mark: percent from the course's maximum; num. points come from the computed result, not the sheet.
    const n = Number(r.edited);
    const percent = r.edited !== "" && Number.isFinite(n) && r.max_marks ? Math.round((n / r.max_marks) * 10000) / 100 : null;
    return { regdNo: r.regd_no, campus: r.campus, courseCode: r.course_code, marks: r.edited, percent, points: null,
      programme: r.programme, semester: r.semester, remarks: r.reason, sheetMarks: r.marks };
  };

  if (q.format === "csv") {
    const rows = (await all(db, `${select} ${from} ${order}`, ...fromArgs)).map(shape);
    const line = r => component === "CIE"
      ? [r.regdNo, r.campus, r.courseCode, r.marks, r.percent, r.points, r.programme, r.semester, r.remarks]
      : [r.regdNo, r.courseCode, r.marks, r.percent, r.points, r.programme, r.semester, r.remarks];
    return csv([COLUMNS[component], ...rows.map(line)], `${params.sid}-${component}-marks.csv`);
  }

  // Each of these reads the whole of this component's rows, so a page change (lite=1) skips them: the browser keeps the
  // total and the filter lists from page 1. The filter lists come from one read of the distinct combinations.
  const page = Math.max(1, Number(q.page) || 1);
  const lite = q.lite === "1";
  const [rows, count, combos] = await Promise.all([
    all(db, `${select} ${from} ${order} LIMIT ? OFFSET ?`, ...fromArgs, PAGE, (page - 1) * PAGE),
    lite ? null : first(db, `SELECT COUNT(*) AS n ${from}`, ...fromArgs),
    lite ? null : all(db, "SELECT DISTINCT course_code, campus, programme FROM marksheet_rows WHERE session_id = ? AND component = ?", params.sid, component)
  ]);
  const list = key => [...new Set(combos.map(r => r[key]).filter(v => v !== null && v !== ""))].sort();
  return json({
    component, columns: COLUMNS[component], page, pageSize: PAGE, total: lite ? null : count.n,
    rows: rows.map(shape),
    options: lite ? null : { courses: list("course_code"), campuses: list("campus"), programmes: list("programme") }
  });
}
