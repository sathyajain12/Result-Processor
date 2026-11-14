import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { enc } from "../api.js";
import { useSession, useLoad, Loading, Status, STATUS_LABEL, EmptyState, fmtGpa, fmtWhen } from "../components/ui.jsx";
import { Icon } from "../components/icons.jsx";

const outcome = r => (r.withheld ? "withheld" : r.state === "Held" ? "held" : r.publishedGpa === "Absent" ? "absent" : r.publishedGpa === "Fail" ? "failed" : "passed");
const OUTCOMES = [["", "All results"], ["passed", "Passed"], ["failed", "Failed"], ["absent", "Absent"], ["withheld", "Withheld"], ["held", "Pending"]];

// Same columns as the FinalOutput sheet, plus failed courses and where the result stands.
const COLUMNS = [
  ["programme", "Program"], ["campus", "Campus"], ["semester", "Semester"], ["regdNo", "Regd No"], ["name", "Name"],
  ["totalPapers", "Total Paper", true], ["calculatedGpa", "Calculated GPA", true], ["sumCredits", "Sum of Credits", true],
  ["sumCreditNP", "Sum of (Credit × COMB NP)", true], ["publishedGpa", "Published GPA", true], ["letterGrade", "Letter Grade"],
  ["qualifier", "QA"], ["isAbsent", "Is Absent?", true], ["withheld", "Withheld case"], ["failedCourses", "Failed Course"], ["status", "Status"]
];

// Row colour by grade, like the sheet. Failed and absent results have no letter grade, so they get their own colour.
const GRADE_CLASS = { "O+": "g-oplus", O: "g-o", "A+": "g-aplus", A: "g-a", "B+": "g-b", B: "g-b", C: "g-c" };
const rowClass = (r, o) => (o === "passed" ? GRADE_CLASS[r.letterGrade] || "g-none" : `g-${o}`);
const cellText = (r, k) => {
  if (k === "calculatedGpa" || k === "publishedGpa") return fmtGpa(r[k]);
  if (k === "withheld") return r.withheld ? "WITHHELD" : "";
  if (k === "status") return STATUS_LABEL[r.status] || r.status;
  return r[k] ?? "";
};

