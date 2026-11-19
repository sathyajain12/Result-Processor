import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { enc } from "../api.js";
import { checkInBrowser, storedReportInBrowser } from "../lib/compute.js";
import { useSession, useCan, Loading, EmptyState, Disclosure, fmtWhen, batchLabel } from "../components/ui.jsx";
import DetentionReason from "../components/DetentionReason.jsx";
import { Icon } from "../components/icons.jsx";

// The Apps Script completeness report, in the same sections: hard blocks in red, warnings in amber.
// One section is shown at a time, picked from the list at the side, and long lists are grouped by batch, then paper.
const OVERRIDE_LABEL = {
  "exclude-student": "Student left out", "exclude-paper": "Paper left out for everyone", "skip-validation": "Validation skipped",
  "student-batch": "Batch chosen", "course-field": "Course value changed"
};
const CODE_LABEL = {
  NOT_IN_SMF: "Not in SMF", UNKNOWN_PAPER: "Unknown paper", CREDIT_MISMATCH: "Credit mismatch", COURSE_MISMATCH: "Course mismatch",
  LEFT_STUDENT: "Left (L)", PAPER_EXCLUDED: "Paper left out"
};
const label = key => { const [p, s, b] = (key || "").split("|"); return batchLabel(p, s, b); };
const list = (rows, max = 6) => rows.length <= max ? rows.join(", ") : `${rows.slice(0, max).join(", ")} (+${rows.length - max} more)`;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function Section({ n, title, kind, empty, count, children }) {
  return (
    <section className={`cr-section ${kind}`}>
      <header><span className="cr-n">{n}</span><h2>{title}</h2>{count > 0 && <span className="cr-count">{count}</span>}</header>
      {count > 0 ? <div className="scroll">{children}</div> : <p className="cr-ok"><Icon name="check" />{empty}</p>}
    </section>
  );
}

function Batch({ sid, k, id }) {
  return id ? <Link to={`/s/${sid}/batches/${id}`}>{label(k)}</Link> : label(k);
}
function Student({ sid, regdNo, name }) {
  return regdNo ? <><Link to={`/s/${sid}/students/${regdNo}`}>{regdNo}</Link>{name && <span className="muted"> {name}</span>}</> : "—";
}
const Accepted = ({ e }) => (e.accepted ? <span className="tag">accepted</span> : null);

// The students in one group. Batch (and paper, when grouped by paper) are already in the headings above.
const issueText = e => (e.paperCode && e.message.startsWith(`${e.paperCode}: `) ? e.message.slice(e.paperCode.length + 2) : e.message);
function StudentRows({ sid, rows, showPaper }) {
  return (
    <table className="ledger small cr-students">
      <thead><tr><th>Student</th>{showPaper && <th>Paper</th>}<th>Issue</th></tr></thead>
      <tbody>{rows.map((e, i) => (
        <tr key={i}><td><Student sid={sid} regdNo={e.regdNo} name={e.name} /></td>{showPaper && <td className="nowrap">{e.paperCode || "—"}</td>}
          <td>{issueText(e)}<Accepted e={e} /></td></tr>
      ))}</tbody>
    </table>
  );
}

const groupBy = (rows, keyOf) => {
  const m = new Map();
  for (const r of rows) { const k = keyOf(r); (m.get(k) || m.set(k, []).get(k)).push(r); }
  return [...m].sort((a, b) => b[1].length - a[1].length || String(a[0]).localeCompare(String(b[0])));
};
// The commonest issue text in a group, without the "PAPER: " prefix the engine puts on paper-level messages.
function issueSummary(rows) {
  const texts = groupBy(rows, issueText);
  return texts.length > 1 ? `${texts[0][0]}, and ${plural(texts.length - 1, "other issue")}` : texts[0][0];
}

