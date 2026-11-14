import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { enc } from "../api.js";
import { useSession, useLoad, Loading, EmptyState, fmtGpa, fmtWhen, batchLabel } from "../components/ui.jsx";
import { BarList, Histogram, BoxRow } from "../components/charts.jsx";

const GRADE_ORDER = ["O+", "O", "A+", "A", "B+", "B", "C", "No grade", "Fail", "Absent"];
const rank = g => (GRADE_ORDER.indexOf(g) === -1 ? 50 : GRADE_ORDER.indexOf(g));
const fmtPctOrDash = v => (v === null || v === undefined ? "—" : `${v}%`);

const COURSE_COLUMNS = [
  ["key", "Course"], ["students", "Students"], ["passRate", "Pass rate"], ["fail", "Failed"], ["absent", "Absent"],
  ["meanCie", "Mean CIE"], ["meanEse", "Mean ESE"], ["meanComb", "Mean COMB"]
];

function CourseTable({ courses }) {
  const [sort, setSort] = useState({ key: "passRate", dir: 1 });
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle ? courses.filter(c => c.key.toLowerCase().includes(needle) || (c.title || "").toLowerCase().includes(needle)) : courses;
    return [...list].sort((a, b) => {
      const x = a[sort.key], y = b[sort.key];
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return (typeof x === "string" ? x.localeCompare(y) : x - y) * sort.dir;
    });
  }, [courses, sort, q]);
  const by = key => setSort(s => ({ key, dir: s.key === key ? -s.dir : 1 }));

  return (
    <div className="sheet">
      <div className="sheet-head">
        <div><h2>Courses</h2><span className="muted small">Click a column to sort. Pass rate counts absent students as not passing.</span></div>
        <input type="search" placeholder="Course code or title" value={q} onChange={e => setQ(e.target.value)} aria-label="Filter courses" />
      </div>
      <div className="scroll">
        <table className="ledger">
          <thead>
            <tr>{COURSE_COLUMNS.map(([k, l], i) => (
              <th key={k} className={i ? "num" : ""} aria-sort={sort.key === k ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
                <button className="th-sort" onClick={() => by(k)}>{l}{sort.key === k ? (sort.dir === 1 ? " ↑" : " ↓") : ""}</button>
              </th>
            ))}</tr>
          </thead>
          <tbody>
            {rows.map(c => (
              <tr key={c.key}>
                <td><b>{c.key}</b><div className="small muted">{c.title}</div></td>
                <td className="num">{c.students}</td>
                <td className="num nowrap">
                  <span className="inline-bar" title={`${c.pass} of ${c.pass + c.fail + c.absent} passed`}><i style={{ width: `${c.passRate ?? 0}%` }} /></span>{" "}
                  {fmtPctOrDash(c.passRate)}
                </td>
                <td className="num" style={{ color: c.fail ? "var(--seal)" : undefined }}>{c.fail || ""}</td>
                <td className="num">{c.absent || ""}</td>
                <td className="num">{fmtPctOrDash(c.meanCie)}</td>
                <td className="num">{fmtPctOrDash(c.meanEse)}</td>
                <td className="num">{fmtPctOrDash(c.meanComb)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <EmptyState icon="search" title="No courses match" />}
      </div>
    </div>
  );
}

function Body({ a, sid, batchIds }) {
  const t = a.totals;
  const grades = Object.entries(a.gradeDistribution).sort((x, y) => rank(x[0]) - rank(y[0]));
  const gradeTotal = grades.reduce((n, [, c]) => n + c, 0);

  return (
    <>
      <div className="stat-strip">
        <div><b>{t.students.toLocaleString()}</b><span>students</span></div>
        <div><b>{fmtPctOrDash(t.passPct)}</b><span>passed ({t.passed} of {t.passed + t.failed + t.absent})</span></div>
        <div><b>{fmtGpa(t.gpa.mean)}</b><span>mean GPA</span></div>
        <div><b>{fmtGpa(t.gpa.median)}</b><span>median GPA</span></div>
        <div><b>{t.failed}</b><span>failed</span></div>
        <div><b>{t.absent}</b><span>absent</span></div>
        {a.scope === "all" && <div><b>{t.held + t.withheld}</b><span>pending or withheld</span></div>}
      </div>

      <div className="chart-grid">
        <div className="sheet pad">
          <h2>Grades</h2>
          <p className="small muted">Letter grade of each result; Fail and Absent are results with no GPA.</p>
          <div style={{ marginTop: 12 }}>
            <BarList items={grades.map(([g, n]) => ({ label: g, value: n, display: n, tone: g === "Fail" || g === "Absent" ? "fail" : "", title: `${g}: ${n} (${Math.round((n / gradeTotal) * 100)}%)` }))} empty="No results in this view yet." />
          </div>
        </div>
        <div className="sheet pad">
          <h2>GPA distribution</h2>
          <p className="small muted">Passing students, in steps of 0.5. Hover a column for the count.</p>
          <div style={{ marginTop: 12 }}><Histogram bins={a.histogram} /></div>
        </div>
      </div>

      <div className="sheet">
        <div className="sheet-head"><h2>Programmes</h2><span className="small muted">Box shows the middle half of GPAs; the line is the median.</span></div>
        <div className="scroll">
          <table className="ledger">
            <thead><tr><th>Programme</th><th className="num">Students</th><th className="num">Pass rate</th><th className="num">Failed</th><th className="num">Absent</th><th className="num">Mean GPA</th><th>GPA spread (0–10)</th></tr></thead>
            <tbody>
              {a.byProgramme.map(p => (
                <tr key={p.programme}>
                  <td><b>{p.programme}</b></td><td className="num">{p.students}</td><td className="num">{fmtPctOrDash(p.passPct)}</td>
                  <td className="num">{p.failed || ""}</td><td className="num">{p.absent || ""}</td><td className="num">{fmtGpa(p.gpa.mean)}</td>
                  <td><BoxRow s={p.gpa} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="sheet">
        <div className="sheet-head"><h2>Batches</h2></div>
        <div className="scroll">
          <table className="ledger">
            <thead><tr><th>Batch</th><th className="num">Students</th><th className="num">Pass rate</th><th className="num">Failed</th><th className="num">Absent</th><th className="num">Mean GPA</th><th>GPA spread (0–10)</th></tr></thead>
            <tbody>
              {a.byBatch.map(b => (
                <tr key={b.key}>
                  <td>{batchIds.get(b.key) ? <Link to={`/s/${sid}/batches/${batchIds.get(b.key)}`}>{batchLabel(b.programme, b.semester, b.batch)}</Link> : batchLabel(b.programme, b.semester, b.batch)}</td>
                  <td className="num">{b.students}</td><td className="num">{fmtPctOrDash(b.passPct)}</td>
                  <td className="num">{b.failed || ""}</td><td className="num">{b.absent || ""}</td><td className="num">{fmtGpa(b.gpa.mean)}</td>
                  <td><BoxRow s={b.gpa} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="sheet pad">
        <h2>Hardest papers</h2>
        <p className="small muted">Lowest pass rate among courses with at least 10 students.</p>
        <div style={{ marginTop: 12 }}>
          <BarList max={100} items={a.hardest.map(c => ({ label: c.key, value: c.passRate, display: `${c.passRate}%`, title: `${c.key} ${c.title || ""}: ${c.pass} of ${c.pass + c.fail + c.absent} passed, mean COMB ${c.meanComb ?? "—"}%` }))}
            empty="No course has 10 or more students in this view." />
        </div>
      </div>

      <CourseTable courses={a.byCourse} />
    </>
  );
}

export default function Analytics() {
  const { sid, session } = useSession();
  const [scope, setScope] = useState("releasable");
  const state = useLoad(`/sessions/${enc(sid)}/analytics?scope=${scope}`);
  const batchIds = useMemo(() => new Map((session.data?.batches || []).map(b => [b.key, b.id])), [session.data]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Analytics</h1>
          <p className="sub muted">{state.data?.run ? `From the results computed ${fmtWhen(state.data.run.startedAt)}.` : "Pass rates, grades and GPA spread for this session."}</p>
        </div>
        <div className="chips" role="group" aria-label="Which results">
          {[["releasable", "Releasable results"], ["all", "All computed"]].map(([k, l]) => <button key={k} className={`chip ${scope === k ? "on" : ""}`} onClick={() => setScope(k)}>{l}</button>)}
        </div>
      </div>
      <Loading state={state}>{a => a.run ? <Body a={a} sid={sid} batchIds={batchIds} /> : <div className="sheet"><EmptyState icon="analytics" title="Nothing computed yet">Load the data sources and compute results first.</EmptyState></div>}</Loading>
    </div>
  );
}