function download(rows, sessionName) {
  const esc = v => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = "﻿" + [COLUMNS.map(c => c[1]), ...rows.map(r => COLUMNS.map(([k]) => cellText(r, k)))].map(r => r.map(esc).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = `${sessionName} - Final output.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// The server sends each student as a list of values (lighter for it); name them and sort as the sheet does.
function named(data) {
  if (!data.fields) return data;
  const rows = data.rows.map(v => {
    const r = Object.fromEntries(data.fields.map((f, i) => [f, v[i]]));
    return { ...r, releasable: !!r.releasable, isAbsent: r.isAbsent ? 1 : 0, withheld: r.state === "Withheld" };
  }).sort((a, b) => (a.programme || "").localeCompare(b.programme || "") || (a.semester || "").localeCompare(b.semester || "") || a.regdNo.localeCompare(b.regdNo));
  return { ...data, rows };
}

function Table({ data: raw, sid, sessionName }) {
  const data = useMemo(() => named(raw), [raw]);
  const [f, setF] = useState({ programme: "", campus: "", semester: "", outcome: "", status: "", q: "" });
  const [sort, setSort] = useState({ key: null, dir: 1 });
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const options = k => [...new Set(data.rows.map(r => r[k]).filter(Boolean))].sort();

  const rows = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    let list = data.rows.filter(r =>
      (!f.programme || r.programme === f.programme) && (!f.campus || r.campus === f.campus) && (!f.semester || r.semester === f.semester) &&
      (!f.outcome || outcome(r) === f.outcome) && (!f.status || r.status === f.status) &&
      (!q || r.regdNo.toLowerCase().includes(q) || (r.name || "").toLowerCase().includes(q)));
    if (sort.key) {
      const num = COLUMNS.find(c => c[0] === sort.key)?.[2];
      list = [...list].sort((a, b) => {
        const x = a[sort.key], y = b[sort.key];
        const nx = Number(x), ny = Number(y);
        if (num && Number.isFinite(nx) && Number.isFinite(ny)) return (nx - ny) * sort.dir;
        return String(x ?? "").localeCompare(String(y ?? "")) * sort.dir;
      });
    }
    return list;
  }, [data.rows, f, sort]);

  const counts = useMemo(() => rows.reduce((c, r) => (c[outcome(r)]++, c), { passed: 0, failed: 0, absent: 0, withheld: 0, held: 0 }), [rows]);
  const by = key => setSort(s => ({ key, dir: s.key === key ? -s.dir : 1 }));
  const filtered = Object.values(f).some(Boolean);

  return (
    <>
      <div className="sheet pad filters">
        <div className="row" style={{ alignItems: "end" }}>
          {[["programme", "Program"], ["campus", "Campus"], ["semester", "Semester"]].map(([k, l]) => (
            <label key={k}>{l}
              <select value={f[k]} onChange={e => set(k, e.target.value)}><option value="">All</option>{options(k).map(o => <option key={o}>{o}</option>)}</select>
            </label>
          ))}
          <label>Result<select value={f.outcome} onChange={e => set("outcome", e.target.value)}>{OUTCOMES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label>Status<select value={f.status} onChange={e => set("status", e.target.value)}><option value="">All</option>{Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label style={{ flex: 1, minWidth: 200 }}>Search<input type="search" value={f.q} onChange={e => set("q", e.target.value)} placeholder="Regd No or name" /></label>
          {filtered && <button className="btn quiet" onClick={() => setF({ programme: "", campus: "", semester: "", outcome: "", status: "", q: "" })}>Clear</button>}
          <button className="btn" onClick={() => download(rows, sessionName)} disabled={!rows.length}><Icon name="download" />Download {filtered ? "these" : "all"} as CSV</button>
        </div>
        <p className="small muted" style={{ marginTop: 10 }}>
          {rows.length.toLocaleString()} of {data.rows.length.toLocaleString()} students: {counts.passed} passed, {counts.failed} failed, {counts.absent} absent
          {counts.withheld ? `, ${counts.withheld} withheld` : ""}{counts.held ? `, ${counts.held} pending` : ""}.
        </p>
      </div>

      <div className="sheet">
        <div className="scroll final-scroll">
          <table className="ledger final">
            <thead>
              <tr>{COLUMNS.map(([k, l, num]) => (
                <th key={k} className={num ? "num" : ""} aria-sort={sort.key === k ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
                  <button className="th-sort" onClick={() => by(k)}>{l}{sort.key === k ? (sort.dir === 1 ? " ↑" : " ↓") : ""}</button>
                </th>
              ))}</tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const o = outcome(r);
                return (
                  <tr key={r.regdNo} className={rowClass(r, o)} title={r.reason || undefined}>
                    <td>{r.batchId ? <Link to={`/s/${sid}/batches/${r.batchId}`}>{r.programme}</Link> : r.programme}</td>
                    <td>{r.campus}</td>
                    <td>{r.semester}</td>
                    <td className="nowrap"><Link to={`/s/${sid}/students/${r.regdNo}`}>{r.regdNo}</Link></td>
                    <td className="nowrap">{r.name}</td>
                    <td className="num">{r.totalPapers}</td>
                    <td className="num">{fmtGpa(r.calculatedGpa)}</td>
                    <td className="num">{r.sumCredits ?? ""}</td>
                    <td className="num">{r.sumCreditNP ?? ""}</td>
                    <td className="num"><b>{o === "withheld" ? "—" : fmtGpa(r.publishedGpa)}</b></td>
                    <td><b>{r.letterGrade || (o === "failed" ? "Fail" : o === "absent" ? "Absent" : "")}</b></td>
                    <td>{r.qualifier}</td>
                    <td className="num">{r.isAbsent}</td>
                    <td>{r.withheld && <b>WITHHELD</b>}</td>
                    <td className="small">{r.failedCourses}</td>
                    <td><Status status={r.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 && <EmptyState icon="search" title="No students match these filters" />}
        </div>
      </div>
    </>
  );
}

export default function FinalOutput() {
  const { sid, session } = useSession();
  const state = useLoad(`/sessions/${enc(sid)}/final`);
  return (
    <div className="page wide">
      <div className="page-head">
        <div>
          <h1>Final output</h1>
          <p className="sub muted">Every student's semester result, laid out like the FinalOutput sheet.{state.data?.run ? ` Computed ${fmtWhen(state.data.run.startedAt)}.` : ""} Click a column to sort; hover a pending row for the reason.</p>
        </div>
        <div className="legend final-legend">
          {[["g-oplus", "O+"], ["g-o", "O"], ["g-aplus", "A+"], ["g-a", "A"], ["g-b", "B"], ["g-c", "C"], ["g-failed", "Fail / Absent"], ["g-withheld", "Withheld"], ["g-held", "Pending"]].map(([c, l]) => (
            <span key={c}><i className={c} />{l}</span>
          ))}
        </div>
      </div>
      <Loading state={state}>{d => d.run
        ? <Table data={d} sid={sid} sessionName={session.data?.name || sid} />
        : <div className="sheet"><EmptyState icon="final" title="Nothing computed yet">Load the data sources and click Compute results.</EmptyState></div>}
      </Loading>
    </div>
  );
}