// Per-student findings, by batch (largest first), then by paper or issue, then the students.
function GroupedRows({ sid, rows, by = "paper" }) {
  const batches = groupBy(rows, e => e.batchKey || "");
  const keyOf = by === "code" ? e => CODE_LABEL[e.code] || e.code : e => e.paperCode || "No paper";
  return (
    <div className="cr-groups">
      {batches.map(([k, bRows]) => {
        const parts = groupBy(bRows, keyOf);
        return (
          <Disclosure key={k} level={1} head={k ? label(k) : "No batch"} count={bRows.length} countLabel={plural(bRows.length, "finding")}
            extra={plural(parts.length, by === "code" ? "kind" : "paper")} defaultOpen={batches.length === 1}>
            {k && bRows[0].batchId && <p className="cr-group-link small"><Link to={`/s/${sid}/batches/${bRows[0].batchId}`}>Open the batch page</Link></p>}
            {parts.map(([part, pRows]) => {
              const students = new Set(pRows.map(e => e.regdNo).filter(Boolean)).size;
              return (
                <Disclosure key={part} level={2} head={part} extra={issueSummary(pRows)} count={students || pRows.length}
                  countLabel={students ? plural(students, "student") : plural(pRows.length, "finding")} defaultOpen={parts.length === 1 && batches.length === 1}>
                  <StudentRows sid={sid} rows={pRows} showPaper={by === "code"} />
                </Disclosure>
              );
            })}
          </Disclosure>
        );
      })}
    </div>
  );
}

const NAV = [
  ["Hard blocks", ["rule0", "rule1a", "noFetch", "rule1bHard", "rule2Hard", "rule3aHard", "rule3bHard"]],
  ["Warnings", ["rule1bWarn", "rule2Warn", "rule3aWarn", "rule3bWarn"]],
  ["Batches", ["blocked", "eligible"]],
  ["Students and overrides", ["detained", "other", "overrides"]]
];
const ALWAYS_LISTED = new Set(["blocked", "eligible"]);   // shown even at 0: they say where every batch stands

function SectionNav({ sections, current, onPick }) {
  const byId = Object.fromEntries(sections.map(s => [s.id, s]));
  const clear = sections.filter(s => !s.count && !ALWAYS_LISTED.has(s.id));
  return (
    <nav className="cr-nav" aria-label="Report sections">
      {NAV.map(([group, ids]) => {
        const items = ids.map(id => byId[id]).filter(s => s.count || ALWAYS_LISTED.has(s.id));
        if (!items.length) return null;
        return (
          <div key={group} className="cr-nav-group">
            <div className="cr-nav-label">{group}</div>
            {items.map(s => (
              <button key={s.id} type="button" className={`cr-nav-item ${s.kind}${s.id === current ? " on" : ""}`} aria-current={s.id === current ? "true" : undefined} onClick={() => onPick(s.id)}>
                {s.n && <span className="cr-nav-n">{s.n}</span>}<span className="cr-nav-title">{s.short}</span><span className="cr-nav-count">{s.count.toLocaleString("en-IN")}</span>
              </button>
            ))}
          </div>
        );
      })}
      {clear.length > 0 && <p className="cr-clear"><Icon name="check" /><span><b>All clear:</b> {clear.map(s => `${s.short}${s.kind === "warn" ? " (warnings)" : ""}`).join("; ")}</span></p>}
    </nav>
  );
}

