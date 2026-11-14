import { useState } from "react";
import { api, enc } from "../api.js";
import { readFile } from "../xlsx.js";
import { useSession, useCan, Loading, useAction, fmtWhen } from "../components/ui.jsx";
import { Icon } from "../components/icons.jsx";
import { compute as runCompute, computedMessage } from "../lib/compute.js";   // Compute runs in this browser

const KINDS = [
  ["CMF", "Course master (CMF)", "Courses, credits, maximum marks, calculation type, CIE/ESE weightage and batch."],
  ["SMF", "Student master (SMF)", "Students with programme, semester, batch, Sem-Credits and elective choices."],
  ["PREV", "Previous semesters", "Earlier semesters' credits and grade points, for CGPA. Optional."],
  ["CIE", "CIE aggregate sheet", "Internal marks from departments. Use L for students who have left and A for absent."],
  ["ESE", "ESE aggregate sheet", "End-semester marks."]
];

// Which worksheet of an uploaded workbook belongs to each source: CMF and SMF usually come in one file with a tab each.
const TAB_MATCH = {
  CMF: [/^\s*cmf\s*$/i, /\bcmf\b/i, /course\s*master/i],
  SMF: [/^\s*smf\s*$/i, /\bsmf\b/i, /student\s*master/i],
  PREV: [/^\s*prev/i, /previous/i, /\bprev\b/i],
  CIE: [/^\s*cie\s*aggregate/i, /^\s*cie\s*$/i, /\bcie\b/i],
  ESE: [/^\s*ese\s*aggregate/i, /^\s*ese\s*$/i, /\bese\b/i]
};
const tabFor = (kind, sheets) => {
  for (const re of TAB_MATCH[kind] || []) { const t = sheets.find(s => re.test(s.name)); if (t) return t; }
  return sheets.length === 1 ? sheets[0] : null;
};
const DEFAULT_TAB = { CMF: "CMF", SMF: "SMF", CIE: "CIE Aggregate Sheet", ESE: "ESE Aggregate Sheet" };

