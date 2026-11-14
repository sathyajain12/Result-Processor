import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { enc } from "../api.js";
import { useSession, useLoad, Loading, Status, STATUS_LABEL, EmptyState, Disclosure, fmtWhen, batchLabel } from "../components/ui.jsx";
import { Icon } from "../components/icons.jsx";

// Every graced paper in the latest results, grouped by batch: who, which paper, the ESE before and after, the grace given
// and the student's grace pool. Below, the papers that needed grace when the pool had run out (they stay failed).

const named = (fields, rows) => rows.map(v => Object.fromEntries(fields.map((f, i) => [f, v[i]])));
const mark = (raw, max) => (raw === null || raw === undefined || raw === "" ? "—" : max ? `${raw} / ${max}` : String(raw));
const change = g => (g.kind === "COMB" ? `COMB ${g.fromPct}% → ${g.toPct}% (ESE ${g.eseFromPct}% → ${g.eseToPct}%)` : `ESE ${g.fromPct}% → ${g.toPct}%`);
const EMPTY = { programme: "", campus: "", semester: "", kind: "", status: "", q: "" };
const KINDS = [["", "ESE and COMB grace"], ["ESE", "ESE grace"], ["COMB", "COMB grace"]];

function download(rows, sessionName) {
  const head = ["S.No.", "Programme", "Campus", "Semester", "Batch", "Regd No", "Name", "Paper Code", "Paper Title", "Credits", "CIE", "CIE Max",
    "ESE", "ESE Max", "ESE after grace", "Grace", "Grace marks", "Change", "COMB % after grace", "Grace pool", "Pool used", "Pool left", "Status"];
  const esc = v => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = rows.map((r, i) => [i + 1, r.programme, r.campus, r.semester, r.batchKey.split("|")[2], r.regdNo, r.name, r.paperCode, r.title, r.credits,
    r.cie, r.cieMax, r.ese, r.eseMax, r.gracedMarks, `${r.kind} grace`, r.marks, change(r), r.combPct, r.pool, r.used, r.left, STATUS_LABEL[r.status] || r.status]);
  const csv = "﻿" + [head, ...lines].map(l => l.map(esc).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = `${sessionName} - Gracing.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// One batch: a row per graced paper, the student's details and grace pool once for all their papers.
function BatchTable({ rows, sid }) {
  const students = [];
  for (const r of rows) {
    const last = students[students.length - 1];
    if (last && last.regdNo === r.regdNo) last.papers.push(r);
    else students.push({ ...r, papers: [r] });
  }
  return (
    <div className="scroll">
      <table className="ledger fail-table">
        <thead>
          <tr><th>Regd No</th><th>Name</th><th>Paper</th><th className="num">Credits</th><th className="num">CIE</th>
            <th className="num">ESE</th><th>Grace</th><th className="num">COMB now</th><th className="num">Grace pool</th><th>Status</th></tr>
        </thead>
        <tbody>
          {students.map(s => s.papers.map((p, i) => {
            const span = s.papers.length;
            return (
              <tr key={`${s.regdNo}|${p.paperCode}|${i}`} className={i === 0 ? "first" : ""}>
                {i === 0 && <>
                  <td rowSpan={span} className="nowrap"><Link to={`/s/${sid}/students/${s.regdNo}`}>{s.regdNo}</Link></td>
                  <td rowSpan={span}>{s.name}<div className="small muted">{s.campus}</div></td>
                </>}
                <td className="grace-paper"><b className="nowrap">{p.paperCode}</b><div className="small muted">{p.title}</div></td>
                <td className="num">{p.credits ?? ""}</td>
                <td className="num nowrap">{mark(p.cie, p.cieMax)}</td>
                <td className="num nowrap">{mark(p.ese, p.eseMax)}<div className="small grace-up">→ {p.gracedMarks}</div></td>
                <td><span className="grace-kind">{p.kind} grace +{p.marks}</span><div className="small muted">{change(p)}</div></td>
                <td className="num nowrap">{p.combPct ?? "—"}%</td>
                {i === 0 && <>
                  <td rowSpan={span} className="num nowrap">{s.used ?? "—"} of {s.pool ?? "—"}<div className="small muted">{s.left ?? "—"} left</div></td>
                  <td rowSpan={span}><Status status={s.status} /></td>
                </>}
              </tr>
            );
          }))}
        </tbody>
      </table>
    </div>
  );
}

function Refused({ rows, sid }) {
  if (!rows.length) return null;
  return (
    <div className="sheet" style={{ marginTop: 18 }}>
      <div className="sheet-head"><div><h2>Needed grace, pool used up</h2>
        <span className="small muted">Close enough to pass for gracing, but the student's grace pool could not cover it, so the paper fails.</span></div></div>
      <div className="scroll">
        <table className="ledger">
          <thead><tr><th>Regd No</th><th>Name</th><th>Batch</th><th>Paper</th><th className="num">Needed</th><th className="num">Left in pool</th></tr></thead>
          <tbody>
            {rows.map(r => {
              const [programme, semester, batch] = (r.batchKey || "||").split("|");
              return (
                <tr key={`${r.regdNo}|${r.paperCode}`}>
                  <td className="nowrap"><Link to={`/s/${sid}/students/${r.regdNo}`}>{r.regdNo}</Link></td>
                  <td>{r.name}</td>
                  <td>{r.batchId ? <Link to={`/s/${sid}/batches/${r.batchId}`}>{batchLabel(programme, semester, batch)}</Link> : batchLabel(programme, semester, batch)}</td>
                  <td className="nowrap"><b>{r.paperCode}</b></td>
                  <td className="num">{r.needed ?? "—"}</td>
                  <td className="num">{r.left ?? 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Report({ data, sid, sessionName }) {
  const all = useMemo(() => named(data.fields, data.rows)
    .sort((a, b) => a.batchKey.localeCompare(b.batchKey) || a.regdNo.localeCompare(b.regdNo) || a.paperCode.localeCompare(b.paperCode)), [data]);
  const refused = useMemo(() => named(data.refusedFields, data.refused).sort((a, b) => (a.batchKey || "").localeCompare(b.batchKey || "") || a.regdNo.localeCompare(b.regdNo)), [data]);
  const [f, setF] = useState(EMPTY);
  const [openAll, setOpenAll] = useState(false);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const options = k => [...new Set(all.map(r => r[k]).filter(Boolean))].sort();
  const filtered = Object.values(f).some(Boolean);

  const rows = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    return all.filter(r =>
      (!f.programme || r.programme === f.programme) && (!f.campus || r.campus === f.campus) && (!f.semester || r.semester === f.semester) &&
      (!f.kind || r.kind === f.kind) && (!f.status || r.status === f.status) &&
      (!q || r.regdNo.toLowerCase().includes(q) || (r.name || "").toLowerCase().includes(q) || (r.paperCode || "").toLowerCase().includes(q)));
  }, [all, f]);
  const groups = useMemo(() => {
    const m = new Map();
    for (const r of rows) (m.get(r.batchKey) || m.set(r.batchKey, []).get(r.batchKey)).push(r);
    return [...m];
  }, [rows]);
  const marks = Math.round(rows.reduce((n, r) => n + (Number(r.marks) || 0), 0) * 100) / 100;
  const students = new Set(rows.map(r => r.regdNo)).size;
  // A short list is shown open; a long one stays folded to one line per batch.
  const open = openAll || rows.length <= 40;

  return (
    <>
      <div className="stat-strip">
        <div><b>{students.toLocaleString()}</b><span>students graced</span></div>
        <div><b>{rows.length.toLocaleString()}</b><span>papers graced</span></div>
        <div><b>{marks.toLocaleString()}</b><span>grace marks given</span></div>
        <div><b>{rows.filter(r => r.kind === "ESE").length} / {rows.filter(r => r.kind === "COMB").length}</b><span>ESE / COMB grace</span></div>
        <div className={refused.length ? "alert" : ""}><b>{refused.length}</b><span>needed grace, pool used up</span></div>
      </div>

      {all.length === 0
        ? <div className="sheet"><EmptyState icon="check" title="No paper was graced">No failed paper in the latest results was within reach of grace marks.</EmptyState></div>
        : <>
          <div className="sheet pad filters">
            <div className="row" style={{ alignItems: "end" }}>
              {[["programme", "Programme"], ["campus", "Campus"], ["semester", "Semester"]].map(([k, l]) => (
                <label key={k}>{l}
                  <select value={f[k]} onChange={e => set(k, e.target.value)}><option value="">All</option>{options(k).map(o => <option key={o}>{o}</option>)}</select>
                </label>
              ))}
              <label>Grace<select value={f.kind} onChange={e => set("kind", e.target.value)}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label>Status<select value={f.status} onChange={e => set("status", e.target.value)}><option value="">All</option>{Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label style={{ flex: 1, minWidth: 200 }}>Search<input type="search" value={f.q} onChange={e => set("q", e.target.value)} placeholder="Regd No, name or paper" /></label>
              {filtered && <button className="btn quiet" onClick={() => setF(EMPTY)}>Clear</button>}
              <button className="btn" onClick={() => download(rows, sessionName)} disabled={!rows.length}><Icon name="download" />Download {filtered ? "these" : "all"} as CSV</button>
            </div>
            <p className="small muted" style={{ marginTop: 10 }}>
              {rows.length.toLocaleString()} graced paper{rows.length === 1 ? "" : "s"} of {all.length.toLocaleString()}, {students.toLocaleString()} student{students === 1 ? "" : "s"}.
              {rows.length > 40 && <> <button className="link-btn" onClick={() => setOpenAll(o => !o)}>{openAll ? "Fold all batches" : "Open all batches"}</button></>}
            </p>
          </div>

          <div className="sheet" id="fail-groups">
            {groups.length === 0 && <EmptyState icon="search" title="No graced papers match these filters" />}
            {groups.map(([k, bRows]) => {
              const [programme, semester, batch] = k.split("|");
              const n = new Set(bRows.map(r => r.regdNo)).size;
              const campuses = [...new Set(bRows.map(r => r.campus).filter(Boolean))].join(", ");
              return (
                <Disclosure key={`${k}|${open}`} defaultOpen={open} head={batchLabel(programme, semester, batch)} count={n} countLabel={`${n} students`}
                  extra={`${n} student${n === 1 ? "" : "s"}, ${bRows.length} paper${bRows.length === 1 ? "" : "s"}${campuses ? ` · ${campuses}` : ""}`}>
                  {bRows[0].batchId && <p className="cr-group-link small"><Link to={`/s/${sid}/batches/${bRows[0].batchId}`}>Open the batch page</Link></p>}
                  <BatchTable rows={bRows} sid={sid} />
                </Disclosure>
              );
            })}
          </div>
        </>}

      <Refused rows={refused} sid={sid} />
    </>
  );
}

export default function Grace() {
  const { sid, session } = useSession();
  const state = useLoad(`/sessions/${enc(sid)}/grace`);
  return (
    <div className="page wide">
      <div className="page-head">
        <div>
          <h1>Gracing</h1>
          <p className="sub muted">Every student who got grace marks, by batch: the paper, the ESE before and after, and how much of their grace pool it used.
            {state.data?.run ? ` From the results computed ${fmtWhen(state.data.run.startedAt)}.` : ""} The rules are under <Link to={`/s/${sid}/reference`}>Grading rules</Link>.</p>
        </div>
      </div>
      <Loading state={state}>{d => d.run
        ? <Report data={d} sid={sid} sessionName={session.data?.name || sid} />
        : <div className="sheet"><EmptyState icon="final" title="Nothing computed yet">Load the data sources and click Compute results.</EmptyState></div>}
      </Loading>
    </div>
  );
}