function Report({ d, sid, reload }) {
  const can = useCan();
  const [params, setParams] = useSearchParams();
  const contentRef = useRef(null);
  const batch = params.get("batch") || "";
  const setParam = (key, value) => setParams(p => { const n = new URLSearchParams(p); value ? n.set(key, value) : n.delete(key); return n; });

  const hard = d.rule0.length + d.rule1a.length + d.noFetch.length + d.rule1bHard.length + d.rule2Hard.length + d.rule3aHard.length;
  const warn = d.rule1bWarn.length + d.rule2Warn.length + d.rule3aWarn.length + d.rule3bWarn.length;
  const byBatch = rows => Object.entries(rows.reduce((m, e) => ((m[e.batchKey] ||= []).push(e), m), {}));
  // The batch filter narrows anything tied to a batch; course-level findings and overrides always show.
  const only = rows => (batch ? rows.filter(r => !r.batchKey || r.batchKey === batch) : rows);
  const batchKeys = [...new Set([...d.blocked, ...d.eligible].map(b => b.batchKey))].sort((a, b) => label(a).localeCompare(label(b)));

  const r = Object.fromEntries(["overrides", "rule0", "rule1a", "noFetch", "rule1bHard", "rule1bWarn", "rule2Hard", "rule2Warn", "rule3aHard", "rule3aWarn",
    "rule3bWarn", "blocked", "eligible", "detained", "other"].map(k => [k, only(d[k])]));

  const sections = [
    { id: "overrides", n: "", short: "Manual overrides", title: "Manual overrides", kind: "note", empty: "No active overrides", rows: r.overrides, render: rows => (
      <table className="ledger small">
        <thead><tr><th>Override</th><th>Student</th><th>Paper</th><th>Reason</th><th>By</th></tr></thead>
        <tbody>{rows.map(o => (
          <tr key={o.id}><td>{OVERRIDE_LABEL[o.type] || o.type}{o.field ? ` (${o.field} = ${o.value})` : o.type === "student-batch" ? ` (${o.value})` : ""}</td>
            <td className="nowrap">{o.regdNo ? <Student sid={sid} regdNo={o.regdNo} name={o.name} /> : "All students"}</td><td>{o.paperCode || "—"}</td>
            <td>{o.reason}</td><td className="small muted nowrap">{o.by}, {fmtWhen(o.at)}</td></tr>
        ))}</tbody>
      </table>
    ) },
    { id: "rule0", n: "1", short: "Rule 0 — No CMF batch match", title: "Rule 0 — No CMF batch match", kind: "hard", empty: "All programme + semester + batch groups have matching CMF courses", rows: r.rule0, render: rows => (
      <table className="ledger small">
        <thead><tr><th>Batch</th><th>Reason</th></tr></thead>
        <tbody>{rows.map((e, i) => <tr key={i}><td><Batch sid={sid} k={e.batchKey} id={e.batchId} /></td><td>No CMF courses found for this batch — check the CMF Batch column<Accepted e={e} /></td></tr>)}</tbody>
      </table>
    ) },
    { id: "rule1a", n: "2", short: "Rule 1A — Student count", title: "Rule 1A — Student count", kind: "hard", empty: "Every SMF student appears in both the CIE and the ESE file", rows: r.rule1a, render: rows => (<>
      <table className="ledger small">
        <thead><tr><th>Batch</th><th className="num">SMF</th><th className="num">In CIE</th><th className="num">In ESE</th><th>Missing in CIE</th><th>Missing in ESE</th></tr></thead>
        <tbody>{rows.map(x => (
          <tr key={x.batchKey}><td className="nowrap"><Batch sid={sid} k={x.batchKey} id={x.batchId} /></td><td className="num">{x.smf}</td><td className="num">{x.cie}</td><td className="num">{x.ese}</td>
            <td>{x.missingCie.length ? list(x.missingCie.map(s => s.regdNo)) : "None"}</td><td>{x.missingEse.length ? list(x.missingEse.map(s => s.regdNo)) : "None"}</td></tr>
        ))}</tbody>
      </table>
      <p className="small muted cr-foot">These students are pending until their marks arrive; the rest of the batch can go ahead.</p>
    </>) },
    { id: "noFetch", n: "3", short: "No fetch data", title: "No fetch data", kind: "hard", empty: "Every batch has CIE and ESE marks", rows: r.noFetch, render: rows => (
      <table className="ledger small">
        <thead><tr><th>Batch</th><th>Missing</th></tr></thead>
        <tbody>{rows.map(x => <tr key={x.batchKey}><td><Batch sid={sid} k={x.batchKey} id={x.batchId} /></td><td>{x.missing.join(" + ")} marks absent for the whole batch</td></tr>)}</tbody>
      </table>
    ) },
    { id: "rule1bHard", n: "4", short: "Rule 1B — Course count", title: "Rule 1B — Course count", kind: "hard", empty: "No hard blocks", rows: r.rule1bHard, render: rows => (
      <table className="ledger small">
        <thead><tr><th>Batch</th><th>Course</th><th className="num">Students with mark</th><th className="num">Expected</th><th>Status</th></tr></thead>
        <tbody>{rows.map((e, i) => (
          <tr key={i}><td className="nowrap"><Batch sid={sid} k={e.batchKey} id={e.batchId} /></td><td>{e.paperCode}{e.details.options?.length > 1 && <span className="small muted"> (any of {e.details.options.join(", ")})</span>}</td>
            <td className="num">0</td><td className="num">{e.details.expected ?? e.details.students ?? "—"}</td><td><b className="seal">Completely absent</b> — batch blocked<Accepted e={e} /></td></tr>
        ))}</tbody>
      </table>
    ) },
    { id: "rule1bWarn", n: "5", short: "Rule 1B — Course count", title: "Rule 1B — Course count", kind: "warn", empty: "No warnings", rows: r.rule1bWarn, render: rows => (<>
      <table className="ledger small">
        <thead><tr><th>Batch</th><th>Partial courses</th></tr></thead>
        <tbody>{byBatch(rows).map(([k, bRows]) => (
          <tr key={k}><td className="nowrap"><Batch sid={sid} k={k} id={bRows[0].batchId} /></td>
            <td>{bRows.map((e, i) => <div key={i}><b>{e.paperCode}</b> ({e.details.arrived ?? "?"}/{e.details.expected ?? "?"}){e.details.missing?.length ? <span className="muted">, missing {list(e.details.missing, 8)}</span> : null}<Accepted e={e} /></div>)}</td></tr>
        ))}</tbody>
      </table>
      <p className="small muted cr-foot">A partly arrived course alone does not make anyone pending. A student without it is graded on the papers they have; the Sem-Credits check withholds the result if credits then fall short.</p>
    </>) },
    { id: "rule2Hard", n: "6", short: "Rule 2 — Marks quality", title: "Rule 2 — Marks quality", kind: "hard", empty: "No blank or unreadable marks", rows: r.rule2Hard, render: rows => <GroupedRows sid={sid} rows={rows} /> },
    { id: "rule2Warn", n: "7", short: "Rule 2 — Marks quality", title: "Rule 2 — Marks quality", kind: "warn", empty: "No zero or low marks", rows: r.rule2Warn, render: rows => <GroupedRows sid={sid} rows={rows} /> },
    { id: "rule3aHard", n: "8", short: "Rule 3A — CMF weightage", title: "Rule 3A — CMF weightage", kind: "hard", empty: "Every course has CIE + ESE weightage totalling 100", rows: r.rule3aHard, render: rows => (
      <table className="ledger small">
        <thead><tr><th>Course</th><th>Issue</th></tr></thead>
        <tbody>{rows.map((e, i) => <tr key={i}><td>{e.courseCode}</td><td>{e.message}<Accepted e={e} /></td></tr>)}</tbody>
      </table>
    ) },
    { id: "rule3aWarn", n: "9", short: "Rule 3A — CMF weightage", title: "Rule 3A — CMF weightage", kind: "warn", empty: "Every course uses the standard 50 : 50 (B.Ed 30 : 70)", rows: r.rule3aWarn, render: rows => (
      <table className="ledger small">
        <thead><tr><th>Course</th><th>Issue</th></tr></thead>
        <tbody>{rows.map((e, i) => <tr key={i}><td>{e.courseCode}</td><td>{e.message}<Accepted e={e} /></td></tr>)}</tbody>
      </table>
    ) },
    { id: "rule3bHard", n: "10", short: "Rule 3B — Marks vs CMF max", title: "Rule 3B — Marks vs CMF max", kind: "hard", empty: "No hard blocks — a mark above the maximum is a warning (section 11)", rows: [], render: () => null },
    { id: "rule3bWarn", n: "11", short: "Rule 3B — Marks vs CMF max", title: "Rule 3B — Marks vs CMF max", kind: "warn", empty: "Every mark is within its CMF maximum", rows: r.rule3bWarn, render: rows => <GroupedRows sid={sid} rows={rows} /> },
    { id: "blocked", n: "12", short: "Hard blocked batches", title: "Hard blocked batches — cannot release results", kind: "hard", empty: "No batches blocked — pipeline is clear", rows: r.blocked, render: rows => (
      <table className="ledger small">
        <thead><tr><th>Batch</th><th className="num">Students</th><th>Blocking reasons</th></tr></thead>
        <tbody>{rows.map(b => <tr key={b.batchKey}><td><Batch sid={sid} k={b.batchKey} id={b.batchId} /></td><td className="num">{b.students}</td><td>{b.reasons.join(" | ")}</td></tr>)}</tbody>
      </table>
    ) },
    { id: "eligible", n: "13", short: "Eligible batches", title: "Eligible batches — entering approval", kind: "good", empty: "No eligible batches yet", rows: r.eligible, render: rows => (
      <EligibleTable sid={sid} rows={rows} status={params.get("status") || ""} setStatus={v => setParam("status", v)} />
    ) },
    { id: "detained", n: "14", short: "Detained students", title: "Detained students — processing with active batch CMF", kind: "detained", empty: "No detained students this cycle", rows: r.detained, render: rows => (
      <table className="ledger small">
        <thead><tr><th>Student</th><th>Batch</th><th>Original batch</th><th>Processing with CMF batch</th><th>Why</th></tr></thead>
        <tbody>{rows.map((e, i) => (
          <tr key={i}><td className="nowrap"><Student sid={sid} regdNo={e.regdNo} name={e.name} /></td><td className="nowrap"><Batch sid={sid} k={e.batchKey} id={e.batchId} /></td>
            <td>{e.code === "BATCH_REROUTED" ? e.details.fromBatch || "—" : e.batchKey?.split("|")[2] || "—"}</td>
            <td>{e.code === "BATCH_REROUTED" ? e.details.toBatch : <span className="seal">Ambiguous: {(e.details.batches || []).join(", ")}. Choose a batch</span>}<Accepted e={e} /></td>
            <td className="small" style={{ minWidth: 320 }}>{e.message}<DetentionReason sid={sid} regdNo={e.regdNo} value={e.recordedReason} canEdit={can.operate} onSaved={reload} /></td></tr>
        ))}</tbody>
      </table>
    ) },
    { id: "other", n: "", short: "Other checks", title: "Other checks", kind: "note", empty: "No students outside the SMF, unknown papers or credit mismatches", rows: r.other, render: rows => <GroupedRows sid={sid} rows={rows} by="code" /> }
  ].map(s => ({ ...s, count: s.rows.length }));

  const byId = Object.fromEntries(sections.map(s => [s.id, s]));
  const firstWith = ids => ids.find(id => byId[id].count);
  const fallback = firstWith(NAV[0][1]) || firstWith(NAV.flatMap(([, ids]) => ids)) || "eligible";
  const current = byId[params.get("section")] ? params.get("section") : fallback;
  const s = byId[current];

  const pick = id => {
    setParam("section", id);
    // On a narrow screen the list sits above the section: bring the section into view.
    const top = contentRef.current?.getBoundingClientRect().top;
    if (top !== undefined && (top < 0 || top > window.innerHeight * 0.6)) contentRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <>
      <div className="stat-strip">
        <div><b style={{ color: "var(--green)" }}>{d.eligible.length}</b><span>batches eligible</span></div>
        <div className={d.blocked.length ? "alert" : ""}><b>{d.blocked.length}</b><span>batches hard blocked</span></div>
        <div><b>{hard}</b><span>hard-block findings</span></div>
        <div><b>{warn}</b><span>warnings</span></div>
        <div><b>{d.overrides.length}</b><span>manual overrides</span></div>
        <div><b>{d.detained.length}</b><span>detained students</span></div>
      </div>

      <div className="cr-filter">
        <label htmlFor="cr-batch">Batch</label>
        <select id="cr-batch" value={batch} onChange={e => setParam("batch", e.target.value)}>
          <option value="">All batches</option>
          {batchKeys.map(k => <option key={k} value={k}>{label(k)}</option>)}
        </select>
        {batch && <button type="button" className="btn small" onClick={() => setParam("batch", "")}>Show all batches</button>}
      </div>

      <div className="cr-layout">
        <SectionNav sections={sections} current={current} onPick={pick} />
        <div className="cr-content" ref={contentRef}>
          <Section key={`${current}|${batch}`} n={s.n} title={s.title} kind={s.kind} empty={s.empty} count={s.count}>{s.render(s.rows)}</Section>
        </div>
      </div>
    </>
  );
}

