import { useState } from "react";
import { Link } from "react-router-dom";
import { enc } from "../api.js";
import { useSession, useCan, useLoad, NOT_ACCEPTABLE, Loading, Sev, EmptyState, fmtWhen } from "../components/ui.jsx";
import DetentionReason from "../components/DetentionReason.jsx";
import { Icon } from "../components/icons.jsx";
import OverrideDialog from "../components/OverrideDialog.jsx";

const NAMES = {
  NO_MARKS: "No marks received", MARK_MISSING: "Mark not received", MARK_INVALID: "Mark is not valid", UNKNOWN_PAPER: "Paper not in course master",
  NOT_IN_SMF: "Student not in SMF", NO_CMF_FOR_BATCH: "Batch has no CMF courses", COURSE_NOT_RECEIVED: "Course not received", BATCH_AMBIGUOUS: "Batch unclear",
  CREDIT_MISMATCH: "Credits do not match SMF", WEIGHTAGE_INVALID: "Weightage invalid", COURSE_PARTIAL: "Course taken by part of batch", MARK_LOW: "Mark below 20%",
  MARK_ZERO: "Mark is zero", COURSE_MISMATCH: "Course matched loosely", WEIGHTAGE_NONSTANDARD: "Unusual weightage", LEFT_STUDENT: "Student left",
  BATCH_REROUTED: "Batch rerouted", PAPER_EXCLUDED: "Paper override in force",
  MARK_ABOVE_MAX: "Mark above CMF maximum", MARK_UNEXPECTED: "Mark where CMF expects none",
  SUPP_NO_BASE_RESULT: "No regular result to build on", SUPP_NOTHING_REAPPEARED: "No supplementary marks", SUPP_PAPER_NOT_IN_BASE: "Paper not in regular result",
  SUPP_REAPPEAR_PASSED: "Re-appeared in a passed paper", SUPP_CREDITS_CHANGED: "Credits changed from regular", SUPP_BATCH_DIFFERS: "Batch differs from regular",
  GRACE_APPLIED: "Grace applied", GRACE_NOT_AVAILABLE: "Grace not available", GRACE_NO_COURSE_TYPE: "No Course Type for grace"
};

const ACTIONS = {
  UNKNOWN_PAPER: [["skip-validation", "Skip validation"], ["exclude-paper", "Leave out paper"]],
  MARK_INVALID: [["course-field", "Change course value"]],
  NOT_IN_SMF: [],
  BATCH_AMBIGUOUS: [["student-batch", "Choose batch"]]
};

export default function Issues() {
  const { sid, session } = useSession();
  const [severity, setSeverity] = useState("block");
  const [code, setCode] = useState("");
  const [q, setQ] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [override, setOverride] = useState(null);
  const can = useCan();
  const params = new URLSearchParams({ ...(severity && { severity }), ...(code && { code }), ...(q && { q }), ...(accepted && { accepted: "1" }) });
  const state = useLoad(`/sessions/${enc(sid)}/exceptions?${params}`);

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Issues</h1><p className="sub muted">Everything holding back a result, and everything worth a second look. Fix the source sheet and sync, or record an override with a reason.</p></div>
        <a className="btn" href={`/api/sessions/${enc(sid)}/export/exceptions.csv`}><Icon name="download" />Download as CSV</a>
      </div>
      <Loading state={state}>{d => (
        <>
          <div className="sheet pad" style={{ marginBottom: 16 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div className="chips">
                {[["block", "Blocking"], ["warn", "To check"], ["info", "Notes"], ["", "All"]].map(([k, l]) => (
                  <button key={k} className={`chip ${severity === k ? "on" : ""}`} onClick={() => { setSeverity(k); setCode(""); }}>
                    {l} {d.counts.filter(c => !k || c.severity === k).reduce((n, c) => n + c.open, 0)}
                  </button>
                ))}
              </div>
              <div className="row">
                <input type="search" placeholder="Regd No, paper or text" value={q} onChange={e => setQ(e.target.value)} aria-label="Filter issues" />
                <label className="row" style={{ display: "flex", color: "var(--ink)" }}><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} />Show accepted</label>
              </div>
            </div>
            <div className="chips" style={{ marginTop: 12 }}>
              {d.counts.filter(c => !severity || c.severity === severity).map(c => (
                <button key={c.code} className={`chip ${code === c.code ? "on" : ""}`} onClick={() => setCode(code === c.code ? "" : c.code)}>{NAMES[c.code] || c.code} {c.open}</button>
              ))}
            </div>
          </div>
          <div className="sheet">
            {d.items.length === 0 && (severity === "block"
              ? <EmptyState icon="approve" title="Nothing is blocking">Every computable result can be approved.</EmptyState>
              : <EmptyState icon="search" title="No issues match these filters" />)}
            {d.items.map(e => (
              <div key={e.key} className={`issue ${e.accepted ? "accepted" : ""}`}>
                <Sev severity={e.severity} />
                <div>
                  <div><b>{NAMES[e.code] || e.code}</b>: {e.message}</div>
                  {(e.code === "BATCH_REROUTED" || e.code === "BATCH_AMBIGUOUS") && e.regdNo &&
                    <DetentionReason sid={sid} regdNo={e.regdNo} value={e.recordedReason} canEdit={can.operate} onSaved={state.reload} />}
                  <div className="small muted">
                    {e.regdNo && <><Link to={`/s/${sid}/students/${e.regdNo}`}>{e.studentName || e.regdNo}</Link>{" "}{e.regdNo}{", "}</>}
                    {e.batchId && <><Link to={`/s/${sid}/batches/${e.batchId}`}>{e.batchKey.split("|").slice(0, 2).join(" Sem ")}</Link>{", "}</>}
                    first seen {fmtWhen(e.firstSeen)}
                  </div>
                </div>
                {!e.accepted && can.operate && e.severity !== "info" && (
                  <div className="row">
                    {can.admin && (ACTIONS[e.code] || []).map(([type, label]) => (
                      <button key={type} className="btn quiet" onClick={() => setOverride({ type, regdNo: e.regdNo, paperCode: e.paperCode, field: "cieMax", value: "" })}>{label}</button>
                    ))}
                    {!NOT_ACCEPTABLE.has(e.code) && <button className="btn quiet" onClick={() => setOverride({ type: "accept", code: e.code, batchKey: e.batchKey, regdNo: e.regdNo, paperCode: e.paperCode })}>Accept</button>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}</Loading>
      {override && <OverrideDialog sessionId={sid} preset={override} onClose={() => setOverride(null)} onDone={() => { state.reload(); session.reload(); }} />}
    </div>
  );
}
