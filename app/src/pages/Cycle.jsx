import { Link, useParams } from "react-router-dom";
import { enc } from "../api.js";
import { useLoad, Loading, fmtGpa, fmtWhen } from "../components/ui.jsx";
import { BoxRow } from "../components/charts.jsx";

const fmtPct = v => (v === null || v === undefined ? "—" : `${v}%`);

export default function Cycle() {
  const { cid } = useParams();
  const state = useLoad(`/cycles/${enc(cid)}/analytics`);
  return (
    <div className="page" style={{ maxWidth: 1100, margin: "0 auto" }}>
      <div className="crumbs"><Link to="/sessions">All cycles and sessions</Link></div>
      <Loading state={state}>{c => {
        const t = c.combined.totals;
        const programmes = [...new Set(c.sessions.flatMap(s => s.byProgramme.map(p => p.programme)))].sort();
        return (
          <>
            <div className="page-head"><div><h1>{c.name}</h1><p className="sub muted">Releasable results across this cycle. Combined figures count regular sessions only, so a student re-appearing in a supplementary is not counted twice.</p></div></div>

            <div className="stat-strip">
              <div><b>{c.sessions.length}</b><span>session{c.sessions.length === 1 ? "" : "s"}</span></div>
              <div><b>{t.students.toLocaleString()}</b><span>students (regular)</span></div>
              <div><b>{fmtPct(t.passPct)}</b><span>passed</span></div>
              <div><b>{fmtGpa(t.gpa.mean)}</b><span>mean GPA</span></div>
              <div><b>{t.failed}</b><span>failed</span></div>
              <div><b>{t.absent}</b><span>absent</span></div>
            </div>

            <div className="sheet">
              <div className="sheet-head"><h2>Sessions</h2></div>
              {c.sessions.length === 0 ? <div className="empty">No sessions in this cycle yet.</div> : (
                <div className="scroll">
                  <table className="ledger">
                    <thead><tr><th>Session</th><th className="num">Students</th><th className="num">Pass rate</th><th className="num">Mean GPA</th><th>GPA spread (0–10)</th><th className="num">Computed</th></tr></thead>
                    <tbody>
                      {c.sessions.map(s => (
                        <tr key={s.id}>
                          <td><Link to={`/s/${s.id}/analytics`}><b>{s.name}</b></Link>{s.kind === "supplementary" && <span className="tag">Supplementary</span>}{s.status === "closed" && <span className="tag lock">Locked</span>}</td>
                          <td className="num">{s.totals.students}</td><td className="num">{fmtPct(s.totals.passPct)}</td><td className="num">{fmtGpa(s.totals.gpa.mean)}</td>
                          <td><BoxRow s={s.totals.gpa} /></td>
                          <td className="num small muted">{s.computedAt ? fmtWhen(s.computedAt) : "not yet"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {programmes.length > 0 && (
              <div className="sheet">
                <div className="sheet-head"><h2>Pass rate by programme</h2></div>
                <div className="scroll">
                  <table className="ledger">
                    <thead><tr><th>Programme</th>{c.sessions.map(s => <th key={s.id} className="num">{s.name}</th>)}<th className="num">Combined</th></tr></thead>
                    <tbody>
                      {programmes.map(p => (
                        <tr key={p}>
                          <td><b>{p}</b></td>
                          {c.sessions.map(s => {
                            const row = s.byProgramme.find(x => x.programme === p);
                            return <td key={s.id} className="num" title={row ? `${row.passed} of ${row.passed + row.failed + row.absent} passed` : ""}>{row ? fmtPct(row.passPct) : <span className="faint">—</span>}</td>;
                          })}
                          <td className="num"><b>{fmtPct(c.combined.byProgramme.find(x => x.programme === p)?.passPct)}</b></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        );
      }}</Loading>
    </div>
  );
}
