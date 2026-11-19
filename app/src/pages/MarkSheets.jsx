import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, enc } from "../api.js";
import { useSession, useCan, useLoad, Loading, EmptyState, Skeleton, Disclosure, useAction, useToast, fmtWhen } from "../components/ui.jsx";
import { Icon } from "../components/icons.jsx";
import { compute as runCompute, computedMessage } from "../lib/compute.js";   // Compute runs in this browser

// Every teacher's Marks Statement, read straight from Google Sheets. Replaces the Fetch CIE / Fetch ESE
// scripts with their Tracking, Completion Status and Aggregate sheets. Course masters are only read.
const STATUS = {
  pending: ["Not checked yet", "Collecting"],
  no_file: ["No file in course master", "Collecting"],
  filling: ["Teacher still filling", "Collecting"],
  validation: ["Awaiting validation", "Under-review"],
  partial: ["Partly fetched", "Under-review"],
  reopened: ["Reopened by teacher", "Under-review"],
  fetched: ["Fetched", "Approved"],
  no_access: ["No access", "Blocked"],
  template: ["Template problem", "Blocked"],
  missing_data: ["Data missing", "Blocked"],
  error: ["Error", "Blocked"]
};
const PROBLEM = new Set(["no_access", "template", "missing_data", "error"]);
const WITH_TEACHERS = new Set(["filling", "partial", "validation", "reopened"]);
// A status filter: one status, or a group shown by the tiles above the Sheets table.
const matchesStatus = (status, f) => !f || (f === "problem" ? PROBLEM.has(status) : f === "teachers" ? WITH_TEACHERS.has(status) : status === f);

