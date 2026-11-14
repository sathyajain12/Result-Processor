import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, enc } from "../api.js";
import { useSession, useCan, Loading, Stage, StateStrip, StripLegend, EmptyState, useAction, fmtWhen, fmtGpa } from "../components/ui.jsx";
import { Icon } from "../components/icons.jsx";
import { compute, computedMessage } from "../lib/compute.js";

const FILTERS = ["All", "Campus ready", "Blocked", "Collecting", "Under review", "Approved"];

// A programme taught on more than one campus: each campus on its own, so one whose marks are all in shows as ready
// while another is still waiting. Batches computed before this was added have no campus figures and show none.
const campusState = c => (c.held === 0 && c.ready > 0 ? "ready" : c.ready > 0 ? "partly" : "waiting");
const multiCampus = b => (b.campuses || []).filter(c => c.campus).length > 1;
const campusReady = b => multiCampus(b) && b.held > 0 && b.campuses.some(c => campusState(c) === "ready");

function CampusLine({ b }) {
  if (!multiCampus(b)) return null;
  return (
    <div className="campus-list">
      {b.campuses.map(c => {
        const st = campusState(c);
        const marks = c.arrival < 1 ? `, marks in ${Math.floor(c.arrival * 100)}%` : "";
        const text = st === "ready" ? `ready, ${c.ready} student${c.ready === 1 ? "" : "s"}${c.withheld ? ` (${c.withheld} withheld)` : ""}`
          : st === "partly" ? `${c.ready} of ${c.students} ready, ${c.held} pending${marks}`
          : `waiting, ${c.held} pending${marks}`;
        return <span key={c.campus || "-"} className={`campus ${st}`}>{st === "ready" ? "✓ " : ""}<b>{c.campus || "No campus"}</b>: {text}</span>;
      })}
    </div>
  );
}
const EXPORTS = [["final.csv", "Final output"], ["failures.csv", "Failure list"], ["cgpa.csv", "CGPA"], ["digilocker.csv", "DigiLocker"], ["exceptions.csv", "Issues"]];

export default function Board() {
  const { sid, me, session } = useSession();
  const [filter, setFilter] = useState("All");
  const [busy, run] = useAction();

  // Compute runs in this browser (lib/compute.js): the server only hands out data and saves results.
  const recompute = () => run(() => compute(sid), computedMessage).then(() => session.reload());
  const sync = () => run(async () => {
    const r = await api.post(`/sessions/${enc(sid)}/sync`);
    return { ...r, computed: r.sources.some(s => !s.error) ? await compute(sid) : null };
  }, r => {
    const failed = r.sources.filter(s => s.error);
    return failed.length ? `Synced with problems: ${failed.map(f => `${f.kind}: ${f.error}`).join("; ")}` : `Synced ${r.sources.map(s => s.kind).join(", ")} and recomputed`;
  }).then(() => session.reload());

  return (
    <div className="page">
      <Loading state={session}>{s => <BoardBody s={s} filter={filter} setFilter={setFilter} me={me} busy={busy} actions={{ recompute, sync }} sid={sid} />}</Loading>
    </div>
  );
}

