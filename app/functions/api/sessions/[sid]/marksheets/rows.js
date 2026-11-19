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

  const sid = params.sid;
  const where = ["r.session_id = ?", "r.component = ?"];
  const args = [sid, component];
  if (q.course) { where.push("r.course_code = ?"); args.push(q.course); }
  if (q.campus) { where.push("r.campus = ?"); args.push(q.campus); }
  if (q.programme) { where.push("r.programme = ?"); args.push(q.programme); }
  const term = q.q?.trim() || "";
  const edited = q.edited === "1";
  if (edited) where.push("o.value IS NOT NULL");

  // D1 charges for every row a query looks at, so each filter starts from the few rows it can match rather than
  // walking all of a component's rows (about 10,000) and testing each one:
  //   a search    the Regd Nos and course codes that begin with what was typed, found through their indexes
  //               (marksheet_rows_regd, marksheet_rows_list). A search used to match anywhere in them ('%…%'),
  //               which no index can serve.
  //   with edits  the active mark edits first (a handful), then their rows.
  // The latest active mark edit per student, paper and component:
  const OVERRIDES = `(SELECT regd_no, paper_code, field, value, reason, MAX(id) AS id FROM overrides
    WHERE session_id = ? AND type = 'mark' AND revoked_at IS NULL GROUP BY regd_no, paper_code, field)`;
  const editOf = "o.regd_no = r.regd_no AND o.paper_code = r.course_code AND o.field = r.component";
  let source, sourceArgs;
  if (term) {
    const up = term.toUpperCase();
    const ranges = [["regd_no", term], ["course_code", up], ...(up !== term ? [["course_code", term]] : [])];   // noc26_… codes are lower case
    source = `(${ranges.map(([col]) => `SELECT rowid AS id FROM marksheet_rows WHERE session_id = ? AND component = ? AND ${col} >= ? AND ${col} < ?`).join(" UNION ")}) m
      CROSS JOIN marksheet_rows r ON r.rowid = m.id
      LEFT JOIN ${OVERRIDES} o ON ${editOf}`;
    sourceArgs = [...ranges.flatMap(([, v]) => [sid, component, v, `${v}￿`]), sid];
  } else if (edited) {
    source = `${OVERRIDES} o CROSS JOIN marksheet_rows r ON r.session_id = ? AND r.component = o.field AND r.course_code = o.paper_code AND r.regd_no = o.regd_no`;
    sourceArgs = [sid, sid];
  } else {
    source = `marksheet_rows r LEFT JOIN ${OVERRIDES} o ON ${editOf}`;
    sourceArgs = [sid];
  }
  const from = `FROM ${source}
    LEFT JOIN marksheets ms ON ms.session_id = r.session_id AND ms.key = r.sheet_key
    WHERE ${where.join(" AND ")}`;
  const fromArgs = [...sourceArgs, ...args];
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

  // Totals and filter lists come from marksheet_row_groups (a count per sheet, course, campus and programme, about 1,300
  // rows), not from counting the 14,500 rows of marks. Only a search or the "with remarks" filter needs a real count.
  // A page change (lite=1) skips both: the browser keeps page 1's total and lists.
  const page = Math.max(1, Number(q.page) || 1);
  const lite = q.lite === "1";
  const exactCount = !lite && (term || edited);
  const [rows, count, groups] = await Promise.all([
    all(db, `${select} ${from} ${order} LIMIT ? OFFSET ?`, ...fromArgs, PAGE, (page - 1) * PAGE),
    exactCount ? first(db, `SELECT COUNT(*) AS n ${from}`, ...fromArgs) : null,
    lite ? null : all(db, `SELECT course_code, campus, programme, SUM(n) AS n FROM marksheet_row_groups WHERE session_id = ? AND component = ?
      GROUP BY course_code, campus, programme`, sid, component)
  ]);
  const list = key => [...new Set(groups.map(r => r[key]).filter(v => v !== null && v !== ""))].sort();
  const total = lite ? null : exactCount ? count.n
    : groups.filter(g => (!q.course || g.course_code === q.course) && (!q.campus || g.campus === q.campus) && (!q.programme || g.programme === q.programme))
      .reduce((n, g) => n + g.n, 0);
  return json({
    component, columns: COLUMNS[component], page, pageSize: PAGE, total,
    rows: rows.map(shape),
    options: lite ? null : { courses: list("course_code"), campuses: list("campus"), programmes: list("programme") }
  });
}