function Masters({ d, sid, can, onChanged }) {
  const [form, setForm] = useState({ kind: "folder", component: "CIE", campus: "", url: "", sheetName: "" });
  const [busy, run] = useAction();
  const add = async () => {
    const r = await run(() => api.post(`/sessions/${enc(sid)}/marksheets/masters`, form), r => `Linked ${r.title || (r.kind === "folder" ? "the folder" : "course master")}${r.campus ? ` (campus ${r.campus})` : ""}`);
    if (r) { setForm({ ...form, url: "", campus: "", sheetName: "" }); onChanged(); }
  };
  const remove = async m => {
    if (!confirm(`Unlink ${m.title || "this source"}? Its sheets stop being checked; marks already fetched stay.`)) return;
    if (await run(() => api.del(`/sessions/${enc(sid)}/marksheets/masters/${m.id}`), "Unlinked")) onChanged();
  };
  const refresh = async () => {
    const r = await run(() => api.post(`/sessions/${enc(sid)}/marksheets/refresh`), r => {
      const bad = r.masters.filter(m => m.error || m.warnings?.length);
      return bad.length ? `Read with problems: ${bad.map(m => m.error || m.warnings[0]).join("; ")}` : `List updated from ${r.masters.length} source${r.masters.length === 1 ? "" : "s"}: ${r.masters.reduce((n, m) => n + m.rows, 0)} sheets`;
    });
    if (r) onChanged();
  };
  return (
    <div className="sheet">
      <div className="sheet-head">
        <div><h2>Where the Marks Statements are</h2><span className="small muted">Link the Drive folder that holds the Marks Statements (its subfolders are included), or a course master. Read only; the portal never changes them.</span></div>
        {can.operate && d.masters.length > 0 && <button className="btn" disabled={busy} onClick={refresh}><Icon name="sync" />Refresh list</button>}
      </div>
      {d.masters.length === 0 && <EmptyState icon="sources" title="Nothing linked yet">Link the CIE folder (for example "Nov 2026 CIE", with a subfolder per campus) and the ESE folder below. Share them with the service account as Viewer first. The campus is taken from each file name, such as MBAG-303_BRN.</EmptyState>}
      {d.masters.length > 0 && (
        <div className="scroll">
        <table className="ledger small">
          <thead><tr><th>Type</th><th>Campus</th><th>Source</th><th className="num">Sheets</th><th>Last read</th><th /></tr></thead>
          <tbody>{d.masters.map(m => (
            <tr key={m.id}>
              <td><b>{m.component}</b></td><td>{m.campus || (m.component === "CIE" ? <span className="muted">{m.kind === "folder" ? "From file names" : "Per row"}</span> : "—")}</td>
              <td><a href={m.kind === "folder" ? `https://drive.google.com/drive/folders/${m.spreadsheetId}` : `https://docs.google.com/spreadsheets/d/${m.spreadsheetId}/edit`} target="_blank" rel="noreferrer">{m.title || m.spreadsheetId}</a>
                <span className="muted"> ({m.kind === "folder" ? "folder" : "course master"}{m.sheetName ? `, tab ${m.sheetName}` : ""})</span>
                {m.lastError && <div className="small seal">{m.lastError}</div>}</td>
              <td className="num">{m.rowCount ?? "—"}</td><td className="small muted">{m.lastReadAt ? fmtWhen(m.lastReadAt) : "not read yet"}</td>
              <td className="num">{can.admin && <button className="btn quiet small" disabled={busy} onClick={() => remove(m)}>Unlink</button>}</td>
            </tr>
          ))}</tbody>
        </table>
        </div>
      )}
      {can.admin && (
        <div className="pad" style={{ borderTop: "1px solid var(--rule-soft)" }}>
          <div className="row end">
            <label>Source<select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}><option value="folder">Folder of Marks Statements</option><option value="master">Course master</option></select></label>
            <label>Type<select value={form.component} onChange={e => setForm({ ...form, component: e.target.value })}><option>CIE</option><option>ESE</option></select></label>
            {form.component === "CIE" && <label>Campus<input value={form.campus} onChange={e => setForm({ ...form, campus: e.target.value })} placeholder={form.kind === "folder" ? "from file names" : "from file or rows"} style={{ width: 130 }} /></label>}
            <label style={{ flex: 1, minWidth: 260 }}>{form.kind === "folder" ? "Folder link" : "Course master link"}<input value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} placeholder={form.kind === "folder" ? "https://drive.google.com/drive/folders/…" : "https://docs.google.com/spreadsheets/d/…"} /></label>
            {form.kind === "master" && <label>Tab<input value={form.sheetName} onChange={e => setForm({ ...form, sheetName: e.target.value })} placeholder="Sheet1" style={{ width: 110 }} /></label>}
            <button className="btn primary" disabled={busy || !form.url.trim()} onClick={add}>{form.kind === "folder" ? "Link folder" : "Link course master"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// A Marks Statement shown inside the portal exactly as it looks in Google Sheets (Google renders it for the service
// account): no new tab, no Google sign-in, and nobody appears among the sheet's viewers. Read only, current as of opening.
function SheetViewer({ sid, sheet, onClose }) {
  const [loaded, setLoaded] = useState(false);
  const file = `${String(sheet.courseCode || "Marks Statement").replace(/[^\w().-]+/g, "_")}${sheet.campus ? `_${sheet.campus}` : ""}.pdf`;
  const src = `/api/sessions/${enc(sid)}/marksheets/sheet/${enc(file)}?key=${enc(sheet.key)}#view=FitH&navpanes=0`;
  useEffect(() => {
    const esc = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", esc); document.body.style.overflow = ""; };
  }, [onClose]);
  const [label, cls] = STATUS[sheet.status] || [sheet.status, "Collecting"];
  return (
    <div className="sv-back" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="sv" role="dialog" aria-modal="true" aria-label={`Marks Statement ${sheet.courseCode}`}>
        <header className="sv-head">
          <div>
            <h2>{sheet.courseCode}{sheet.courseTitle ? `: ${sheet.courseTitle}` : ""}</h2>
            <p className="small muted">{[sheet.component, sheet.campus, sheet.programme && `${sheet.programme}${sheet.semester ? `, semester ${sheet.semester}` : ""}`, sheet.teacherName].filter(Boolean).join(", ")}. Read only, as it stands now.</p>
          </div>
          <div className="row">
            <span className={`stage ${cls}`}>{label}</span>
            <button className="btn" onClick={onClose} autoFocus>Close</button>
          </div>
        </header>
        <div className="sv-doc">
          {!loaded && <div className="sv-wait"><Skeleton /><p className="small muted">Getting the sheet from Google…</p></div>}
          <iframe title={`Marks Statement ${sheet.courseCode}`} src={src} onLoad={() => setLoaded(true)} style={loaded ? undefined : { position: "absolute", opacity: 0 }} />
        </div>
      </div>
    </div>
  );
}

// The sheets, one line per programme and semester with its CIE / ESE progress (the old Completion Status sheet). A line opens
// to its sheets. The status tiles and the filters narrow the lines; a search or a narrow filter opens the matching lines.
const groupKey = s => `${s.programme || "—"}|${s.semester || ""}`;
function SheetGroups({ sid, sheets, status, setStatus, fetchOne }) {
  const [f, setF] = useState({ component: "", campus: "", q: "" });
  const [opened, setOpened] = useState(null);   // null: as the filters suggest; true / false: Open all / Close all
  const [viewing, setViewing] = useState(null);
  const campuses = [...new Set(sheets.map(s => s.campus).filter(Boolean))].sort();
  const q = f.q.trim().toLowerCase();
  const matches = s => (!f.component || s.component === f.component) && (!f.campus || s.campus === f.campus) && matchesStatus(s.status, status) &&
    (!q || [s.courseCode, s.courseTitle, s.teacherName, s.programme, s.paperCode].some(v => String(v || "").toLowerCase().includes(q)));
  const filtering = !!(f.component || f.campus || q || status);

  const groups = useMemo(() => {
    const m = new Map();
    for (const s of sheets) {
      const k = groupKey(s);
      const g = m.get(k) || { key: k, programme: s.programme || "—", semester: s.semester, CIE: [0, 0], ESE: [0, 0], sheets: [] };
      if (s.inMaster) { g[s.component][1]++; if (s.status === "fetched") g[s.component][0]++; }
      g.sheets.push(s);
      m.set(k, g);
    }
    // Sheets that name no programme (often "Data missing" ones) go last.
    return [...m.values()].sort((a, b) => (a.programme === "—") - (b.programme === "—") || a.programme.localeCompare(b.programme) || String(a.semester).localeCompare(String(b.semester)));
  }, [sheets]);
  const shown = groups.map(g => ({ ...g, rows: g.sheets.filter(matches) })).filter(g => !filtering || g.rows.length);
  const matching = shown.reduce((n, g) => n + g.rows.length, 0);
  const autoOpen = filtering && (!!q || shown.length <= 6);
  const openKey = `${opened}|${autoOpen}|${f.component}|${f.campus}|${q}|${status}`;
  const part = ([done, total], label) => (total ? <span className={done === total ? "" : "muted"}>{label} {done}/{total}</span> : null);

  return (
    <div className="sheet" id="sheet-groups">
      <div className="sheet-head">
        <div><h2>Sheets by programme</h2><span className="small muted">{filtering ? `${matching} of ${sheets.length} sheets match, in ${plural(shown.length, "programme")}` : `Sheets fetched out of sheets expected, for ${plural(groups.length, "programme and semester", "programmes and semesters")}`}</span></div>
        <div className="row">
          <select value={f.component} onChange={e => setF({ ...f, component: e.target.value })} aria-label="Type"><option value="">CIE and ESE</option><option>CIE</option><option>ESE</option></select>
          {campuses.length > 0 && <select value={f.campus} onChange={e => setF({ ...f, campus: e.target.value })} aria-label="Campus"><option value="">All campuses</option>{campuses.map(c => <option key={c}>{c}</option>)}</select>}
          <select value={status} onChange={e => setStatus(e.target.value)} aria-label="Status">
            <option value="">Any status</option><option value="problem">Needs attention</option><option value="teachers">With teachers</option>
            {Object.entries(STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <input type="search" value={f.q} onChange={e => setF({ ...f, q: e.target.value })} placeholder="Course, teacher, programme" aria-label="Search sheets" />
          {shown.length > 1 && <button type="button" className="btn small quiet" onClick={() => setOpened(o => !(o ?? autoOpen))}>{(opened ?? autoOpen) ? "Close all" : "Open all"}</button>}
        </div>
      </div>
      <div className="cr-groups">
        {shown.map(g => {
          const done = g.CIE[0] === g.CIE[1] && g.ESE[0] === g.ESE[1];
          return (
            <Disclosure key={`${g.key}|${openKey}`} defaultOpen={opened ?? autoOpen}
              head={g.programme === "—" ? <span className="muted">No programme on the sheet</span> : <>{g.programme}{g.semester ? <span className="muted">, Sem {g.semester}</span> : ""}</>}
              extra={<span className="ms-progress">{part(g.CIE, "CIE")}{part(g.ESE, "ESE")}{done ? <span className="stage Approved">Completed</span> : <span className="stage Collecting">Pending</span>}</span>}
              count={filtering ? g.rows.length : g.sheets.length} countLabel={plural(filtering ? g.rows.length : g.sheets.length, filtering ? "matching sheet" : "sheet")}>
              <div className="scroll"><SheetRows rows={g.rows} onView={setViewing} fetchOne={fetchOne} /></div>
            </Disclosure>
          );
        })}
      </div>
      {shown.length === 0 && <EmptyState icon="search" title="No sheets match" />}
      {viewing && <SheetViewer sid={sid} sheet={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// fetchOne: { run(sheet), key: the sheet being fetched, blocked: a Fetch CIE / ESE run is going } (operators only).
function SheetRows({ rows, onView: setViewing, fetchOne }) {
  return (
        <table className="ledger small">
          <thead><tr><th>Type</th><th>Course</th><th>Campus</th><th>Teacher</th><th>Due</th><th>Status</th><th className="num">Marks</th><th>Checked</th><th /></tr></thead>
          <tbody>{rows.map(s => {
            const [label, cls] = STATUS[s.status] || [s.status, "Collecting"];
            return (
              <tr key={s.key} style={{ opacity: s.inMaster ? 1 : 0.55 }}>
                <td><b>{s.component}</b></td>
                <td>{s.hasFile ? <button className="link-btn" onClick={() => setViewing(s)} title="View this Marks Statement"><b>{s.courseCode}</b></button> : <b>{s.courseCode}</b>}{s.paperCode && s.paperCode !== s.courseCode && <span className="small muted"> (sheet says {s.paperCode})</span>}<div className="small muted">{s.courseTitle}</div>
                  {!s.inMaster && <div className="small faint">No longer in the course master</div>}</td>
                <td>{s.campus || "—"}</td>
                <td>{s.teacherName || "—"}{s.teacherEmail && <div className="small muted">{s.teacherEmail}</div>}</td>
                <td className="nowrap small">{s.dueDate || "—"}</td>
                <td><span className={`stage ${cls}`}>{label}</span>{s.lastError && <div className="small muted" style={{ maxWidth: 260 }}>{s.lastError}</div>}
                  {s.lastChanges > 0 && s.status === "fetched" && <div className="small" style={{ color: "var(--changed)" }}>{s.lastChanges} mark{s.lastChanges === 1 ? "" : "s"} corrected at last check</div>}</td>
                <td className="num nowrap">{s.marksCount ?? "—"}{s.students ? <span className="faint"> / {s.students}</span> : ""}</td>
                <td className="small muted nowrap">{s.lastCheckedAt ? fmtWhen(s.lastCheckedAt) : "never"}</td>
                <td className="nowrap">
                  {s.hasFile && <button className="btn quiet small" onClick={() => setViewing(s)} title="View this Marks Statement in the portal"><Icon name="open" />View</button>}
                  {fetchOne && s.hasFile && s.inMaster && (
                    <button className="btn quiet small" disabled={!!fetchOne.key || fetchOne.blocked} onClick={() => fetchOne.run(s)}
                      title={`Fetch ${s.courseCode} ${s.component} now. Marks are taken only once the sheet is certified${s.component === "ESE" ? " and validated" : ""}.`}>
                      <Icon name="sync" />{fetchOne.key === s.key ? "Fetching…" : "Fetch now"}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}</tbody>
        </table>
  );
}

// A sheet's percent may come back as a long decimal; marks may be letters (A, L).
const show = v => (typeof v === "number" ? (Number.isInteger(v) ? v : Math.round(v * 100) / 100) : v ?? "");

// The CIE / ESE marks tabs: every fetched row as the Marks Statement shows it (the old Aggregate Sheets).
function MarksTable({ sid, component, refresh = 0 }) {
  const [f, setF] = useState({ course: "", campus: "", programme: "", q: "", edited: "", page: 1 });
  const [typed, setTyped] = useState("");
  useEffect(() => { const t = setTimeout(() => setF(x => (x.q === typed ? x : { ...x, q: typed, page: 1 })), 300); return () => clearTimeout(t); }, [typed]);
  const set = patch => setF(x => ({ ...x, ...patch, page: patch.page ?? 1 }));
  const filters = new URLSearchParams(Object.entries({ component, course: f.course, campus: f.campus, programme: f.programme, q: f.q, edited: f.edited }).filter(([, v]) => v)).toString();
  // Page 1 brings the total and the filter lists, which read every row; other pages ask for the rows only (lite=1) and reuse them.
  const key = `${filters}|${refresh}`;
  const full = useRef({ key: null });
  const lite = f.page > 1 && full.current.key === key;
  const loaded = useLoad(`/sessions/${enc(sid)}/marksheets/rows?${filters}&page=${f.page}${lite ? "&lite=1" : ""}`, [refresh]);   // reloads as a fetch brings rows in
  if (!loaded.loading && loaded.data?.options) full.current = { key, total: loaded.data.total, options: loaded.data.options };
  const state = loaded.data && !loaded.data.options
    ? { ...loaded, data: { ...loaded.data, total: full.current.total, options: full.current.options ?? { courses: [], campuses: [], programmes: [] } } }
    : loaded;
  const cie = component === "CIE";
  return (
    <div className="sheet">
      <div className="sheet-head">
        <h2>{component} marks</h2>
        <div className="row">
          <select value={f.course} onChange={e => set({ course: e.target.value })} aria-label="Course"><option value="">All courses</option>{state.data?.options.courses.map(c => <option key={c}>{c}</option>)}</select>
          {cie && state.data?.options.campuses.length > 0 && <select value={f.campus} onChange={e => set({ campus: e.target.value })} aria-label="Campus"><option value="">All campuses</option>{state.data.options.campuses.map(c => <option key={c}>{c}</option>)}</select>}
          <select value={f.programme} onChange={e => set({ programme: e.target.value })} aria-label="Programme"><option value="">All programmes</option>{state.data?.options.programmes.map(c => <option key={c}>{c}</option>)}</select>
          <select value={f.edited} onChange={e => set({ edited: e.target.value })} aria-label="Remarks"><option value="">All rows</option><option value="1">With remarks</option></select>
          <input type="search" value={typed} onChange={e => setTyped(e.target.value)} placeholder="Regd No or course code" title="Finds Regd Nos and course codes that begin with what you type" aria-label={`Search ${component} marks`} />
          <a className="btn small" href={`/api/sessions/${enc(sid)}/marksheets/rows?${filters}&format=csv`} download><Icon name="download" />CSV</a>
        </div>
      </div>
      <Loading state={state}>{d => (
        <>
          <div className="scroll">
            <table className="ledger small">
              <thead><tr>{d.columns.map(c => <th key={c} className={/Marks|Percent|Points/.test(c) ? "num" : ""}>{c}</th>)}</tr></thead>
              <tbody>{d.rows.map((r, i) => (
                <tr key={`${r.regdNo}|${r.courseCode}|${r.campus}|${i}`}>
                  <td className="nowrap"><Link to={`/s/${sid}/students/${enc(r.regdNo)}`}>{r.regdNo}</Link></td>
                  {cie && <td>{r.campus || "—"}</td>}
                  <td className="nowrap">{r.courseCode}</td>
                  <td className="num">{show(r.marks)}{r.sheetMarks !== null && <div className="small faint" title="Mark in the Marks Statement">sheet: {show(r.sheetMarks)}</div>}</td>
                  <td className="num">{show(r.percent)}</td>
                  <td className="num">{show(r.points)}</td>
                  <td>{r.programme}</td>
                  <td>{r.semester}</td>
                  <td className="small">{r.remarks && <span style={{ color: "var(--changed)" }}>{r.remarks}</span>}</td>
                </tr>
              ))}</tbody>
            </table>
            {d.rows.length === 0 && <EmptyState icon="inbox" title={d.total === 0 && !filters.includes("&") ? `No ${component} marks fetched yet` : "No rows match"}
            >Rows appear here once a {component} Marks Statement is fetched.</EmptyState>}
          </div>
          {d.total > d.pageSize && (
            <div className="row between pad small muted">
              <span>Rows {(d.page - 1) * d.pageSize + 1}–{Math.min(d.page * d.pageSize, d.total)} of {d.total}</span>
              <span className="row">
                <button className="btn small" disabled={d.page <= 1} onClick={() => set({ page: d.page - 1 })}>Previous</button>
                <button className="btn small" disabled={d.page * d.pageSize >= d.total} onClick={() => set({ page: d.page + 1 })}>Next</button>
              </span>
            </div>
          )}
        </>
      )}</Loading>
    </div>
  );
}

function Body({ d, sid, reload, session }) {
  const [params, setParams] = useSearchParams();
  // With nothing linked yet, the page opens on Sources, where folders and course masters are linked.
  const tab = ["cie", "ese", "sources"].includes(params.get("tab")) ? params.get("tab") : d.sheets.length || d.masters.length ? "sheets" : "sources";
  const can = useCan();
  const toast = useToast();
  const [progress, setProgress] = useState(null);
  const [tick, setTick] = useState(0);   // bumped after each fetch step so the tables show new sheets straight away
  const [busy, run] = useAction();
  // The server sends each sheet as a list of values (lighter for it); name them here.
  const sheets = useMemo(() => d.sheets.map(row => {
    const s = Object.fromEntries(d.sheetFields.map((f, i) => [f, row[i]]));
    return { ...s, inMaster: !!s.inMaster, hasFile: !!s.hasFile };
  }), [d]);
  const active = sheets.filter(s => s.inMaster && s.hasFile);
  const count = st => sheets.filter(s => s.inMaster && (typeof st === "function" ? st(s.status) : s.status === st)).length;
  const [statusFilter, setStatusFilter] = useState("");
  const pick = f => {
    setStatusFilter(cur => (cur === f ? "" : f));   // clicking the chosen tile again clears it
    requestAnimationFrame(() => document.getElementById("sheet-groups")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const Tile = ({ f, n, label, className = "", style }) => (
    <button type="button" className={`${className}${statusFilter === f && f !== "" ? " on" : ""}`} aria-pressed={statusFilter === f}
      onClick={() => pick(f)} title={f ? `Show only: ${label}` : "Show all sheets"}><b style={style}>{n}</b><span>{label}</span></button>
  );

  const has = c => active.some(s => s.component === c);
  // CIE and ESE are fetched separately; each run lists and reads only that component's sheets.
  const fetchAll = async component => {
    let runId = null, total = null, skipped = 0, sums = { checked: 0, fetched: 0, changed: 0, errors: 0 }, lastTick = Date.now(), lastReload = 0;
    setProgress({ component, checked: 0, total: null });
    try {
      // 2 sheets a step (reading a sheet takes about 3 ms of CPU; Cloudflare's free plan allows a request 10 ms), at most one
      // step every 5 s: 48 Google reads a minute, under its limit of 60.
      const wait = ms => new Promise(res => setTimeout(res, ms));
      for (let guard = 0; guard < 2000; guard++) {
        const started = Date.now();
        const r = await api.post(`/sessions/${enc(sid)}/marksheets/fetch`, { runId, limit: 2, component });
        runId = r.runId;
        if (r.listed) skipped = r.skipped || 0;
        for (const k of Object.keys(sums)) sums[k] += r[k] || 0;
        total ??= r.listed ? r.remaining : r.checked + r.remaining;
        setProgress({ component, checked: sums.checked, total, skipped, ...sums, paused: r.rateLimited });
        // Reloading the sheet list reads every sheet (about 1,200 rows), so during a fetch it reloads at most every 30 s, and
        // the CIE / ESE marks list at most once a minute; both reload again at the end.
        if (r.listed || Date.now() - lastReload > 30000) { lastReload = Date.now(); reload(); }
        if (r.fetched > 0 && Date.now() - lastTick > 60000) { lastTick = Date.now(); setTick(t => t + 1); }
        if (r.remaining === 0 && !r.listed) break;
        if (r.listed) continue;
        await wait(r.rateLimited ? 60000 : Math.max(0, 5000 - (Date.now() - started)));
      }
      let msg = `${component}: checked ${sums.checked} sheet${sums.checked === 1 ? "" : "s"} not yet fetched, ${sums.fetched} now with marks${sums.errors ? `, ${sums.errors} need attention` : ""}.`;
      if (skipped) msg += ` ${skipped} already fetched were skipped (the morning check looks at them for corrections).`;
      if (sums.changed > 0) {
        const c = await runCompute(sid);
        msg += ` Marks changed, results recomputed: ${c.releasable} of ${c.students} ready.`;
      } else msg += " No marks changed.";
      toast(msg);
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setProgress(null);
      reload();
      if (sums.fetched > 0) setTick(t => t + 1);
      session.reload();
    }
  };
  const compute = () => run(() => runCompute(sid), computedMessage).then(() => { reload(); session.reload(); });

  // One course now, for an emergency: the same rules as Fetch (certified, and validated for ESE), without waiting for the rest.
  const [fetchingKey, setFetchingKey] = useState(null);
  const fetchSheet = async sheet => {
    setFetchingKey(sheet.key);
    try {
      const r = await api.post(`/sessions/${enc(sid)}/marksheets/check`, { key: sheet.key });
      const name = `${r.courseCode} ${r.component}${r.campus ? ` (${r.campus})` : ""}`;
      const label = (STATUS[r.status] || [r.status])[0];
      let msg;
      if (r.fetched) msg = `${name}: fetched, ${r.marks ?? 0}${r.students ? ` of ${r.students}` : ""} marks.${r.changes ? ` ${r.changes} mark${r.changes === 1 ? "" : "s"} changed.` : " No marks changed."}`;
      else if (r.status === "filling") msg = `${name}: not certified yet (${label}), so no marks were taken.`;
      else if (r.status === "validation") msg = `${name}: certified but not validated yet, so no marks were taken.`;
      else if (r.status === "reopened") msg = `${name}: the teacher has reopened the sheet; the marks fetched earlier are kept.`;
      else msg = `${name}: ${label}${r.error ? ` (${r.error})` : ""}.`;
      if (r.changes > 0) {
        const c = await runCompute(sid);
        msg += ` Results recomputed: ${c.releasable} of ${c.students} ready.`;
      }
      toast(msg, r.fetched || r.status === "filling" || r.status === "validation" || r.status === "reopened" ? undefined : "error");
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setFetchingKey(null);
      reload();
      session.reload();
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Mark sheets</h1>
          <p className="sub muted">Every teacher's Marks Statement, read straight from Google Sheets. Marks are taken once a sheet is certified (and validated, for ESE), and checked again every morning; a mark changed afterwards is recorded as a correction.</p>
        </div>
        {active.length > 0 && (
          <div className="row">
            <Link className="btn" to={`/s/${sid}/marksheets/morning`}><Icon name="history" />Morning summary</Link>
            {can.operate && <>
            {d.marksDirty && <button className="btn" disabled={busy || !!progress} onClick={compute}><Icon name="compute" />Compute results</button>}
            {has("CIE") && <button className="btn primary" disabled={!!progress} onClick={() => fetchAll("CIE")}><Icon name="sync" />Fetch CIE marks</button>}
            {has("ESE") && <button className="btn primary" disabled={!!progress} onClick={() => fetchAll("ESE")}><Icon name="sync" />Fetch ESE marks</button>}
            </>}
          </div>
        )}
      </div>

      {progress && (
        <div className="sheet pad mb-3" role="status">
          <div className="row between"><b>Fetching {progress.component} marks…</b><span className="small muted">{progress.checked}{progress.total ? ` of ${progress.total}` : ""} unfetched sheets checked{progress.skipped ? ` (${progress.skipped} already fetched, skipped)` : ""}{progress.fetched ? `, ${progress.fetched} with marks` : ""}{progress.total && progress.total > progress.checked ? `, about ${Math.ceil(((progress.total - progress.checked) / 2) * 5 / 60)} min left` : ""}{progress.paused ? ". Waiting a minute for Google's read limit" : ""}</span></div>
          <div className="strip mt-2" style={{ height: 10 }}><i className="approved" style={{ width: `${progress.total ? (progress.checked / progress.total) * 100 : 3}%`, transition: "width 0.3s" }} /></div>
        </div>
      )}

      <div className="tabs" role="tablist">
        {[["sheets", "Sheets", sheets.length], ["cie", "CIE marks", d.rowCounts.CIE], ["ese", "ESE marks", d.rowCounts.ESE], ["sources", "Sources and fetches", d.masters.length]].map(([k, l, n]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setParams(k === "sheets" ? {} : { tab: k }, { replace: true })}>{l}<span className="n">{n}</span></button>
        ))}
      </div>

      {tab === "cie" && <MarksTable key="CIE" sid={sid} component="CIE" refresh={tick} />}
      {tab === "ese" && <MarksTable key="ESE" sid={sid} component="ESE" refresh={tick} />}

      {tab === "sheets" && <>
      {sheets.length === 0 && <div className="sheet"><EmptyState icon="sources" title="No sheets listed yet"
        actions={<button className="btn" onClick={() => setParams({ tab: "sources" }, { replace: true })}>Go to Sources and fetches</button>}>Link the folders or course masters that hold the Marks Statements, then refresh the list.</EmptyState></div>}
      {sheets.length > 0 && (
        <div className="stat-strip">
          <Tile f="" n={count(() => true)} label="sheets" />
          <Tile f="fetched" n={count("fetched")} label="fetched" style={{ color: "var(--green)" }} />
          <Tile f="teachers" n={count(s => WITH_TEACHERS.has(s))} label="with teachers" />
          <Tile f="pending" n={count("pending")} label="not checked yet" />
          <Tile f="problem" n={count(s => PROBLEM.has(s))} label="need attention" className={count(s => PROBLEM.has(s)) ? "alert" : ""} />
          <Tile f="no_file" n={count("no_file")} label="no file yet" />
        </div>
      )}

      {sheets.length > 0 && <SheetGroups sid={sid} sheets={sheets} status={statusFilter} setStatus={setStatusFilter}
        fetchOne={can.operate ? { run: fetchSheet, key: fetchingKey, blocked: !!progress } : null} />}
      </>}

      {tab === "sources" && <>
      <Masters d={d} sid={sid} can={can} onChanged={() => { reload(); session.reload(); }} />

      {d.runs.length > 0 && (
        <div className="sheet">
          <div className="sheet-head"><h2>Recent fetches</h2><span className="small muted">Manual fetches and the automatic morning check</span></div>
          <div className="scroll">
          <table className="ledger small">
            <thead><tr><th>When</th><th>Type</th><th className="num">Checked</th><th className="num">With marks</th><th className="num">Marks changed</th><th className="num">Need attention</th><th>By</th></tr></thead>
            <tbody>{d.runs.map(r => (
              <tr key={r.id}><td className="nowrap">{fmtWhen(r.startedAt)}{!r.finishedAt && <span className="tag">in progress</span>}</td><td>{r.trigger === "daily" ? <Link to={`/s/${sid}/marksheets/morning?run=${r.id}`}>Morning check</Link> : "Manual"}{r.component ? `, ${r.component}` : r.trigger === "daily" ? "" : ", CIE and ESE"}</td>
                <td className="num">{r.checked}</td><td className="num">{r.fetched}</td><td className="num">{r.changed}</td><td className="num">{r.errors || ""}</td><td className="small muted">{r.by}</td></tr>
            ))}</tbody>
          </table>
          </div>
        </div>
      )}
      </>}
    </>
  );
}

export default function MarkSheets() {
  const { sid, session } = useSession();
  const state = useLoad(`/sessions/${enc(sid)}/marksheets`);
  return (
    <div className="page">
      <Loading state={state}>{d => <Body d={d} sid={sid} reload={state.reload} session={session} />}</Loading>
    </div>
  );
}
