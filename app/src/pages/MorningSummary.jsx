import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, enc } from "../api.js";
import { useSession, useCan, useLoad, Loading, EmptyState, Disclosure, Status, useAction, useToast, fmtWhen } from "../components/ui.jsx";
import { Icon } from "../components/icons.jsx";
import { compute as runCompute, computedMessage } from "../lib/compute.js";
import { canSee } from "../../shared/tabs.js";

// Morning summary: what one morning check of the Mark sheets found (marksheets/summary.js). The check runs 05:30–15:30 IST,
// two sheets a minute, so today's summary fills in through the day.
const STATUS = {
  pending: "Not checked yet", no_file: "No file in course master", filling: "Teacher still filling", validation: "Awaiting validation",
  partial: "Partly fetched", reopened: "Reopened by teacher", fetched: "Fetched", no_access: "No access", template: "Template problem",
  missing_data: "Data missing", error: "Error"
};
const PROBLEM = new Set(["no_access", "template", "missing_data", "error"]);
const label = s => STATUS[s] || s || "—";
const mark = v => (v === null || v === undefined || v === "" ? <span className="faint">blank</span> : v);
const day = s => new Date(String(s).replace(" ", "T") + "Z").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
const plural = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

// What the office has to do about one correction.
function nextStep(c) {
  if (c.approved && !c.computed) return { text: "Compute, then approve again", alert: true };
  if (c.status === "changed") return { text: "Approve again", alert: true };
  if (c.approved && c.status === "approved") return { text: "Approved, result unchanged" };
  if (!c.computed) return { text: "In results after the next Compute" };
  return null;
}

