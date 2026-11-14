import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, enc } from "../api.js";
import { useSession, useCan, useLoad, NOT_ACCEPTABLE, Loading, Stage, Status, Sev, StateStrip, Modal, useAction, fmtGpa, fmtWhen, batchLabel } from "../components/ui.jsx";
import OverrideDialog from "../components/OverrideDialog.jsx";
import { Icon } from "../components/icons.jsx";
import { aggregatePapers } from "../../shared/analytics-core.js";

const STATUS_FILTERS = [["all", "All"], ["ready", "Ready"], ["changed", "Changed"], ["approved", "Approved"], ["held", "Pending"], ["withheld", "Withheld"]];

export default function Batch() {
  const { sid, me, session } = useSession();
  const { bid } = useParams();
  const state = useLoad(`/sessions/${enc(sid)}/batches/${bid}`);
  return (
    <div className="page">
      <Loading state={state}>{b => <BatchBody b={b} sid={sid} me={me} reload={() => { state.reload(); session.reload(); }} />}</Loading>
    </div>
  );
}

function BatchBody({ b, sid, me, reload }) {
  const [tab, setTab] = useState("students");
  const [filter, setFilter] = useState("all");
  const [confirm, setConfirm] = useState(null);
  const [override, setOverride] = useState(null);
  const [note, setNote] = useState("");
  const [busy, run] = useAction();
  const can = useCan();

  // A batch taught on more than one campus can be looked at, and approved, one campus at a time (?campus= in the address).
  const [params, setParams] = useSearchParams();
  const campuses = useMemo(() => {
    const n = new Map();
    for (const s of b.students) if (s.campus) n.set(s.campus, (n.get(s.campus) || 0) + 1);
    return [...n].sort((x, y) => x[0].localeCompare(y[0]));
  }, [b.students]);
  const campus = campuses.length > 1 && campuses.some(([c]) => c === params.get("campus")) ? params.get("campus") : "";
  const setCampus = c => setParams(p => { const q = new URLSearchParams(p); if (c) q.set("campus", c); else q.delete("campus"); return q; }, { replace: true });
  const view = useMemo(() => {
    if (!campus) return { students: b.students, counts: b.counts, papers: b.papers, exceptions: b.exceptions, grades: b.gradeDistribution };
    const list = b.students.filter(s => s.campus === campus);
    const regds = new Set(list.map(s => s.regdNo));
    const counts = { ready: 0, changed: 0, approved: 0, held: 0, withheld: 0 };
    for (const s of list) counts[s.status] = (counts[s.status] || 0) + 1;
    const grades = {};
    for (const s of list) if (s.releasable) { const g = s.letterGrade || s.publishedGpa; grades[g] = (grades[g] || 0) + 1; }
    const info = new Map(b.papers.map(p => [p.paperCode, p]));
    const papers = aggregatePapers(list.flatMap(s => s.papers.map(p => ({ ...p, title: info.get(p.paperCode)?.title, credits: info.get(p.paperCode)?.credits }))))
      .sort((x, y) => x.paperCode.localeCompare(y.paperCode));
    // Issues of this campus's students, and the batch's own issues (which concern every campus).
    return { students: list, counts, papers, exceptions: b.exceptions.filter(e => !e.regdNo || regds.has(e.regdNo)), grades };
  }, [b, campus]);

  const students = view.students.filter(s => filter === "all" || s.status === filter);
  const toApprove = view.students.filter(s => s.status === "ready" || s.status === "changed");
  const toRevoke = view.students.filter(s => s.status === "approved");
  const paperOrder = useMemo(() => b.papers.map(p => p.paperCode), [b.papers]);
  const blocking = view.exceptions.filter(e => e.severity === "block" && !e.accepted);
  const label = batchLabel(b.programme, b.semester, b.batch);
  const where = campus ? ` at ${campus}` : "";

  const approve = async action => {
    const regdNos = campus ? (action === "approve" ? toApprove : toRevoke).map(s => s.regdNo) : undefined;
    const r = await run(() => api.post(`/sessions/${enc(sid)}/batches/${b.id}/approve`, { action, note, regdNos }),
      r => action === "approve" ? `Approved ${r.count} results` : `Approval withdrawn for ${r.count} results`);
    if (r) { setConfirm(null); setNote(""); reload(); }
  };

  const GRADE_ORDER = ["O+", "O", "A+", "A", "B", "C", "Fail", "Absent"];
  const rank = g => (GRADE_ORDER.indexOf(g) === -1 ? 99 : GRADE_ORDER.indexOf(g));
  const grades = Object.entries(view.grades).sort((x, y) => rank(x[0]) - rank(y[0]));
  const maxGrade = Math.max(1, ...grades.map(([, n]) => n));

  return (
    <>
      <div className="crumbs"><Link to={`/s/${sid}`}>Batches</Link></div>
      <div className="page-head">
        <div>
          <div className="row"><h1>{label}</h1><Stage stage={b.stage} /></div>
          <p className="sub muted">{campus ? `${view.students.length} of ${b.students.length} students are at ${campus}` : `${b.students.length} students`}, {view.papers.length} papers. Results computed {fmtWhen(b.runAt)}.</p>
        </div>
        {can.admin && (
          <div className="row">
            {toRevoke.length > 0 && <button className="btn" disabled={busy} onClick={() => setConfirm("revoke")}>Withdraw approval{where}</button>}
            <button className="btn approve" disabled={busy || toApprove.length === 0} onClick={() => setConfirm("approve")}>
              <Icon name="approve" />Approve {toApprove.length} result{toApprove.length === 1 ? "" : "s"}{where}
            </button>
          </div>
        )}
      </div>

      {campuses.length > 1 && (
        <div className="campus-switch" role="group" aria-label="Campus">
          <span className="small muted">Campus</span>
          <div className="chips">
            <button className={`chip ${!campus ? "on" : ""}`} aria-pressed={!campus} onClick={() => setCampus("")}>All campuses {b.students.length}</button>
            {campuses.map(([c, n]) => {
              const list = b.students.filter(s => s.campus === c);
              const ready = list.length > 0 && list.every(s => s.status !== "held") && list.some(s => s.status !== "withheld");
              return <button key={c} className={`chip ${campus === c ? "on" : ""}`} aria-pressed={campus === c} onClick={() => setCampus(c)}
                title={ready ? `Every student at ${c} is ready, approved or withheld` : undefined}>{ready ? "✓ " : ""}{c} {n}</button>;
            })}
          </div>
        </div>
      )}

      {blocking.length > 0 && (
        <div className="notice red">
          {view.counts.held} student{view.counts.held === 1 ? " is" : "s are"} pending{where} because of {blocking.length} blocking issue{blocking.length === 1 ? "" : "s"}.{toApprove.length > 0 ? ` The rest ${campus ? `of ${campus}` : "of the batch"} can be approved now.` : ""}
          {" "}<button className="btn quiet" onClick={() => setTab("issues")}>Show issues</button>
        </div>
      )}

      <div className="two-col">
        <div>
          <div className="tabs" role="tablist">
            {[["students", "Students", view.students.length], ["papers", "Papers", view.papers.length], ["issues", "Issues", view.exceptions.filter(e => !e.accepted).length], ["approvals", "Approvals", b.approvals.length]].map(([k, l, n]) => (
              <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}<span className="n">{n}</span></button>
            ))}
          </div>

          {tab === "students" && (
            <div className="sheet">
              <div className="sheet-head">
                <div className="chips">{STATUS_FILTERS.map(([k, l]) => <button key={k} className={`chip ${filter === k ? "on" : ""}`} onClick={() => setFilter(k)}>{l}{k !== "all" && view.counts[k] ? ` ${view.counts[k]}` : ""}</button>)}</div>
                <span className="small muted">Grade points per paper, in course order</span>
              </div>
              <div className="scroll">
                <table className="ledger">
                  <thead><tr><th>Regd No</th><th>Name</th><th>Papers</th><th className="num">Credits</th><th className="num">GPA</th><th>Grade</th><th>Status</th></tr></thead>
                  <tbody>
                    {students.map(s => {
                      const byCode = new Map(s.papers.map(p => [p.paperCode, p]));
                      const extra = s.papers.filter(p => !paperOrder.includes(p.paperCode));
                      return (
                        <tr key={s.regdNo}>
                          <td><Link to={`/s/${sid}/students/${s.regdNo}`}>{s.regdNo}</Link></td>
                          <td>{s.name}{campuses.length > 1 && !campus && s.campus && <span className="small muted"> · {s.campus}</span>}{s.reasons.length > 0 && <div className="small" style={{ color: "var(--seal)" }}>{s.reasons[0]}{s.reasons.length > 1 ? ` (+${s.reasons.length - 1} more)` : ""}</div>}</td>
                          <td style={{ whiteSpace: "nowrap" }}>
                            {[...paperOrder.map(c => byCode.get(c)).filter(Boolean), ...extra].map(p => (
                              <span key={p.paperCode} className={`gp ${p.status}`} title={`${p.paperCode}: ${p.status}${p.combPct !== null ? `, ${p.combPct}%` : ""}`}>
                                {p.status === "Pending" ? "?" : p.status === "Absent" ? "Ab" : p.status === "Error" ? "!" : p.combNP === "--" ? "F" : String(p.combNP).replace("< ", "<")}
                              </span>
                            ))}
                          </td>
                          <td className="num">{s.sumCredits}</td>
                          <td className="num"><b>{fmtGpa(s.publishedGpa)}</b></td>
                          <td className="nowrap">{s.letterGrade ? `${s.letterGrade} (${s.qualifier})` : ""}</td>
                          <td><Status status={s.status} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {students.length === 0 && <div className="empty">No students with this status.</div>}
              </div>
            </div>
          )}

          {tab === "papers" && (
            <div className="sheet scroll">
              <table className="ledger">
                <thead><tr><th>Paper</th><th>Title</th><th className="num">Credits</th><th className="num">Students</th><th className="num">Passed</th><th className="num">Failed</th><th className="num">Absent</th><th className="num">Pending</th><th className="num">Mean COMB</th></tr></thead>
                <tbody>
                  {view.papers.map(p => (
                    <tr key={p.paperCode}>
                      <td><b>{p.paperCode}</b></td><td className="muted">{p.title}</td><td className="num">{p.credits}</td>
                      <td className="num">{p.students}</td><td className="num">{p.pass}</td>
                      <td className="num" style={{ color: p.fail ? "var(--seal)" : undefined }}>{p.fail || ""}</td>
                      <td className="num">{p.absent || ""}</td><td className="num">{p.pending + p.error || ""}</td>
                      <td className="num">{p.meanComb === null ? "—" : `${p.meanComb}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === "issues" && (
            <div className="sheet">
              {view.exceptions.length === 0 && <div className="empty">No issues {campus ? `for ${campus}` : "in this batch"}.</div>}
              {view.exceptions.map(e => (
                <div key={e.key} className={`issue ${e.accepted ? "accepted" : ""}`}>
                  <Sev severity={e.severity} />
                  <div>
                    <div>{e.message}</div>
                    <div className="small muted">
                      {e.regdNo && <><Link to={`/s/${sid}/students/${e.regdNo}`}>{e.regdNo}</Link>{", "}</>}
                      first seen {fmtWhen(e.firstSeen)}{e.accepted ? ", accepted" : ""}
                    </div>
                  </div>
                  {!e.accepted && can.operate && e.severity !== "info" && !NOT_ACCEPTABLE.has(e.code) && (
                    <button className="btn quiet" onClick={() => setOverride({ type: "accept", code: e.code, batchKey: b.key, regdNo: e.regdNo, paperCode: e.paperCode })}>Accept</button>
                  )}
                </div>
              ))}
            </div>
          )}

          {tab === "approvals" && (
            <div className="sheet">
              {b.approvals.length === 0 && <div className="empty">Nothing approved in this batch yet.</div>}
              {b.approvals.map(a => (
                <div key={a.id} className="issue">
                  <span className={`status ${a.action === "approve" ? "approved" : "held"}`}>{a.action === "approve" ? "Approved" : "Withdrawn"}</span>
                  <div><div>{a.count} result{a.count === 1 ? "" : "s"} by {a.by}</div>{a.note && <div className="small muted">{a.note}</div>}</div>
                  <span className="small muted">{fmtWhen(a.at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="side-panel">
          <div className="sheet pad">
            <h3>{campus ? `Where ${campus} stands` : "Where the batch stands"}</h3>
            <div style={{ margin: "12px 0 8px" }}><StateStrip counts={view.counts} total={view.students.length} /></div>
            <table className="ledger small">
              <tbody>
                {[["Ready", view.counts.ready], ["Changed since approval", view.counts.changed], ["Approved", view.counts.approved], ["Pending", view.counts.held], ["Withheld", view.counts.withheld]].map(([l, n]) => n ? <tr key={l}><td>{l}</td><td className="num">{n}</td></tr> : null)}
              </tbody>
            </table>
          </div>
          <div className="sheet pad">
            <h3>Grades of released results</h3>
            <div className="bars" style={{ marginTop: 12 }}>
              {grades.map(([g, n]) => (
                <div key={g} className={g === "Fail" || g === "Absent" ? "fail" : ""}><span>{g}</span><i style={{ width: `${(n / maxGrade) * 100}%` }} /><span className="num">{n}</span></div>
              ))}
              {grades.length === 0 && <p className="muted small">No released results yet.</p>}
            </div>
          </div>
        </div>
      </div>

      {confirm && (
        <Modal title={confirm === "approve" ? `Approve ${toApprove.length} results${where}` : `Withdraw approval${where}`} onClose={() => setConfirm(null)} footer={<>
          <button className="btn" onClick={() => setConfirm(null)}>Cancel</button>
          <button className={`btn ${confirm === "approve" ? "approve" : "danger"}`} disabled={busy} onClick={() => approve(confirm)}>{confirm === "approve" ? "Approve" : "Withdraw approval"}</button>
        </>}>
          <p>{confirm === "approve"
            ? `This approves every ready result in ${label}${where}. ${view.counts.held ? `${view.counts.held} pending student${view.counts.held === 1 ? "" : "s"}${where} stay out until their issues are resolved. ` : ""}${campus ? "Other campuses are not affected. " : ""}If marks change later, those students come back here as "Changed since approval".`
            : `Approved results${where} (${toRevoke.length}) go back to Ready and need approving again.${campus ? " Other campuses are not affected." : ""}`}</p>
          <label>Note (optional)<textarea value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Checked against department tabulation sheet" /></label>
        </Modal>
      )}
      {override && <OverrideDialog sessionId={sid} preset={override} onClose={() => setOverride(null)} onDone={reload} />}
    </>
  );
}
