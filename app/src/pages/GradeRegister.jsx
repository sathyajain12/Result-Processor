import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { api, enc } from "../api.js";
import { useSession, useLoad, Loading, EmptyState, useAction, fmtWhen } from "../components/ui.jsx";
import { Icon } from "../components/icons.jsx";
import PrinterAnimation, { flipPages, flipDurationMs } from "../components/PrinterAnimation.jsx";

// The Grade register: built automatically from the latest computed results. Nothing to upload or generate.
const NONE = "--";
const shown = v => (v === null || v === undefined || v === "" ? NONE : v);
const whole = v => shown(typeof v === "number" ? Math.round(v * 100) / 100 : v);           // credits, earned: 4, 19, 28.5
const oneDp = v => shown(typeof v === "number" ? (Math.round(v * 100) / 100).toFixed(Number.isInteger(v * 10) ? 1 : 2) : v);   // marks, percent, points: 22.0, 9.5
const gpaOf = v => shown(typeof v === "number" ? v.toFixed(1) : v);

const HEAD = ["Name", "Regd. No.", "Campus", "Programme", "Semester"];
const COLUMNS = ["S.No.", "Course Code", "Course Title", "Type", "Category", "Credits", "Weightage (CIE/ESE)", "CIE Marks", "ESE Marks", "CIE%", "ESE%", "COMB%", "CIE-NP", "ESE-NP", "COMB-NP", "EarnedCred", "EarnedCrPoints", "Remarks"];
const SUMMARY = ["Sum of EarnedCred", "Sum of EarnedCrPoints", "Semester GPA", "Letter Grade", "Qual Grade"];

const GRACE_COLUMNS = ["S.No.", "Course Code", "Course Title", "Grace Type", "Calculation", "Grace Marks Used", "ESE Marks (before → after)", "ESE% (before → after)", "COMB% (before → after)", "COMB-NP", "Result"];
const plural = (n, word) => `${whole(n)} ${word}${n === 1 ? "" : "s"}`;
const fromTo = (a, b, f) => (a === null || a === undefined ? f(b) : `${f(a)} → ${f(b)}`);
const outOf = (v, max) => (typeof max === "number" && max > 0 ? `${whole(v)}/${whole(max)}` : whole(v));

// The grace pool in a sentence: 1% of the semester's total ESE maximum, and for a supplementary, what that attempt had to spend.
function poolLine(g) {
  const spent = `${plural(g.used ?? 0, "mark")} used, ${whole(g.left)} left`;
  if (g.pool === null) return `${spent}.`;
  if (!g.attempt) return `Grace pool ${plural(g.pool, "mark")} (1% of ${whole(g.pool * 100)}, the semester's total ESE maximum): ${spent}.`;
  if (g.terminal) return `Terminal supplementary (attempt ${g.attempt}): a fresh grace pool of ${plural(g.pool, "mark")}: ${spent}.`;
  return `Supplementary attempt ${g.attempt}: grace pool ${plural(g.pool, "mark")}, ${whole(g.usedBefore)} used in the regular exam, so ${whole(g.available)} available: ${spent}.`;
}

// How the grace marks were worked out: the points short of the pass mark, as that share of the ESE maximum in marks,
// rounded up to whole marks. "ESE pass 50% − 46.67% = 3.33 points" / "3.33 × 75 ÷ 100 = 2.5, rounded up to 3 marks".
function GraceSum({ p }) {
  const what = p.kind === "COMB" ? "COMB" : "ESE";
  return (
    <span className="reg-grace-calc">
      <span>{what} pass {oneDp(p.passPct)}% − {oneDp(p.shortPct)}% = {plural(p.points, "point")}</span>
      <span>{whole(p.points)} × {whole(p.eseMax)} ÷ 100 = {p.exactMarks !== p.marks ? `${whole(p.exactMarks)}, rounded up to ${plural(p.marks, "mark")}` : plural(p.marks, "mark")}</span>
    </span>
  );
}