function SheetTable({ rows, show }) {
  return (
    <div className="scroll">
      <table className="ledger small">
        <thead><tr><th>Course</th><th>Title</th><th>Mark</th><th>Campus</th>{show.marks && <th className="num">Marks added</th>}{show.fix && <th className="num">Corrected</th>}<th>Status</th>{show.error && <th>Problem</th>}<th>When</th></tr></thead>
        <tbody>{rows.map(e => (
          <tr key={`${e.key}|${e.at}`}>
            <td className="nowrap"><b>{e.courseCode || "—"}</b></td><td>{e.title || <span className="faint">—</span>}</td><td>{e.component}</td><td>{e.campus || "—"}</td>
            {show.marks && <td className="num">{e.added || ""}</td>}
            {show.fix && <td className="num">{e.changed + e.removed || ""}</td>}
            <td className="nowrap">{e.from && e.from !== e.to ? <><span className="muted">{label(e.from)}</span> → </> : null}{label(e.to)}</td>
            {show.error && <td className="small">{e.error || ""}</td>}
            <td className="nowrap small muted">{fmtWhen(e.at)}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

const fmtComb = v => (v === null || v === undefined || v === "" ? "—" : `${Math.round(Number(v) * 100) / 100}%`);
const same = (a, b) => String(a ?? "") === String(b ?? "");
const change = (label, b, a, fmt = x => x ?? "—") => (b !== null && b !== undefined && !same(b, a) ? <>{label} {fmt(b)} → <b>{fmt(a)}</b></> : null);

// What a correction did to the result: the paper, COMB %, GPA and grade in the Compute before it and in the latest one.
function Effect({ c }) {
  const b = c.before, a = c.after;
  if (!a) {
    if (!b) return <span className="faint">—</span>;
    return <span className="muted">Before: {b.paper || "—"}{b.comb !== null && b.comb !== undefined ? `, COMB ${fmtComb(b.comb)}` : ""}{b.gpa ? `, GPA ${b.gpa}` : ""}.{c.computed ? "" : " Compute to see the effect."}</span>;
  }
  const bits = [
    b?.paper && !same(b.paper, a.paper) ? <>Paper {b.paper} → <b>{a.paper || "—"}</b></> : <>Paper <b>{a.paper || "—"}</b></>,
    change("COMB", b?.comb ?? null, a.comb, fmtComb) || (a.comb !== null && a.comb !== undefined ? <>COMB {fmtComb(a.comb)}</> : null),
    change("GPA", b?.gpa ?? null, a.gpa),
    change("grade", b?.grade ?? null, a.grade),
    a.graced && !b?.graced ? <>now graced</> : null
  ].filter(Boolean);
  const unchanged = b && same(b.paper, a.paper) && same(b.comb, a.comb) && same(b.gpa, a.gpa) && same(b.grade, a.grade);
  const color = c.flip === "worse" ? "var(--seal)" : c.flip === "better" ? "var(--green)" : undefined;
  return (
    <span style={color ? { color, fontWeight: 600 } : undefined}>
      {c.flip === "worse" && "Pass to fail: "}{c.flip === "better" && "Fail to pass: "}
      {unchanged ? <span className="muted">No change to the result</span> : bits.map((x, i) => <span key={i}>{i ? " · " : ""}{x}</span>)}
    </span>
  );
}

function Corrections({ rows, sid, students, sheets, review, reviewing }) {
  // Grouped by the teacher's sheet (a paper taught on two campuses has a sheet for each), as the office checks them against it.
  const groups = useMemo(() => {
    const g = new Map();
    for (const c of rows) {
      const k = c.sheetKey || `${c.component}|${c.paperCode}`;
      if (!g.has(k)) g.set(k, { key: k, sheet: sheets?.[c.sheetKey] || null, component: c.component, paperCode: c.paperCode, title: c.title, rows: [] });
      g.get(k).rows.push(c);
    }
    return [...g.values()];
  }, [rows, sheets]);
  return (
    <div className="scroll">
      <table className="ledger small">
        <thead><tr><th>Reviewed</th><th>Regd No</th><th>Name</th><th className="num">Was</th><th className="num">Now</th><th>Effect on the result</th><th>Result</th><th>To do</th></tr></thead>
        <tbody>{groups.map(g => {
          const open = g.rows.filter(c => !c.reviewed);
          const sh = g.sheet;
          return [
            <tr className="group" key={g.key}><td colSpan={8}>
              <div className="row between">
                <span>{g.component} · {g.paperCode}{g.title ? ` · ${g.title}` : ""}{sh?.campus ? ` · ${sh.campus}` : ""} ({g.rows.length})</span>
                <span className="row" style={{ fontWeight: 400 }}>
                  {/* The teacher's address is shown as text only: nothing here sends or opens an email. */}
                  {sh?.teacher || sh?.email ? <span>Teacher: {sh.teacher || "—"}{sh.email ? <span className="muted"> ({sh.email})</span> : null}</span> : <span className="faint">Teacher not known</span>}
                  {sh?.url && <a href={sh.url} target="_blank" rel="noopener noreferrer">Open sheet ↗</a>}
                  {review && open.length > 0 && <button className="btn small" disabled={reviewing} onClick={() => review(open.map(c => c.id), true)}>Tick all ({open.length})</button>}
                </span>
              </div>
            </td></tr>,
            ...g.rows.map(c => {
              const step = nextStep(c);
              return (
                <tr key={c.id}>
                  <td className="nowrap" title={c.reviewed ? `Reviewed by ${c.reviewed.by}, ${fmtWhen(c.reviewed.at)}` : "Not reviewed yet"}>
                    <input type="checkbox" aria-label={`Reviewed: ${c.regdNo} ${c.paperCode}`} checked={!!c.reviewed} disabled={!review || reviewing}
                      onChange={e => review(c.id, e.target.checked)} />
                    {c.reviewed && <span className="small muted"> {fmtWhen(c.reviewed.at)}</span>}
                  </td>
                  <td className="nowrap">{students ? <Link to={`/s/${sid}/students/${enc(c.regdNo)}`}>{c.regdNo}</Link> : c.regdNo}</td>
                  <td>{c.name || <span className="faint">—</span>}</td>
                  <td className="num">{mark(c.old)}</td><td className="num"><b>{mark(c.new)}</b></td>
                  <td className="small"><Effect c={c} /></td>
                  <td>{c.status ? <Status status={c.status} /> : <span className="faint">not in results</span>}</td>
                  <td className="small">{step && <span style={step.alert ? { color: "var(--seal)", fontWeight: 600 } : undefined}>{step.text}</span>}</td>
                </tr>
              );
            })
          ];
        })}</tbody>
      </table>
    </div>
  );
}

function Body({ d, sid, me, reload, session }) {
  const can = useCan();
  const [busy, act] = useAction();
  const compute = () => act(() => runCompute(sid), computedMessage).then(() => { reload(); session.reload(); });
  const students = canSee(me, "students");
  const [hideReviewed, setHideReviewed] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const toast = useToast();
  // Tick or untick corrections as reviewed, then reload the summary.
  const review = can.operate ? async (ids, reviewed) => {
    setReviewing(true);
    try {
      await api.post(`/sessions/${enc(sid)}/marksheets/review`, { ids: [].concat(ids), reviewed, runId: d.run?.id });
      reload();
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setReviewing(false);
    }
  } : null;

  if (!d.run) {
    return (
      <div className="sheet"><EmptyState icon="sync" title="No morning check yet">
        The morning check runs every day from 05:30 IST for sessions that take marks from Mark sheets. Its summary appears here once it has started.
      </EmptyState></div>
    );
  }

  const ev = d.events;
  const newMarks = ev.filter(e => e.added > 0);
  const reopened = ev.filter(e => e.to === "reopened");
  const problems = ev.filter(e => PROBLEM.has(e.to));
  const fixed = ev.filter(e => PROBLEM.has(e.from) && !PROBLEM.has(e.to));
  const listed = new Set([...newMarks, ...reopened, ...problems, ...fixed]);
  const other = ev.filter(e => !listed.has(e) && e.from !== e.to);
  const shownCorrections = hideReviewed ? d.corrections.filter(c => !c.reviewed) : d.corrections;
  const toApprove = shownCorrections.filter(c => c.approved);
  const unreviewed = d.corrections.filter(c => !c.reviewed);
  const approvedOpen = new Set(unreviewed.filter(c => c.approved).map(c => c.regdNo)).size;
  const flips = d.corrections.filter(c => c.flip === "worse").length;
  const correctedStudents = new Set(d.corrections.map(c => c.regdNo)).size;
  const needsCompute = d.marksDirty && d.corrections.some(c => !c.computed);
  const r = d.run;
  const nothing = !ev.length && !d.corrections.length;

  return (
    <>
      <p className="muted small mb-2">
        {r.finishedAt ? `Finished ${fmtWhen(r.finishedAt)}` : d.today ? "Still running" : "Did not finish that day"}: {plural(r.checked, "sheet")} checked
        {r.finishedAt ? "" : ` of about ${d.sheetsTotal.toLocaleString()}`}, started {fmtWhen(r.startedAt)}.
        {!r.finishedAt && d.today ? " The check reads two sheets a minute until 15:30 IST, so this summary fills in through the day." : ""}
      </p>

      {needsCompute && (
        <div className="notice red row between">
          <span><b>Marks changed since the last Compute{d.lastComputedAt ? ` (${fmtWhen(d.lastComputedAt)})` : ""}.</b> Results, approvals and the Grade register don't show these corrections until results are computed.</span>
          {can.operate && <button className="btn" disabled={busy} onClick={compute}><Icon name="compute" />Compute results</button>}
        </div>
      )}

      <div className="stat-strip">
        <div><b>{newMarks.length}</b><span>sheets with new marks</span></div>
        <div><b>{d.corrections.length}{d.moreCorrections ? "+" : ""}</b><span>marks corrected{correctedStudents ? `, ${plural(correctedStudents, "student")}` : ""}</span></div>
        <div className={unreviewed.length ? "alert" : ""}><b>{unreviewed.length}</b><span>corrections not reviewed yet</span></div>
        <div className={approvedOpen ? "alert" : ""}><b>{approvedOpen}</b><span>approved results affected, not reviewed</span></div>
        {flips > 0 && <div className="alert"><b>{flips}</b><span>papers changed from pass to fail</span></div>}
        <div><b>{reopened.length}</b><span>reopened by teachers</span></div>
        <div className={problems.length ? "alert" : ""}><b>{problems.length}</b><span>need attention</span></div>
      </div>

      {nothing && (
        <div className="sheet"><EmptyState icon="check" title={r.finishedAt || !d.today ? "Nothing changed" : "Nothing changed so far"}>
          {r.changed > 0
            ? "This check ran before sheet changes were recorded for this summary, so only its totals are known: see Recent fetches on the Mark sheets page."
            : "No sheet was newly certified, reopened or broken, and no fetched mark was changed by a teacher."}
        </EmptyState></div>
      )}

      {d.corrections.length > 0 && (
        <div className="row between mb-2">
          <span className="small muted">Tick a correction once it has been checked against the teacher's sheet. Ticks are recorded in Runs and audit.</span>
          <button className={`chip ${hideReviewed ? "on" : ""}`} onClick={() => setHideReviewed(h => !h)}>Hide reviewed{d.corrections.length - unreviewed.length ? ` (${d.corrections.length - unreviewed.length})` : ""}</button>
        </div>
      )}

      {toApprove.length > 0 && (
        <div className="sheet">
          <div className="sheet-head"><h2>Corrections to approved results</h2><span className="small muted">A teacher changed a mark after the result was approved. Check the change with the teacher's sheet, compute, then approve the student again.</span></div>
          <Corrections rows={toApprove} sid={sid} students={students} sheets={d.sheets} review={review} reviewing={reviewing} />
        </div>
      )}

      {problems.length > 0 && (
        <div className="sheet">
          <div className="sheet-head"><h2>Need attention</h2><span className="small muted">These sheets can't be read. Marks fetched from them earlier are kept.</span></div>
          <SheetTable rows={problems} show={{ error: true }} />
        </div>
      )}

      {shownCorrections.length > 0 && (
        <div className="sheet">
          <div className="sheet-head"><h2>All corrections</h2>
            <span className="small muted">Marks a teacher changed after they were fetched{d.moreCorrections ? `. The first ${d.corrections.length.toLocaleString()} are shown` : ""}.</span></div>
          <Corrections rows={shownCorrections} sid={sid} students={students} sheets={d.sheets} review={review} reviewing={reviewing} />
        </div>
      )}

      {newMarks.length > 0 && (
        <div className="sheet">
          <div className="sheet-head"><h2>New marks</h2><span className="small muted">Sheets certified (and validated, for ESE) since the previous check, and internship rows marked ready</span></div>
          <SheetTable rows={newMarks} show={{ marks: true }} />
        </div>
      )}

      {reopened.length > 0 && (
        <div className="sheet">
          <div className="sheet-head"><h2>Reopened by teachers</h2><span className="small muted">Fetched before, now no longer certified. The marks fetched earlier are kept until the sheet is certified again.</span></div>
          <SheetTable rows={reopened} show={{}} />
        </div>
      )}

      {fixed.length > 0 && (
        <div className="sheet">
          <div className="sheet-head"><h2>Problems cleared</h2><span className="small muted">Sheets that couldn't be read before and can be now</span></div>
          <SheetTable rows={fixed} show={{ marks: true }} />
        </div>
      )}

      {other.length > 0 && (
        <div className="sheet mt-3">
          <Disclosure head="Other status changes" count={other.length} extra="for example, a sheet now awaiting validation">
            <SheetTable rows={other} show={{}} />
          </Disclosure>
        </div>
      )}
    </>
  );
}

export default function MorningSummary() {
  const { sid, me, session } = useSession();
  const [params, setParams] = useSearchParams();
  const runId = params.get("run");
  const state = useLoad(`/sessions/${enc(sid)}/marksheets/summary${runId ? `?run=${enc(runId)}` : ""}`);
  const runs = state.data?.runs || [];
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Morning summary</h1>
          <p className="sub muted">What the daily check of every teacher's Marks Statement found: new marks, marks corrected after they were fetched, and sheets reopened or with a problem.</p>
        </div>
        <div className="row">
          {runs.length > 1 && (
            <select aria-label="Morning check" value={state.data?.run?.id ?? ""} onChange={e => setParams(e.target.value === String(runs[0].id) ? {} : { run: e.target.value }, { replace: true })}>
              {runs.map(r => <option key={r.id} value={r.id}>{day(r.startedAt)}</option>)}
            </select>
          )}
          <Link className="btn" to={`/s/${sid}/marksheets`}><Icon name="sources" />Mark sheets</Link>
        </div>
      </div>
      <Loading state={state}>{d => <Body d={d} sid={sid} me={me} reload={state.reload} session={session} />}</Loading>
    </div>
  );
}

// The line at the top of the Batches page: today's (or the last) morning check in one sentence, with a link to the summary.
export function MorningBanner({ sid }) {
  const state = useLoad(`/sessions/${enc(sid)}/marksheets/summary?brief=1`);
  const d = state.data;
  if (!d?.run) return null;
  const c = d.counts;
  const parts = [];
  if (c.newSheets) parts.push(`${plural(c.newSheets, "sheet")} with new marks`);
  if (c.corrections) parts.push(`${plural(c.corrections, "mark")} corrected${c.correctedSheets ? ` on ${plural(c.correctedSheets, "sheet")}` : ""}${c.unreviewed ? ` (${c.unreviewed.toLocaleString()} not reviewed yet)` : " (all reviewed)"}`);
  if (c.reopened) parts.push(`${c.reopened} reopened by teachers`);
  if (c.problems) parts.push(`${c.problems} need${c.problems === 1 ? "s" : ""} attention`);
  // An old check with nothing to report is not worth a line.
  if (!parts.length && !d.today) return null;
  const when = d.today ? (d.run.finishedAt ? "Today's morning check" : "Today's morning check (still running)") : `The last morning check (${day(d.run.startedAt)})`;
  const alert = c.approvedAffected > 0 || c.problems > 0;
  return (
    <div className={`notice row between${alert ? " red" : ""}`}>
      <span>
        <b>{when}:</b> {parts.length ? parts.join(", ") : `nothing changed${d.run.finishedAt ? "" : " so far"}`}.
        {c.approvedAffected > 0 && <> <b>{plural(c.approvedAffected, "approved result")} affected and not reviewed.</b></>}
        {d.marksDirty && c.unreviewed > 0 && " Compute to include the changes."}
      </span>
      <Link to={`/s/${sid}/marksheets/morning`}>See the morning summary</Link>
    </div>
  );
}