function BoardBody({ s, filter, setFilter, me, busy, actions, sid }) {
  const totals = useMemo(() => s.batches.reduce((t, b) => {
    for (const k of ["students", "ready", "approved", "changed", "held", "withheld"]) t[k] = (t[k] || 0) + (b[k] || 0);
    return t;
  }, {}), [s.batches]);
  const shown = s.batches.filter(b => filter === "All" || (filter === "Campus ready" ? campusReady(b) : b.stage.startsWith(filter)));
  const groups = useMemo(() => {
    const g = new Map();
    for (const b of shown) {
      const k = b.programme;
      if (!g.has(k)) g.set(k, []);
      g.get(k).push(b);
    }
    return [...g.entries()];
  }, [shown]);
  const can = useCan();
  const operator = can.operate;

  if (!s.run) {
    const loaded = s.counts.students > 0 && s.counts.courses > 0;
    return (
      <>
        <div className="page-head"><div><h1>{s.name}</h1></div></div>
        <div className="sheet">
          <EmptyState icon={loaded ? "compute" : "sources"} title={loaded ? "Ready to compute" : "No results yet"}
            actions={<>
              {loaded && operator && <button className="btn primary" disabled={busy} onClick={actions.recompute}><Icon name="compute" />Compute results</button>}
              <Link className={`btn ${loaded ? "" : "primary"}`} to={`/s/${sid}/sources`}><Icon name="sources" />{loaded ? "Data sources" : "Set up data sources"}</Link>
            </>}>
            {loaded
              ? `${s.counts.students} students, ${s.counts.courses} courses, ${s.counts.cie.toLocaleString()} CIE and ${s.counts.ese.toLocaleString()} ESE marks loaded.`
              : "Link or upload the CMF, SMF, CIE and ESE, then compute."}
          </EmptyState>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{s.name}</h1>
          {s.kind === "supplementary" && <p className="sub">Supplementary of <Link to={`/s/${s.baseSessionId}`}>{s.baseSessionName}</Link>: approved results there, with re-appeared papers replaced.</p>}
          <p className="sub muted">Computed {fmtWhen(s.run.startedAt)} by {s.run.by}, from {s.counts.cie.toLocaleString()} CIE and {s.counts.ese.toLocaleString()} ESE marks</p>
        </div>
        {operator && (
          <div className="row">
            <button className="btn" disabled={busy} onClick={actions.sync}><Icon name="sync" />Sync from Google Sheets</button>
            <button className="btn" disabled={busy} onClick={actions.recompute}><Icon name="compute" />Recompute</button>
          </div>
        )}
      </div>

      <div className="stat-strip">
        <div><b>{totals.students?.toLocaleString()}</b><span>students</span></div>
        <div><b>{(totals.ready + (totals.changed || 0)).toLocaleString()}</b><span>ready for approval</span></div>
        <div><b>{totals.approved}</b><span>approved</span></div>
        <div><b>{totals.held}</b><span>pending, see issues</span></div>
        <div className={s.run.summary.blocking ? "alert" : ""}><b>{s.run.summary.blocking}</b><span><Link to={`/s/${sid}/issues`}>blocking issues</Link></span></div>
      </div>

      <div className="sheet">
        <div className="sheet-head">
          <div className="chips" role="group" aria-label="Filter batches">
            {FILTERS.map(f => <button key={f} className={`chip ${filter === f ? "on" : ""}`} onClick={() => setFilter(f)}
              title={f === "Campus ready" ? "Batches where one campus has every student ready while another campus is still pending" : undefined}>
              {f}{f === "Campus ready" && s.batches.some(campusReady) ? ` (${s.batches.filter(campusReady).length})` : ""}</button>)}
          </div>
          <StripLegend />
        </div>
        <div className="scroll">
          <table className="ledger">
            <thead>
              <tr><th>Semester and batch</th><th>Stage</th><th style={{ width: "26%" }}>Students</th><th className="num">Ready</th><th className="num">Pending</th><th className="num">Issues</th><th className="num">Mean GPA</th><th className="num">Marks in</th></tr>
            </thead>
            <tbody>
              {groups.map(([programme, rows]) => [
                <tr className="group" key={programme}><td colSpan={8}>{programme}</td></tr>,
                ...rows.map(b => (
                  <tr key={b.id}>
                    <td><Link to={`/s/${sid}/batches/${b.id}`}>Sem {b.semester}{b.batch ? `, ${b.batch}` : ""}</Link><CampusLine b={b} /></td>
                    <td><Stage stage={b.stage} /></td>
                    <td><div className="row" style={{ flexWrap: "nowrap" }}><StateStrip counts={b} total={b.students} /><span className="small muted">{b.students}</span></div></td>
                    <td className="num">{b.ready + (b.changed || 0) || ""}</td>
                    <td className="num">{b.held || ""}</td>
                    <td className="num">{b.blocking ? <span style={{ color: "var(--seal)", fontWeight: 600 }}>{b.blocking}</span> : ""}{b.warnings ? <span className="faint">{b.blocking ? " + " : ""}{b.warnings}</span> : ""}</td>
                    <td className="num">{b.meanGpa ? fmtGpa(b.meanGpa) : "—"}</td>
                    <td className="num">{Math.round(b.arrival * 100)}%</td>
                  </tr>
                ))
              ])}
            </tbody>
          </table>
          {shown.length === 0 && <EmptyState icon="batches" title={filter === "Campus ready" ? "No batch has one campus ready while another waits" : "No batches at this stage"} />}
        </div>
      </div>

      <div className="sheet pad">
        <div className="row between">
          <div><h3>Downloads</h3><p className="muted small">Current results for every releasable student, in the same layout as the old sheets.</p></div>
          <div className="row">{EXPORTS.map(([k, l]) => <a key={k} className="btn" href={`/api/sessions/${enc(sid)}/export/${k}`}><Icon name="download" />{l}</a>)}</div>
        </div>
      </div>
    </>
  );
}