// Eligible batches, with a filter for the status: every batch, only those where all checks passed, or only those with
// notes (a course not received yet, students pending, a campus still waiting…). The choice is kept in the address (?status=).
const PASSED = "All checks passed";
const STATUS_FILTERS = [["", "All"], ["passed", "✓ All checks passed"], ["notes", "With notes"]];
function EligibleTable({ sid, rows, status, setStatus }) {
  const count = { "": rows.length, passed: rows.filter(b => b.status === PASSED).length, notes: rows.filter(b => b.status !== PASSED).length };
  const shown = status === "passed" ? rows.filter(b => b.status === PASSED) : status === "notes" ? rows.filter(b => b.status !== PASSED) : rows;
  return (
    <>
      <div className="chips cr-status-filter" role="group" aria-label="Filter eligible batches by status">
        {STATUS_FILTERS.map(([v, label]) => (
          <button key={v} type="button" className={`chip ${status === v ? "on" : ""}`} aria-pressed={status === v} onClick={() => setStatus(v)}>{label} ({count[v]})</button>
        ))}
      </div>
      {shown.length === 0 ? <p className="small muted cr-status-empty">{status === "passed" ? "No eligible batch has passed every check yet." : "Every eligible batch has passed every check."}</p> : (
        <table className="ledger small">
          <thead><tr><th>Batch</th><th className="num">Students</th><th className="num">Ready</th><th className="num">Pending</th><th>Status</th></tr></thead>
          <tbody>{shown.map(b => (
            <tr key={b.batchKey}><td><Batch sid={sid} k={b.batchKey} id={b.batchId} /></td><td className="num">{b.students}</td><td className="num">{b.ready}</td><td className="num">{b.held || ""}</td>
              <td>{b.status === PASSED ? <span style={{ color: "var(--green)", fontWeight: 600 }}>✓ All checks passed</span> : b.status}</td></tr>
          ))}</tbody>
        </table>
      )}
    </>
  );
}

