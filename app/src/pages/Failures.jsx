import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { enc } from "../api.js";
import { useSession, useLoad, Loading, Status, STATUS_LABEL, EmptyState, Disclosure, fmtWhen, batchLabel } from "../components/ui.jsx";
import { Icon } from "../components/icons.jsx";

// Every failed or absent paper in the latest results, grouped by batch: who, which paper, the marks, and where it failed.
// Students whose result is still pending are included: a paper they failed has its marks and stays failed.

const isFailNP = v => typeof v === "string" && v.trim().startsWith("<");
// Where a paper was lost: an absent component, or the component(s) below the pass mark (else the combined mark).
function failedIn(p) {
  if (p.paperStatus === "Absent") {
    const parts = [String(p.cie).toUpperCase() === "A" && "CIE", String(p.ese).toUpperCase() === "A" && "ESE"].filter(Boolean);
    return parts.length ? `Absent in ${parts.join(" and ")}` : "Absent";
  }
  const parts = [isFailNP(p.cieNP) && "CIE", isFailNP(p.eseNP) && "ESE"].filter(Boolean);
  return parts.length ? `Failed in ${parts.join(" and ")}` : "Failed on the combined mark";
}
const mark = (raw, max) => (raw === null || raw === undefined || raw === "" ? "—" : max ? `${raw} / ${max}` : String(raw));
const pct = v => (v === null || v === undefined || v === "" ? "" : `${v}%`);
const KINDS = [["", "Failed and absent"], ["Fails", "Failed"], ["Absent", "Absent"]];
const EMPTY = { programme: "", campus: "", semester: "", paper: "", kind: "", status: "", q: "" };

function named(data) {
  return data.rows.map(v => Object.fromEntries(data.fields.map((f, i) => [f, v[i]])));
}