// Every graced paper with what was raised, from what to what and at what cost; then the papers the pool could not cover.
function GracingBlock({ g }) {
  return (
    <div className="reg-grace">
      <div className="reg-grace-head"><b>Gracing</b><span>{poolLine(g)}</span></div>
      <div className="scroll">
        <table className="reg-table reg-grace-table">
          <thead><tr>{GRACE_COLUMNS.map(h => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>
            {g.papers.map((p, i) => (
              <tr key={p.courseCode}>
                <td>{i + 1}</td><td className="reg-code">{p.courseCode}</td><td className="reg-title">{shown(p.title)}</td>
                <td>{p.kind === "COMB" ? "COMB grace" : "ESE grace"}</td><td><GraceSum p={p} /></td><td className="reg-grace-marks">+{whole(p.marks)}</td>
                <td>{fromTo(p.eseFrom, p.eseTo, v => outOf(v, p.eseMax))}</td>
                <td>{fromTo(p.esePctFrom, p.esePctTo, oneDp)}</td>
                <td>{fromTo(p.combPctFrom, p.combPctTo, oneDp)}</td>
                <td>{oneDp(p.combNp)}</td><td>Passed with grace</td>
              </tr>
            ))}
            {g.notGraced.map((p, i) => (
              <tr key={p.courseCode} className="reg-failed">
                <td>{g.papers.length + i + 1}</td><td className="reg-code">{p.courseCode}</td>
                <td className="reg-title" colSpan={GRACE_COLUMNS.length - 3}>
                  Not graced: needed {plural(p.needed, "grace mark")}, but {p.left ? `only ${whole(p.left)} ${p.left === 1 ? "was" : "were"} left in the pool` : "none was left in the pool"}.
                </td>
                <td className="reg-remarks">Failed</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const groupLabel = key => { const [programme, semester] = key.split("|"); return `${programme}, Sem ${semester}`; };

const LOGO = "/Images/SSSIHL%20Logo_White.png";
const PRINTED_BY = "SSJ";   // initials beside the print date on every printed page, as the results office asked
const CONFIRM_ABOVE = 100;   // students: printing more than this asks first, since each student is a page

function StudentBlock({ s, sid }) {
  return (
    <section className="reg-student" aria-label={`${s.name}, ${s.regdNo}`}>
      <div className="scroll">
        <table className="reg-table reg-five">
          <thead><tr>{HEAD.map(h => <th key={h}>{h}</th>)}</tr></thead>
          <tbody><tr>
            <td><Link to={`/s/${sid}/students/${enc(s.regdNo)}`}>{s.name}</Link></td>
            <td>{s.regdNo}</td><td>{shown(s.campus)}</td><td>{s.programme}</td><td>{s.semester}</td>
          </tr></tbody>
        </table>
      </div>
      <div className="scroll">
        <table className="reg-table reg-papers">
          <thead><tr>{COLUMNS.map(h => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>{s.rows.map(r => (
            <tr key={r.courseCode} className={[r.failed && "reg-failed", r.graced && "reg-graced"].filter(Boolean).join(" ")}>
              <td>{r.sno}</td><td className="reg-code">{r.courseCode}</td><td className="reg-title">{shown(r.title)}</td>
              <td>{shown(r.type)}</td><td>{r.category ?? ""}</td><td>{whole(r.credits)}</td><td className="reg-wtg">{shown(r.weightage)}</td>
              <td>{oneDp(r.cieMarks)}</td><td>{oneDp(r.eseMarks)}</td><td>{oneDp(r.ciePct)}</td><td>{oneDp(r.esePct)}</td><td>{oneDp(r.combPct)}</td>
              <td>{oneDp(r.cieNp)}</td><td>{oneDp(r.eseNp)}</td><td className="reg-comb">{oneDp(r.combNp)}</td>
              <td>{whole(r.earnedCred)}</td><td>{whole(r.earnedPoints)}</td><td className="reg-remarks">{r.remarks ?? ""}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="scroll">
        <table className="reg-table reg-five">
          <thead><tr>{SUMMARY.map(h => <th key={h}>{h}</th>)}</tr></thead>
          <tbody><tr>
            <td>{whole(s.summary.sumEarnedCred)}</td><td>{whole(s.summary.sumEarnedPoints)}</td>
            <td className={typeof s.summary.semesterGpa === "number" ? "" : "reg-comb reg-not-gpa"}>{gpaOf(s.summary.semesterGpa)}</td>
            <td>{shown(s.summary.letterGrade)}</td><td>{shown(s.summary.qualGrade)}</td>
          </tr></tbody>
        </table>
      </div>
      {s.gracing && <GracingBlock g={s.gracing} />}
    </section>
  );
}

// Everything matching the programme and search, not only the page on screen, with the logo ready before printing starts.
async function loadForPrint(sid, group, q) {
  const params = new URLSearchParams({ perPage: "50", ...(group && { group }), ...(q && { q }) });
  const students = [];
  let head = null;
  for (let page = 1, pages = 1; page <= pages; page++) {
    params.set("page", page);
    const d = await api.get(`/sessions/${enc(sid)}/register?${params}`);
    head ||= d;
    pages = d.pages;
    students.push(...d.students);
  }
  const logo = new Image();
  logo.src = LOGO;
  await logo.decode().catch(() => {});   // printing without the logo is better than not printing
  const title = [head.cycleName, head.sessionName].filter(Boolean).join(", ");
  return { students, title, computedAt: head.computedAt, printedAt: new Date() };
}

// A CSS string, for the page footer.
const cssText = s => `"${String(s).replace(/[\\"]/g, "\\$&").replace(/\s+/g, " ")}"`;

// What goes to the printer: one A4 landscape page per student, each with the institute's header. It is drawn outside the
// app, so the rules below apply only while there is something to print and Ctrl+P on other pages is not affected.
function PrintView({ job, sid, onDone }) {
  const started = useRef(false);
  useEffect(() => {
    const title = document.title;
    document.title = `Grade Register ${job.title}`;   // the name offered when saving as PDF
    const done = () => { document.title = title; onDone(); };
    window.addEventListener("afterprint", done);
    if (!started.current) {
      started.current = true;
      requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
    }
    return () => { window.removeEventListener("afterprint", done); document.title = title; };
  }, [job, onDone]);
  return createPortal(
    <div className="print-root">
      <style>{`
        @page { size: A4 landscape; margin: 9mm 10mm 11mm;
          @bottom-left { content: ${cssText(`Grade Register, ${job.title}`)}; font: 8pt "Public Sans", Arial, sans-serif; color: #444; }
          @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 8pt "Public Sans", Arial, sans-serif; color: #444; } }
        @media print { #root { display: none !important; } html, body { background: #fff !important; } .print-root { display: block; } }
      `}</style>
      {job.students.map(s => <PrintPage key={s.regdNo} s={s} sid={sid} job={job} />)}
    </div>,
    document.body
  );
}

// One student's page as it prints: the institute's header, then the register.
function PrintPage({ s, sid, job }) {
  const printed = job.printedAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return (
    <article className="print-page">
      <header className="print-head">
        <img src={LOGO} alt="SSSIHL emblem" />
        <div className="print-head-text">
          <b>Sri Sathya Sai Institute of Higher Learning</b>
          <span>(Deemed to be University), Vidyagiri, Prasanthi Nilayam</span>
          <span>Office of the Controller of Examinations</span>
          <strong>Grade Register{job.title ? `: ${job.title}` : ""}</strong>
        </div>
        <div className="print-head-side">
          <span>Printed {printed} · <b className="print-initials">{PRINTED_BY}</b></span>
          <span>Results computed {fmtWhen(job.computedAt)}</span>
        </div>
      </header>
      <StudentBlock s={s} sid={sid} />
    </article>
  );
}

// The prints made from the portal (register/printed): loaded only when the panel is opened. Each print is recorded when
// the print dialog opens; the browser does not say whether the person then printed or cancelled. Also lists the
// programmes with ready results that have not been printed yet.
function PrintHistory({ sid, groups, tick }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState({ rows: null, error: null });
  useEffect(() => {
    if (!open) return;
    let live = true;
    api.get(`/sessions/${enc(sid)}/register/printed`).then(rows => live && setState({ rows, error: null }), e => live && setState({ rows: null, error: e.message }));
    return () => { live = false; };
  }, [open, sid, tick]);
  const rows = state.rows;
  const ready = groups.filter(g => g.ready > 0);
  const printedAll = rows?.some(r => !r.group && !r.q);
  const printed = new Set(rows?.filter(r => r.group).map(r => r.group));
  const notYet = rows ? (printedAll ? [] : ready.filter(g => !printed.has(g.key))) : [];
  return (
    <details className="sheet reg-printed" onToggle={e => setOpen(e.currentTarget.open)}>
      <summary><b>Printed from the portal</b><span className="small muted"> Each time the print dialog was opened here, with who, when and which students.</span></summary>
      {state.error && <div className="notice red">{state.error}</div>}
      {open && !rows && !state.error && <div className="pad small muted">Loading…</div>}
      {rows && (
        <div className="pad">
          <p className="small">
            <b>{rows.length}</b> print{rows.length === 1 ? "" : "s"} recorded, covering <b>{printedAll ? "every" : printed.size}</b> of {ready.length} programme{ready.length === 1 ? "" : "s"} with ready results.
          </p>
          {notYet.length > 0 && (
            <details className="reg-not-printed">
              <summary className="small"><b>Not printed yet: {notYet.length}</b></summary>
              <ul className="small">{notYet.map(g => <li key={g.key}>{groupLabel(g.key)} <span className="muted">({g.ready} ready)</span></li>)}</ul>
            </details>
          )}
          {rows.length > 0 && (
            <div className="scroll">
              <table className="ledger reg-printed-table">
                <thead><tr><th>When</th><th>Programme and semester</th><th>Students</th><th>Search</th><th>Results computed</th><th>By</th></tr></thead>
                <tbody>{rows.map(r => (
                  <tr key={r.id}>
                    <td>{fmtWhen(r.at)}</td><td>{r.group ? groupLabel(r.group) : r.label}</td>
                    <td title={r.regdNos.slice(0, 60).join(", ") + (r.regdNos.length > 60 ? ", …" : "")}>{r.count.toLocaleString()}</td>
                    <td>{r.q || ""}</td><td>{r.computedAt ? fmtWhen(r.computedAt) : ""}</td><td>{r.by}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </details>
  );
}

export default function GradeRegister() {
  const { sid } = useSession();
  const [group, setGroup] = useState("");
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [busy, run] = useAction();
  useEffect(() => { const t = setTimeout(() => { setQ(typed.trim()); setPage(1); }, 300); return () => clearTimeout(t); }, [typed]);
  const params = new URLSearchParams({ page, ...(group && { group }), ...(q && { q }) });
  const state = useLoad(`/sessions/${enc(sid)}/register?${params}`);
  const [printJob, setPrintJob] = useState(null);
  const [anim, setAnim] = useState(null);
  const [printedTick, setPrintedTick] = useState(0);
  const endPrint = useRef(() => setPrintJob(null)).current;
  const print = async () => {
    const total = state.data.total;
    if (total > CONFIRM_ABOVE && !window.confirm(`Print ${total.toLocaleString()} students? Each student is one page. Choose a programme first to print fewer.`)) return;
    // A sheet feeds into a printer while the pages load; then the real pages flip past just before the print dialog opens.
    setAnim({ phase: "loading", pages: total });
    const job = await run(() => loadForPrint(sid, group, q));
    if (!job) { setAnim(null); return; }
    // Recorded as the print dialog is about to open; a failure here never stops the print.
    api.post(`/sessions/${enc(sid)}/register/printed`, {
      group, label: group ? groupLabel(group) : "All programmes", q, count: job.students.length,
      regdNos: job.students.map(s => s.regdNo), computedAt: job.computedAt
    }).then(() => setPrintedTick(t => t + 1), () => {});
    const flip = flipPages(job.students);
    setAnim({ phase: "flipping", pages: job.students.length, flip });
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    await new Promise(r => setTimeout(r, still ? 0 : flipDurationMs(flip.length)));
    setAnim(null);
    setPrintJob(job);
  };

  return (
    <div className="page wide">
      <div className="page-head">
        <div>
          <h1>Grade register</h1>
          <p className="sub muted">Generated automatically from the computed results, so it updates after every Compute. Only ready results are listed.</p>
        </div>
        {state.data?.total > 0 && (
          <button className="btn primary" disabled={busy || !!printJob || !!anim} onClick={print}><Icon name="print" />{busy ? "Preparing…" : `Print ${state.data.total === 1 ? "1 student" : `${state.data.total.toLocaleString()} students`}`}</button>
        )}
      </div>
      {anim && <PrinterAnimation phase={anim.phase} pages={anim.pages} flip={anim.flip} />}
      {printJob && <PrintView job={printJob} sid={sid} onDone={endPrint} />}
      <Loading state={state}>{d => !d.computed ? (
        <div className="sheet"><EmptyState icon="compute" title="Nothing computed yet">Results appear here after <Link to={`/s/${sid}/sources`}>Compute results</Link>.</EmptyState></div>
      ) : (
        <>
          <div className="sheet pad reg-tools">
            <div className="row between">
              <div className="row">
                <label className="reg-filter">Programme and semester
                  <select value={group} onChange={e => { setGroup(e.target.value); setPage(1); }}>
                    <option value="">All programmes</option>
                    {d.groups.filter(g => g.ready > 0).map(g => <option key={g.key} value={g.key}>{groupLabel(g.key)} ({g.ready})</option>)}
                  </select>
                </label>
                <label className="reg-filter">Find students
                  <input type="search" value={typed} onChange={e => setTyped(e.target.value)} placeholder="Regd No or name; separate with commas" />
                </label>
              </div>
              <div className="small muted reg-counts">
                <b>{d.ready.toLocaleString()}</b> of {d.computedStudents.toLocaleString()} students ready, computed {fmtWhen(d.computedAt)}.
                {d.ready < d.computedStudents && <> The other {(d.computedStudents - d.ready).toLocaleString()} appear once their <Link to={`/s/${sid}/issues`}>issues</Link> are cleared.</>}
              </div>
            </div>
          </div>
          <PrintHistory sid={sid} groups={d.groups} tick={printedTick} />
          {d.notFound?.length > 0 && <div className="notice">No ready result{group ? " in this programme and semester" : ""} for {d.notFound.join(", ")}.</div>}
          {d.students.length === 0 && <div className="sheet"><EmptyState icon="search" title="No students match">{d.ready === 0 ? "No result is ready yet: clear the issues holding them back." : "Try another programme or search."}</EmptyState></div>}
          {d.students.map(s => <StudentBlock key={s.regdNo} s={s} sid={sid} />)}
          {d.pages > 1 && (
            <div className="row between pad small muted">
              <span>Students {(d.page - 1) * d.perPage + 1} to {Math.min(d.page * d.perPage, d.total)} of {d.total.toLocaleString()}</span>
              <span className="row">
                <button className="btn small" disabled={d.page <= 1} onClick={() => { setPage(d.page - 1); window.scrollTo(0, 0); }}>Previous</button>
                <button className="btn small" disabled={d.page >= d.pages} onClick={() => { setPage(d.page + 1); window.scrollTo(0, 0); }}>Next</button>
              </span>
            </div>
          )}
        </>
      )}</Loading>
    </div>
  );
}
