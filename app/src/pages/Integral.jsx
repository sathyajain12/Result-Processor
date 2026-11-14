import { useState } from "react";
import { Link } from "react-router-dom";
import { api, enc } from "../api.js";
import { readFile } from "../xlsx.js";
import { useSession, useCan, useLoad, Loading, EmptyState, useAction, fmtWhen } from "../components/ui.jsx";
import { Icon } from "../components/icons.jsx";

const fmtItem = v => (v === "X" ? <span className="faint">X</span> : v);

function Upload({ sid, onDone }) {
  const [files, setFiles] = useState(null);
  const [busy, run] = useAction();

  const choose = async e => {
    const picked = [...(e.target.files || [])];
    e.target.value = "";
    if (!picked.length) return;
    const read = await run(() => Promise.all(picked.map(async f => {
      const tab = (await readFile(f)).find(t => t.name === "Consolidated");
      return { name: f.name.replace(/\.(xlsx|xls)$/i, ""), values: tab?.values ?? null };
    })));
    if (read) setFiles(read);
  };
  const load = async () => {
    const r = await run(() => api.post(`/sessions/${enc(sid)}/integral`, { files }), r => `Loaded ${r.rows} students from ${r.files.filter(f => !f.skipped).length} file(s)`);
    if (r) { setFiles(null); onDone(); }
  };

  return (
    <div className="sheet pad">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div><h3>Upload workbooks</h3><p className="small muted">Choose every "Integral Items-Data Entry" workbook. Each one's <b>Consolidated</b> tab is read; later files win when a student appears twice.</p></div>
        <label className="btn"><Icon name="upload" />Choose files<input type="file" accept=".xlsx,.xls" multiple hidden onChange={choose} /></label>
      </div>
      {files && (
        <>
          <table className="ledger small" style={{ marginTop: 12 }}>
            <thead><tr><th>File</th><th className="num">Rows</th><th>Consolidated tab</th></tr></thead>
            <tbody>{files.map(f => <tr key={f.name}><td>{f.name}</td><td className="num">{f.values ? f.values.length - 1 : "—"}</td><td>{f.values ? "Found" : <span style={{ color: "var(--seal)" }}>Missing, will be skipped</span>}</td></tr>)}</tbody>
          </table>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn primary" disabled={busy} onClick={load}>Load {files.length} file{files.length === 1 ? "" : "s"}</button>
            <button className="btn quiet" onClick={() => setFiles(null)}>Cancel</button>
            <span className="small muted">This replaces the Integral Items already loaded for this session.</span>
          </div>
        </>
      )}
    </div>
  );
}

function Links({ sid, links, canAdmin, canOperate, onDone }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(links.join("\n"));
  const [busy, run] = useAction();
  const save = async () => {
    if (await run(() => api.put(`/sessions/${enc(sid)}/integral/links`, { links: text.split(/\s+/) }), "Links saved")) { setEditing(false); onDone(); }
  };
  const sync = async () => {
    if (await run(() => api.post(`/sessions/${enc(sid)}/integral/sync`), r => `Synced ${r.rows} students`)) onDone();
  };
  return (
    <div className="sheet pad">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div><h3>Linked Google Sheets</h3><p className="small muted">{links.length ? `${links.length} sheet${links.length === 1 ? "" : "s"} linked.` : "None linked."} Share each with the service account as Viewer.</p></div>
        <div className="row">
          {canOperate && links.length > 0 && <button className="btn" disabled={busy} onClick={sync}><Icon name="sync" />Sync linked sheets</button>}
          {canAdmin && !editing && <button className="btn quiet" onClick={() => setEditing(true)}>{links.length ? "Change links" : "Link sheets"}</button>}
        </div>
      </div>
      {editing && (
        <div style={{ marginTop: 10 }}>
          <label>Spreadsheet URLs or IDs, one per line<textarea value={text} onChange={e => setText(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" /></label>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn primary" disabled={busy} onClick={save}>Save links</button>
            <button className="btn quiet" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Integral() {
  const { sid } = useSession();
  const can = useCan();
  const state = useLoad(`/sessions/${enc(sid)}/integral`);
  const [q, setQ] = useState("");

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Integral Items</h1><p className="sub muted">Grade points for up to five integral items per student, with their total. A report only: it does not change GPA.</p></div>
        <a className="btn" href={`/api/sessions/${enc(sid)}/export/integral.csv`}><Icon name="download" />Download as CSV</a>
      </div>
      <Loading state={state}>{d => {
        const needle = q.trim().toLowerCase();
        const rows = needle ? d.rows.filter(r => r.regdNo.toLowerCase().includes(needle) || (r.name || "").toLowerCase().includes(needle)) : d.rows;
        return (
          <>
            {can.operate && <Upload sid={sid} onDone={state.reload} />}
            {(can.operate || d.links.length > 0) && <Links sid={sid} links={d.links} canAdmin={can.admin} canOperate={can.operate} onDone={state.reload} />}

            {d.loadedAt && (
              <div className="sheet pad">
                <p>{d.rowCount.toLocaleString()} students, loaded {fmtWhen(d.loadedAt)} by {d.loadedBy}</p>
                {d.files.some(f => f.skipped) && <ul className="warn-list">{d.files.filter(f => f.skipped).map(f => <li key={f.name}>{f.name}: skipped, {f.reason}</li>)}</ul>}
                {d.warnings.length > 0 && <ul className="warn-list">{d.warnings.slice(0, 8).map((w, i) => <li key={i}>{w}</li>)}{d.warnings.length > 8 && <li>and {d.warnings.length - 8} more</li>}</ul>}
              </div>
            )}

            <div className="sheet">
              <div className="sheet-head">
                <h3>Students</h3>
                <input type="search" placeholder="Regd No or name" value={q} onChange={e => setQ(e.target.value)} aria-label="Filter students" />
              </div>
              {d.rows.length === 0
                ? <EmptyState icon="integral" title="No Integral Items loaded yet">Upload the workbooks or sync the linked sheets above.</EmptyState>
                : (
                  <div className="scroll">
                    <table className="ledger">
                      <thead><tr><th>Regd No</th><th>Name</th>{[1, 2, 3, 4, 5].map(i => <th key={i} className="num">INT{i}</th>)}<th className="num">Total</th><th className="num">Items</th><th>File</th></tr></thead>
                      <tbody>
                        {rows.map(r => (
                          <tr key={r.regdNo}>
                            <td>{r.name ? <Link to={`/s/${sid}/students/${r.regdNo}`}>{r.regdNo}</Link> : r.regdNo}</td>
                            <td>{r.name || <span className="faint">Not in SMF</span>}</td>
                            {r.items.map((v, i) => <td key={i} className="num">{fmtItem(v)}</td>)}
                            <td className="num"><b>{r.total.toFixed(2)}</b></td>
                            <td className="num">{r.count}</td>
                            <td className="small muted">{r.sourceFile}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {rows.length === 0 && <EmptyState icon="search" title="No students match" />}
                  </div>
                )}
            </div>
          </>
        );
      }}</Loading>
    </div>
  );
}
