import { registerEntry, searchTerms, nonCreditCourses } from "../../../../../../engine/src/index.js";
import { json } from "../../../../_lib/http.js";
import { all, first, parseJson } from "../../../../_lib/db.js";
import { latestRun } from "../../../../_lib/compute.js";

// The Grade register: built on request from the latest compute, one page of students at a time. Nothing is stored,
// so it is always current. Only ready results are listed (no blocking issues, nothing held or withheld).
const PER_PAGE = 20, MAX_PER_PAGE = 50;

export async function onRequestGet({ env, params, request }) {
  const db = env.DB, sid = params.sid;
  const url = new URL(request.url);
  const run = await latestRun(db, sid);
  if (!run) return json({ computed: false, students: [], total: 0, groups: [], ready: 0, computedStudents: 0 });

  // The register goes by programme and semester: students of the same programme and semester are one register, whatever their batch.
  const groups = new Map();
  for (const b of await all(db, "SELECT batch_key, COUNT(*) AS students, SUM(releasable) AS ready FROM student_results WHERE run_id = ? GROUP BY batch_key ORDER BY batch_key", run.id)) {
    const key = b.batch_key.split("|").slice(0, 2).join("|");
    const g = groups.get(key) || groups.set(key, { key, students: 0, ready: 0 }).get(key);
    g.students += b.students;
    g.ready += b.ready;
  }
  const group = url.searchParams.get("group") || "";
  const terms = searchTerms(url.searchParams.get("q"));
  const perPage = Math.max(1, Math.min(MAX_PER_PAGE, Number(url.searchParams.get("perPage")) || PER_PAGE));

  const where = ["r.run_id = ?", "r.releasable = 1"], binds = [run.id];
  if (group) {
    const [programme, semester = ""] = group.split("|");
    where.push("s.programme = ?", "IFNULL(s.semester, '') = ?");
    binds.push(programme, semester);
  }
  if (terms.length) {
    where.push(`(${terms.map(() => "r.regd_no LIKE ? OR s.name LIKE ?").join(" OR ")})`);
    for (const t of terms) binds.push(`%${t}%`, `%${t}%`);
  }
  const from = `FROM student_results r JOIN students s ON s.session_id = r.session_id AND s.regd_no = r.regd_no WHERE ${where.join(" AND ")}`;
  const { n: total } = await first(db, `SELECT COUNT(*) AS n ${from}`, ...binds);
  // When several students are searched for, say which of them has no ready result here, rather than quietly leaving them out.
  let notFound = [];
  if (terms.length > 1) {
    const found = (await all(db, `SELECT r.regd_no, s.name ${from}`, ...binds)).map(r => `${r.regd_no} ${r.name ?? ""}`.toLowerCase());
    notFound = terms.filter(t => !found.some(f => f.includes(t.toLowerCase())));
  }
  const pages = Math.max(1, Math.ceil(total / perPage));
  const page = Math.min(pages, Math.max(1, Number(url.searchParams.get("page")) || 1));
  const rows = await all(db, `SELECT r.regd_no, r.published_gpa, r.letter_grade, r.qualifier, r.reasons, r.papers, s.name, s.campus, s.programme, s.semester, s.batch, s.electives
    ${from} ORDER BY s.programme, s.semester, r.regd_no LIMIT ? OFFSET ?`, ...binds, perPage, (page - 1) * perPage);

  // Type, Category and Sequence come from the CMF. A supplementary also shows papers carried over from its regular session.
  const session = await first(db, "SELECT s.name, s.base_session_id, c.name AS cycle_name FROM exam_sessions s LEFT JOIN exam_cycles c ON c.id = s.cycle_id WHERE s.id = ?", sid);
  const courseRows = await all(db, `SELECT session_id, code, base_code, title, programmes, semester, batches, category, course_type, sequence, credits, cie_max, ese_max, teaching_dept
    FROM courses WHERE session_id IN (?, ?)`, sid, session?.base_session_id ?? sid);
  const courses = new Map();
  for (const c of [...courseRows.filter(x => x.session_id !== sid), ...courseRows.filter(x => x.session_id === sid)]) {
    courses.set(c.code, { code: c.code, baseCode: c.base_code, title: c.title, programmes: c.programmes, semester: c.semester, batches: c.batches, category: c.category, courseType: c.course_type,
      sequence: c.sequence, credits: c.credits, cieMax: c.cie_max, eseMax: c.ese_max, teachingDept: c.teaching_dept });
  }
  const noMarks = [...courses.values()].filter(c => !(c.cieMax > 0) && !(c.eseMax > 0)).map(c => ({ ...c, batches: parseJson(c.batches, []) }));
  // For the Weightage column: courses with no CIE / ESE WTG of their own use their weightage category. A few rows only.
  const weightage = Object.fromEntries((await all(db, "SELECT category, cie, ese FROM weightage_categories")).map(w => [String(w.category), { cie: w.cie, ese: w.ese }]));

  const students = rows.map(r => {
    const student = { regdNo: r.regd_no, name: r.name, campus: r.campus, programme: r.programme, semester: r.semester, batch: r.batch, electives: parseJson(r.electives, null) };
    const gpa = r.published_gpa !== null && !isNaN(Number(r.published_gpa)) ? Number(r.published_gpa) : r.published_gpa;
    return registerEntry({
      student, courses, papers: parseJson(r.papers, []),
      result: { publishedGPA: gpa, letterGrade: r.letter_grade, qualifier: r.qualifier },
      nonCredit: nonCreditCourses(student, parseJson(r.reasons, {}).effectiveBatch ?? r.batch, noMarks),
      weightage
    });
  });

  return json({
    computed: true, computedAt: run.started_at, sessionName: session?.name ?? null, cycleName: session?.cycle_name ?? null,
    students, total, page, pages, perPage, notFound,
    groups: [...groups.values()],
    ready: [...groups.values()].reduce((n, g) => n + g.ready, 0),
    computedStudents: [...groups.values()].reduce((n, g) => n + g.students, 0)
  });
}