// "Check now" works the report out from the marks, CMF and SMF as they are now, without computing: nothing is saved and
// results, issues and approvals stay as the last Compute left them. The choice is kept in the address (?live=1).
// The report is built in this browser (lib/compute.js), both the stored one and "Check now": Cloudflare's free plan gives a
// server request too little CPU for either.
function useBrowserReport(sid, live, tick) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [progress, setProgress] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setState(s => ({ ...s, loading: true }));
    (live ? checkInBrowser : storedReportInBrowser)(sid, { onProgress: p => !cancelled && setProgress(p) })
      .then(data => !cancelled && setState({ data, error: null, loading: false }))
      .catch(error => !cancelled && setState({ data: null, error, loading: false }))
      .finally(() => !cancelled && setProgress(null));
    return () => { cancelled = true; };
  }, [sid, live, tick]);
  return { ...state, progress };
}

export default function Completeness() {
  const { sid } = useSession();
  const [params, setParams] = useSearchParams();
  const live = params.get("live") === "1";
  const [tick, setTick] = useState(0);   // "Check again" re-runs the check
  const report = useBrowserReport(sid, live, tick);
  const state = { ...report, reload: () => setTick(t => t + 1) };
  const liveState = report;
  const setLive = on => setParams(p => { const n = new URLSearchParams(p); on ? n.set("live", "1") : n.delete("live"); return n; });
  const check = () => (live ? setTick(t => t + 1) : setLive(true));
  const r = state.data?.run;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Completeness report</h1>
          <p className="sub muted">The checks from the old completeness report, section by section.{r ? (r.live ? " Checked just now from the current marks, CMF and SMF." : ` From the results computed ${fmtWhen(r.startedAt)}.`) : ""} Hard blocks keep the students they affect pending, or the whole batch when the problem is with the batch; the rest can still be approved.</p>
        </div>
        <div className="row">
          <button className="btn primary" disabled={state.loading} onClick={check} title="Check the current marks without computing or saving anything"><Icon name="sync" />{live ? "Check again" : "Check now"}</button>
          <Link className="btn" to={`/s/${sid}/issues`}><Icon name="issues" />Fix on the Issues page</Link>
        </div>
      </div>
      {live && r?.live && (
        <div className="notice" role="status">
          <b>Live check, {fmtWhen(r.checkedAt)}: nothing was computed or saved.</b> Issues, Batches and results still show the last Compute{r.lastComputedAt ? ` (${fmtWhen(r.lastComputedAt)})` : ""}; click Compute results to update them.
          {" "}<button type="button" className="link-btn" onClick={() => setLive(false)}>Show the last Compute instead</button>
        </div>
      )}
      {!live && state.data?.marksDirty && (
        <div className="notice" role="status">Marks have changed since the last Compute, so this report may be behind. <button type="button" className="link-btn" onClick={check}>Check now</button> to see where things stand without computing.</div>
      )}
      {state.loading && <p className="small muted" role="status">{live ? "Checking the current marks in this browser" : "Loading the report"}… {liveState.progress?.label || ""}{liveState.progress?.done ? ` (${liveState.progress.done})` : ""}. This takes a few seconds.</p>}
      <Loading state={state}>{d => d.run ? <Report d={d} sid={sid} reload={state.reload} /> : <div className="sheet"><EmptyState icon="completeness" title="Nothing computed yet"
        actions={<button className="btn" onClick={check}>Check now</button>}>Load the data sources, then click Check now to see the report without computing, or Compute results.</EmptyState></div>}</Loading>
    </div>
  );
}