function download(rows, sessionName) {
  const head = ["S.No.", "Programme", "Campus", "Semester", "Batch", "Regd No", "Name", "Paper Code", "Paper Title", "Credits",
    "CIE", "CIE Max", "CIE %", "ESE", "ESE Max", "ESE %", "COMB %", "Result", "Where", "Status"];
  const esc = v => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = rows.map((r, i) => [i + 1, r.programme, r.campus, r.semester, r.batchKey.split("|")[2], r.regdNo, r.name, r.paperCode, r.title, r.credits,
    r.cie, r.cieMax, r.ciePct, r.ese, r.eseMax, r.esePct, r.combPct, r.paperStatus === "Absent" ? "Absent" : "Fail", failedIn(r), STATUS_LABEL[r.status] || r.status]);
  const csv = "﻿" + [head, ...lines].map(l => l.map(esc).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = `${sessionName} - Failures.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// One batch: a row per paper, the student's details once for all their papers.
function BatchTable({ rows, sid }) {
  const students = [];
  for (const r of rows) {
    const last = students[students.length - 1];
    if (last && last.regdNo === r.regdNo) last.papers.push(r);
    else students.push({ regdNo: r.regdNo, name: r.name, campus: r.campus, status: r.status, papers: [r] });
  }
  return (
    <div className="scroll">
      <table className="ledger fail-table">
        <thead>
          <tr><th>Regd No</th><th>Name</th><th>Campus</th><th>Paper</th><th className="num">Credits</th><th className="num">CIE</th><th className="num">ESE</th>
            <th className="num">COMB</th><th>Where</th><th>Status</th></tr>
        </thead>
        <tbody>
          {students.map(s => s.papers.map((p, i) => (
            <tr key={`${s.regdNo}|${p.paperCode}|${i}`} className={i === 0 ? "first" : ""}>
              {i === 0 && <>
                <td rowSpan={s.papers.length} className="nowrap"><Link to={`/s/${sid}/students/${s.regdNo}`}>{s.regdNo}</Link></td>
                <td rowSpan={s.papers.length}>{s.name}</td>
                <td rowSpan={s.papers.length}>{s.campus}</td>
              </>}
              <td><b className="nowrap">{p.paperCode}</b><div className="small muted">{p.title}</div></td>
              <td className="num">{p.credits ?? ""}</td>
              <td className="num nowrap">{mark(p.cie, p.cieMax)}<div className="small muted">{pct(p.ciePct)}</div></td>
              <td className="num nowrap">{mark(p.ese, p.eseMax)}<div className="small muted">{pct(p.esePct)}</div></td>
              <td className="num nowrap">{pct(p.combPct) || "—"}</td>
              <td><span className={`fail-where ${p.paperStatus === "Absent" ? "absent" : ""}`}>{failedIn(p)}</span></td>
              {i === 0 && <td rowSpan={s.papers.length}><Status status={s.status} /></td>}
            </tr>
          )))}
        </tbody>
      </table>
    </div>
  );
}

function Report({ data: raw, sid, sessionName }) {
  const all = useMemo(() => named(raw).sort((a, b) => a.batchKey.localeCompare(b.batchKey) || a.regdNo.localeCompare(b.regdNo) || a.paperCode.localeCompare(b.paperCode)), [raw]);
  const [f, setF] = useState(EMPTY);
  const [openAll, setOpenAll] = useState(false);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const options = k => [...new Set(all.map(r => r[k]).filter(Boolean))].sort();
  const filtered = Object.values(f).some(Boolean);

  const rows = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    return all.filter(r =>
      (!f.programme || r.programme === f.programme) && (!f.campus || r.campus === f.campus) && (!f.semester || r.semester === f.semester) &&
      (!f.paper || r.paperCode === f.paper) && (!f.kind || r.paperStatus === f.kind) && (!f.status || r.status === f.status) &&
      (!q || r.regdNo.toLowerCase().includes(q) || (r.name || "").toLowerCase().includes(q) || (r.paperCode || "").toLowerCase().includes(q)));
  }, [all, f]);

  const groups = useMemo(() => {
    const m = new Map();
    for (const r of rows) (m.get(r.batchKey) || m.set(r.batchKey, []).get(r.batchKey)).push(r);
    return [...m];
  }, [rows]);
  const stats = useMemo(() => ({
    students: new Set(rows.map(r => r.regdNo)).size,
    failed: rows.filter(r => r.paperStatus === "Fails").length,
    absent: rows.filter(r => r.paperStatus === "Absent").length,
    ready: new Set(rows.filter(r => r.status !== "held" && r.status !== "withheld").map(r => r.regdNo)).size
  }), [rows]);
  // A short list opens by itself; a long one stays folded to one line per batch.
  const open = openAll || groups.length <= 2;

  if (!all.length) return <div className="sheet"><EmptyState icon="check" title="No failures">No student has a failed or absent paper in the latest results.</EmptyState></div>;
  return (
    <>
      <div className="stat-strip">
        <div className={stats.students ? "alert" : ""}><b>{stats.students.toLocaleString()}</b><span>students with a failure</span></div>
        <div><b>{stats.failed.toLocaleString()}</b><span>papers failed</span></div>
        <div><b>{stats.absent.toLocaleString()}</b><span>papers absent</span></div>
        <div><b>{groups.length}</b><span>batches</span></div>
        <div><b>{stats.ready.toLocaleString()}</b><span>of these students ready or approved</span></div>
      </div>

      <div className="sheet pad filters">
        <div className="row" style={{ alignItems: "end" }}>
          {[["programme", "Programme"], ["campus", "Campus"], ["semester", "Semester"]].map(([k, l]) => (
            <label key={k}>{l}
              <select value={f[k]} onChange={e => set(k, e.target.value)}><option value="">All</option>{options(k).map(o => <option key={o}>{o}</option>)}</select>
            </label>
          ))}
          <label>Paper<select value={f.paper} onChange={e => set("paper", e.target.value)}><option value="">All</option>{options("paperCode").map(o => <option key={o}>{o}</option>)}</select></label>
          <label>Result<select value={f.kind} onChange={e => set("kind", e.target.value)}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label>Status<select value={f.status} onChange={e => set("status", e.target.value)}><option value="">All</option>{Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label style={{ flex: 1, minWidth: 200 }}>Search<input type="search" value={f.q} onChange={e => set("q", e.target.value)} placeholder="Regd No, name or paper" /></label>
          {filtered && <button className="btn quiet" onClick={() => setF(EMPTY)}>Clear</button>}
          <button className="btn" onClick={() => download(rows, sessionName)} disabled={!rows.length}><Icon name="download" />Download {filtered ? "these" : "all"} as CSV</button>
        </div>
        <p className="small muted" style={{ marginTop: 10 }}>
          {rows.length.toLocaleString()} paper{rows.length === 1 ? "" : "s"} of {all.length.toLocaleString()}, {stats.students.toLocaleString()} student{stats.students === 1 ? "" : "s"}.
          {groups.length > 2 && <> <button className="link-btn" onClick={() => setOpenAll(o => !o)}>{openAll ? "Fold all batches" : "Open all batches"}</button></>}
        </p>
      </div>

      <div className="sheet" id="fail-groups">
        {groups.length === 0 && <EmptyState icon="search" title="No failures match these filters" />}
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
    </>
  );
}

export default function Failures() {
  const { sid, session } = useSession();
  const state = useLoad(`/sessions/${enc(sid)}/failures`);
  return (
    <div className="page wide">
      <div className="page-head">
        <div>
          <h1>Failures</h1>
          <p className="sub muted">Every student with a failed or absent paper, by batch, with the marks and where the paper was lost.
            {state.data?.run ? ` From the results computed ${fmtWhen(state.data.run.startedAt)}.` : ""} Students still pending are included with their status.</p>
        </div>
      </div>
      <Loading state={state}>{d => d.run
        ? <Report data={d} sid={sid} sessionName={session.data?.name || sid} />
        : <div className="sheet"><EmptyState icon="final" title="Nothing computed yet">Load the data sources and click Compute results.</EmptyState></div>}
      </Loading>
    </div>
  );
}
