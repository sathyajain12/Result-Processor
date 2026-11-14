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

const groupLabel = key => { const [programme, semester] = key.split("|"); return `${programme}, Sem ${semester}`; };

const LOGO = "/Images/SSSIHL%20Logo_White.png";
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
            <tr key={r.courseCode} className={r.failed ? "reg-failed" : ""}>
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
          <span>Printed {printed}</span>
          <span>Results computed {fmtWhen(job.computedAt)}</span>
        </div>
      </header>
      <StudentBlock s={s} sid={sid} />
    </article>
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
  const endPrint = useRef(() => setPrintJob(null)).current;
  const print = async () => {
    const total = state.data.total;
    if (total > CONFIRM_ABOVE && !window.confirm(`Print ${total.toLocaleString()} students? Each student is one page. Choose a programme first to print fewer.`)) return;
    // A sheet feeds into a printer while the pages load; then the real pages flip past just before the print dialog opens.
    setAnim({ phase: "loading", pages: total });
    const job = await run(() => loadForPrint(sid, group, q));
    if (!job) { setAnim(null); return; }
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