function SourceRow({ kind, title, help, source, sid, canAdmin, canOperate, onChanged, fromMarkSheets }) {
  const [editing, setEditing] = useState(false);
  const [spreadsheet, setSpreadsheet] = useState(source?.spreadsheetId || "");
  const [sheetName, setSheetName] = useState(source?.sheetName || (kind === "CMF" || kind === "SMF" ? DEFAULT_TAB[kind] : ""));
  const [file, setFile] = useState(null);
  const [busy, run] = useAction();

  const save = async () => {
    const r = await run(() => api.put(`/sessions/${enc(sid)}/sources/${kind}`, { spreadsheet, sheetName }), "Sheet linked");
    if (r) { setEditing(false); onChanged(); }
  };
  const syncOne = async () => {
    const r = await run(async () => {
      const synced = await api.post(`/sessions/${enc(sid)}/sync`, { kinds: [kind] });
      if (!synced.sources[0]?.error) await runCompute(sid);
      return synced;
    }, r => r.sources[0]?.error || `${title}: ${r.sources[0]?.detail}. Results recomputed.`);
    if (r) onChanged();
  };
  const load = async (fileName, tab) => {
    const r = await run(() => api.post(`/sessions/${enc(sid)}/import`, { kind, values: tab.values, fileName }), r => `${title}: ${r.detail} (from the "${tab.name}" worksheet)`);
    if (r) { setFile(null); onChanged(); }
  };
  // The worksheet named for this source (the CMF tab for the course master, the SMF tab for the student master) is
  // loaded straight away; only when none matches is the person asked to pick one.
  const choose = async e => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const sheets = await run(() => readFile(f));
    if (!sheets) return;
    const tab = tabFor(kind, sheets);
    if (tab) await load(f.name, tab);
    else setFile({ name: f.name, sheets, pick: sheets[0].name });
  };
  const upload = () => load(file.name, file.sheets.find(s => s.name === file.pick));

  return (
    <div className="source">
      <div><b>{title}</b><p className="small muted">{help}</p></div>
      <div>
        {source?.lastSyncedAt
          ? <p>{source.rowCount?.toLocaleString()} rows, loaded {fmtWhen(source.lastSyncedAt)} by {source.lastSyncedBy}</p>
          : <p className="muted">Not loaded yet</p>}
        {source?.spreadsheetId
          ? <p className="small muted">Google Sheet {source.spreadsheetId.slice(0, 10)}…{source.sheetName ? `, tab "${source.sheetName}"` : ", first tab"}</p>
          : <p className="small muted">No Google Sheet linked</p>}
        {source?.warnings?.length > 0 && <ul className="warn-list">{source.warnings.slice(0, 5).map((w, i) => <li key={i}>{w}</li>)}{source.warnings.length > 5 && <li>and {source.warnings.length - 5} more</li>}</ul>}
        {editing && (
          <div className="row" style={{ marginTop: 10, alignItems: "end" }}>
            <label style={{ flex: 2 }}>Spreadsheet URL or ID<input value={spreadsheet} onChange={e => setSpreadsheet(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" /></label>
            <label style={{ flex: 1 }}>Tab name<input value={sheetName} onChange={e => setSheetName(e.target.value)} placeholder={DEFAULT_TAB[kind] || "first tab"} /></label>
            <button className="btn primary" disabled={busy || !spreadsheet} onClick={save}>Save link</button>
            <button className="btn quiet" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        )}
        {file && (
          <div className="row" style={{ marginTop: 10, alignItems: "end" }}>
            <span className="small muted" style={{ alignSelf: "center" }}>No worksheet named {kind} in this file. Which one?</span>
            <label>Tab in {file.name}<select value={file.pick} onChange={e => setFile({ ...file, pick: e.target.value })}>{file.sheets.map(s => <option key={s.name} value={s.name}>{s.name} ({s.values.length - 1} rows)</option>)}</select></label>
            <button className="btn primary" disabled={busy} onClick={upload}>Load this tab</button>
            <button className="btn quiet" onClick={() => setFile(null)}>Cancel</button>
          </div>
        )}
      </div>
      {fromMarkSheets && <div className="small muted" style={{ alignSelf: "center" }}>Read from <a href={`/s/${sid}/marksheets`}>Mark sheets</a></div>}
      {canOperate && !fromMarkSheets && (
        <div className="row" style={{ justifyContent: "flex-end" }}>
          {source?.spreadsheetId && <button className="btn" disabled={busy} onClick={syncOne}><Icon name="sync" />Sync</button>}
          {canAdmin && !editing && <button className="btn quiet" onClick={() => setEditing(true)}>{source?.spreadsheetId ? "Change link" : "Link sheet"}</button>}
          <label className="btn quiet"><Icon name="upload" />Upload file<input type="file" accept=".xlsx,.xls,.csv" hidden onChange={choose} /></label>
        </div>
      )}
    </div>
  );
}

export default function Sources() {
  const { sid, session } = useSession();
  const [busy, run] = useAction();
  const can = useCan();
  const syncAll = () => run(async () => {
    const r = await api.post(`/sessions/${enc(sid)}/sync`);
    return { ...r, compute: r.sources.some(s => !s.error) ? await runCompute(sid) : null };
  }, r => {
    const bad = r.sources.filter(s => s.error);
    return bad.length ? `Some sheets failed: ${bad.map(b => `${b.kind}: ${b.error}`).join("; ")}` : `Synced ${r.sources.length} sheets. ${r.compute?.releasable ?? 0} of ${r.compute?.students ?? 0} results ready.`;
  }).then(() => session.reload());
  const compute = () => run(() => runCompute(sid), computedMessage).then(() => session.reload());

  return (
    <div className="page">
      <Loading state={session}>{s => (
        <>
          <div className="page-head">
            <div><h1>Data sources</h1><p className="sub muted">Departments keep entering marks in the same Google Sheets. Each sync takes a fresh copy, records any corrected marks, and recomputes. After uploading files, click Compute results.</p></div>
            {can.operate && (
              <div className="row">
                {s.sources.some(x => x.spreadsheetId) && <button className="btn" disabled={busy} onClick={syncAll}><Icon name="sync" />Sync all sheets</button>}
                <button className="btn primary" disabled={busy || !s.counts.students || !s.counts.courses} onClick={compute}
                  title={!s.counts.students || !s.counts.courses ? "Load the CMF and SMF first" : "Compute results from the data loaded below"}><Icon name="compute" />Compute results</button>
              </div>
            )}
          </div>
          <div className="notice">
            Share each spreadsheet with the app's service account as a Viewer before linking it. Marks are never written back to the sheets.
          </div>
          <div className="sheet source-grid">
            {KINDS.map(([k, t, h]) => (
              <SourceRow key={k} kind={k} title={t} help={h} sid={sid} source={s.sources.find(x => x.kind === k)}
                canAdmin={can.admin} canOperate={can.operate} onChanged={session.reload} fromMarkSheets={!!s.markSheets?.[k]} />
            ))}
          </div>
        </>
      )}</Loading>
    </div>
  );
}
