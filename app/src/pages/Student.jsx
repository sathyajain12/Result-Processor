import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { enc } from "../api.js";
import { useSession, useCan, useLoad, NOT_ACCEPTABLE, Loading, Status, Sev, fmtGpa, fmtPct, fmtNP, fmtWhen } from "../components/ui.jsx";
import OverrideDialog from "../components/OverrideDialog.jsx";
import { Editable, CourseEditor, useEdits } from "../components/Edit.jsx";
import DetentionReason from "../components/DetentionReason.jsx";
import { Icon } from "../components/icons.jsx";

const OVERRIDE_LABEL = {
  mark: "Mark edited", "student-field": "Student detail edited", "course-field": "Course value changed", accept: "Issue accepted",
  "exclude-paper": "Paper left out", "skip-validation": "Validation skipped", "exclude-student": "Student left out", "student-batch": "Batch chosen"
};
const FIELD_LABEL = { semCredits: "Sem-Credits", name: "Name", campus: "Campus", batch: "Batch", cieMax: "CIE maximum", eseMax: "ESE maximum",
  credits: "Credits", calcType: "Exam type", cieWeight: "CIE weight", eseWeight: "ESE weight", passCategory: "Pass rule" };

export default function Student() {
  const { sid, me } = useSession();
  const { regd } = useParams();
  const state = useLoad(`/sessions/${enc(sid)}/students/${enc(regd)}`);
  return (
    <div className="page">
      <Loading state={state}>{d => <StudentBody d={d} sid={sid} me={me} reload={state.reload} />}</Loading>
    </div>
  );
}

const isFailNP = v => v === "--" || String(v).startsWith("<");

function Working({ trace }) {
  return (
    <div className="working">
      {trace.filter(t => t.key !== "status").map((t, i) => (
        <span key={i} className={isFailNP(t.value) && t.key !== "cie" && t.key !== "ese" && t.key !== "comb" ? "fail" : ""}>
          <b>{t.label}</b> {t.key.endsWith("NP") ? fmtNP(t.value) : t.value === null ? "—" : `${t.value}%`}
          {t.note && <span>, {t.note}</span>}
        </span>
      ))}
      {trace.find(t => t.key === "status")?.note && <span className="fail">{trace.find(t => t.key === "status").note}</span>}
    </div>
  );
}

function graceLabel(g) {
  return g.kind === "COMB"
    ? `Graced +${g.marks}, COMB ${g.fromPct}% to ${g.toPct}%, ESE ${g.eseFromPct}% to ${g.eseToPct}%`
    : `Graced +${g.marks}, ESE ${g.fromPct}% to ${g.toPct}%`;
}

function graceSummary(g) {
  const left = `used ${g.used}, left ${g.left}`;
  if (!g.attempt) return `Grace pool ${g.pool}, ${left}.`;
  if (g.terminal) return `Terminal supplementary (attempt ${g.attempt}): fresh grace pool ${g.pool}, ${left}.`;
  return `Supplementary attempt ${g.attempt}: grace pool ${g.pool}, ${g.usedBefore} used in the regular exam, ${g.available} available, ${left}.`;
}

function StudentBody({ d, sid, me, reload }) {
  const [override, setOverride] = useState(null);
  const [courseOpen, setCourseOpen] = useState(null);
  const { student: s, result: r } = d;
  const can = useCan();
  const canEdit = can.admin;
  const edits = d.edits || {};
  const { busy, save, revert } = useEdits(sid, reload);
  // Editors for one student detail or one mark.
  const studentEditor = field => ({ busy, onRevert: revert,
    onSave: (value, reason) => save([{ type: "student-field", regdNo: s.regdNo, field, value }], reason) });
  const markEditor = (paperCode, field) => ({ busy, onRevert: revert,
    onSave: (value, reason) => save([{ type: "mark", regdNo: s.regdNo, paperCode, field, value }], reason) });
  const markCell = (p, field) => {
    const raw = field === "CIE" ? p.cie : p.ese;
    const max = p.course?.[field === "CIE" ? "cieMax" : "eseMax"];
    const shown = raw === "A" ? "Ab" : fmtPct(field === "CIE" ? p.ciePct : p.eseComptPct);
    const editable = canEdit && p.origin !== "base" && ((max ?? 0) > 0 || (raw !== null && raw !== undefined));
    return (
      <Editable label={`${field} mark for ${p.paperCode}`} initial={raw ?? ""} hint={max ? `out of ${max}` : null} edit={edits[`mark|${p.paperCode}|${field}`]}
        canEdit={editable} editor={markEditor(p.paperCode, field)}>{shown}</Editable>
    );
  };
  const numeric = r && !isNaN(Number(r.publishedGpa));

  return (
    <>
      <div className="crumbs">
        <Link to={`/s/${sid}`}>Batches</Link>
        {d.batchId && <>{" / "}<Link to={`/s/${sid}/batches/${d.batchId}`}>{s.programme} Sem {s.semester}</Link></>}
      </div>

      <div className="two-col">
        <div className="card-sheet">
          <div className="card-head">
            <div>
              <h1><Editable label="Name" initial={s.name} edit={edits["student|name"]} canEdit={canEdit} editor={studentEditor("name")}>{s.name}</Editable></h1>
              <dl>
                <dt>Regd No</dt><dd>{s.regdNo}</dd>
                <dt>Programme</dt><dd>{s.programme}, Semester {s.semester}</dd>
                <dt>Campus</dt><dd><Editable label="Campus" initial={s.campus} edit={edits["student|campus"]} canEdit={canEdit} editor={studentEditor("campus")}>{s.campus || "—"}</Editable></dd>
                <dt>Batch</dt><dd><Editable label="Batch" initial={s.batch} edit={edits["student|batch"]} canEdit={canEdit} editor={studentEditor("batch")}>{s.batch || "—"}</Editable></dd>
                <dt>Credits</dt><dd>{r ? `${r.sumCredits} of ` : ""}<Editable label="Sem-Credits (SMF)" initial={s.semCredits ?? ""} inputMode="decimal" edit={edits["student|semCredits"]} canEdit={canEdit} editor={studentEditor("semCredits")}>
                    {s.semCredits ?? "—"}</Editable>&nbsp;expected</dd>
              </dl>
              {canEdit && <p className="legend-edit mt-1"><Icon name="edit" size={12} />Click a value to edit it. Edits need a reason, survive the next sync and recompute the result.</p>}
            </div>
            {r && (
              <div className="verdict">
                <div className={`gpa ${!r.releasable && r.state !== "Withheld" ? "provisional" : numeric ? "" : "fail"}`}>{r.state === "Withheld" ? "—" : fmtGpa(r.publishedGpa)}</div>
                <div className="grade">{r.letterGrade ? `${r.letterGrade}, ${r.qualifier}` : r.state === "Withheld" ? "Withheld" : ""}</div>
                {!r.releasable && r.state !== "Withheld" && <div className="provisional-note">Provisional until the issues are cleared</div>}
                <div style={{ marginTop: 8 }}><Status status={r.status} /></div>
                {r.calculatedGpa !== null && !numeric && <div className="small muted" style={{ marginTop: 6 }}>Calculated GPA {fmtGpa(r.calculatedGpa)}</div>}
              </div>
            )}
          </div>

          {!r && <div className="empty">Not computed yet for this student.</div>}
          {r?.supplementary && (
            <div className="notice" style={{ margin: "16px 28px 0" }}>
              Supplementary result built on <Link to={`/s/${r.supplementary.baseSessionId}/students/${s.regdNo}`}>{r.supplementary.baseSessionName || r.supplementary.baseSessionId}</Link>{" "}
              (approved{r.supplementary.baseApprovedBy ? ` by ${r.supplementary.baseApprovedBy}` : ""}{r.supplementary.baseApprovedAt ? `, ${fmtWhen(r.supplementary.baseApprovedAt)}` : ""}; GPA {fmtGpa(r.supplementary.baseGpa)}).
              {r.supplementary.replaced.length > 0 ? ` Re-appeared in ${r.supplementary.replaced.join(", ")}.` : ""}
            </div>
          )}
          {d.kind === "supplementary" && r && !r.supplementary && d.baseSession && (
            <div className="notice red" style={{ margin: "16px 28px 0" }}>No approved result in <Link to={`/s/${d.baseSession.id}`}>{d.baseSession.name}</Link> to build on.</div>
          )}
          {d.reappearedIn?.length > 0 && (
            <div className="notice" style={{ margin: "16px 28px 0" }}>
              Re-appeared in {d.reappearedIn.map((x, i) => <span key={x.id}>{i > 0 && ", "}<Link to={`/s/${x.id}/students/${s.regdNo}`}>{x.name}</Link></span>)}.
            </div>
          )}
          {r?.reasons?.length > 0 && <div className="notice red" style={{ margin: "16px 28px 0" }}>{r.reasons.map((x, i) => <div key={i}>{x}</div>)}</div>}

          {d.papers.length > 0 && (
            <div role="table" aria-label="Papers">
              <div className="paper-row head" role="row">
                <span>Paper</span><span className="num">Credits</span><span className="num">CIE</span><span className="num">ESE</span><span className="num">COMB</span><span className="num">Points</span><span>How it was worked out</span>
              </div>
              {d.papers.map(p => (
                <div className="paper-row" role="row" key={p.paperCode}>
                  <div>
                    <div className="code">{p.paperCode}{p.origin === "supp" && <span className="tag">Re-appeared</span>}{p.origin === "base" && <span className="tag">From regular</span>}</div>
                    {p.grace && <div className="small grace-note">{graceLabel(p.grace)}</div>}
                    <div className="small muted">{p.title || "Not in course master"}</div>
                    {p.courseCode && p.courseCode !== p.paperCode && <div className="small faint">Course {p.courseCode}</div>}
                    {p.replaced && <div className="small muted">Was {p.replaced.combPct === null || p.replaced.combPct === undefined ? "—" : `${p.replaced.combPct}%`}, {p.replaced.status === "Fails" ? "failed" : p.replaced.status.toLowerCase()}</div>}
                    {p.overrides && <div className="small" style={{ color: "var(--changed)" }}>Override: {Object.entries(p.overrides).map(([k, v]) => `${k} ${v}`).join(", ")}</div>}
                    {canEdit && p.course && p.origin !== "base" && (
                      <button className="btn quiet small" style={{ paddingLeft: 0, marginTop: 2 }} onClick={() => setCourseOpen(courseOpen === p.paperCode ? null : p.paperCode)}>
                        <Icon name="edit" size={12} />{courseOpen === p.paperCode ? "Close course values" : "Edit course values"}</button>
                    )}
                  </div>
                  <span className="num" data-label="Credits">{p.credits}{edits[`course|${p.paperCode}|credits`] && <span className="edited-dot" title="Credits changed for this student" />}</span>
                  <span className="num" data-label="CIE">{markCell(p, "CIE")}</span>
                  <span className="num" data-label="ESE">{markCell(p, "ESE")}</span>
                  <span className="num" data-label="COMB">{fmtPct(p.combPct)}</span>
                  <span className="num" data-label="Points"><span className={`gp ${p.status}`}>{p.status === "Pending" ? "?" : p.status === "Absent" ? "Ab" : fmtNP(p.combNP)}</span></span>
                  <Working trace={p.trace} />
                  {courseOpen === p.paperCode && <CourseEditor paper={p} edits={edits} editor={{ busy, save, revert, regdNo: s.regdNo }} onClose={() => setCourseOpen(null)} />}
                </div>
              ))}
            </div>
          )}
          {r && (
            <div className="pad small muted" style={{ padding: "14px 28px" }}>
              GPA = sum of credits × grade points ({r.sumCreditNP ?? "—"}) ÷ credits ({r.sumCredits}), rounded to one decimal.
              {r.failedCourses && <> Failed: {r.failedCourses}.</>}
              {r.grace && (r.grace.used > 0 || r.grace.refused > 0) && <> {graceSummary(r.grace)}</>}
            </div>
          )}
        </div>

        <div className="side-panel">
          {r?.cgpa && (
            <div className="sheet pad">
              <h3>CGPA</h3>
              {r.cgpa.status === "COMPUTED"
                ? <p style={{ marginTop: 6 }}><b style={{ fontSize: "1.4rem" }}>{r.cgpa.cgpa.toFixed(2)}</b> {r.cgpa.letterGrade}, {r.cgpa.qualifier}<br /><span className="small muted">{r.cgpa.totalCreditNP} ÷ {r.cgpa.totalCredits} over {r.cgpa.prior.length + 1} semesters</span></p>
                : <p className="muted small" style={{ marginTop: 6 }}>{r.cgpa.status === "WITHHELD" ? "Withheld" : "Not applicable"}: {r.cgpa.reason}</p>}
            </div>
          )}

          {d.exceptions.length > 0 && (
            <div className="sheet">
              <div className="sheet-head"><h3>Issues</h3></div>
              {d.exceptions.map(e => (
                <div key={e.key} className={`issue ${e.accepted ? "accepted" : ""}`} style={{ gridTemplateColumns: "auto 1fr" }}>
                  <Sev severity={e.severity} />
                  <div className="small">{e.message}
                    {(e.code === "BATCH_REROUTED" || e.code === "BATCH_AMBIGUOUS") &&
                      <DetentionReason sid={sid} regdNo={s.regdNo} value={d.detentionReason} canEdit={can.operate} onSaved={reload} />}
                    {!e.accepted && can.operate && e.severity !== "info" && !NOT_ACCEPTABLE.has(e.code) && (
                      <div><button className="btn quiet small" style={{ paddingLeft: 0 }} onClick={() => setOverride({ type: "accept", code: e.code, batchKey: null, regdNo: s.regdNo, paperCode: e.paperCode, ...keyParts(e.key) })}>Accept</button></div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="sheet pad">
            <h3>History</h3>
            <div className="timeline" style={{ marginTop: 10 }}>
              {r?.approval && <div><b>Approved</b><br /><span className="muted">{r.approval.by}, {fmtWhen(r.approval.at)}</span></div>}
              {d.markChanges.map((c, i) => <div key={`m${i}`}><b>{c.component} {c.paperCode}</b>: {c.from ?? "blank"} to {c.to ?? "removed"}<br /><span className="muted">{fmtWhen(c.at)}</span></div>)}
              {d.timeline.slice().reverse().map(t => <div key={t.runId}>Result {t.state === "Result" ? `GPA ${fmtGpa(t.publishedGpa)}` : t.state.toLowerCase()}<br /><span className="muted">computed {fmtWhen(t.at)}</span></div>)}
            </div>
          </div>

          {d.overrides.length > 0 && (
            <div className="sheet pad">
              <h3>Edits and overrides</h3>
              <div className="timeline" style={{ marginTop: 10 }}>
                {d.overrides.map(o => (
                  <div key={o.id} style={{ opacity: o.revokedAt ? 0.5 : 1 }}>
                    <b>{OVERRIDE_LABEL[o.type] || o.type}</b>{o.paperCode ? `, ${o.paperCode}` : ""}
                    {o.field && <><br />{o.type === "mark" ? o.field : FIELD_LABEL[o.field] || o.field}: {o.sheetValue !== null && o.sheetValue !== undefined && o.type !== "course-field" ? <><s className="faint">{o.sheetValue}</s> → </> : ""}<b>{o.value}</b></>}
                    <br /><span className="muted">{o.reason}, {o.by}, {fmtWhen(o.at)}{o.revokedAt ? ", replaced or reverted" : ""}</span>
                    {!o.revokedAt && canEdit && ["mark", "student-field", "course-field"].includes(o.type) && (
                      <><br /><button className="btn quiet small" style={{ paddingLeft: 0 }} disabled={busy} onClick={() => revert(o.id)}>Revert to sheet</button></>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      {override && <OverrideDialog sessionId={sid} preset={override} onClose={() => setOverride(null)} onDone={reload} />}
    </>
  );
}

function keyParts(key) {
  const [, batchKey] = key.split("|");
  return { batchKey: batchKey || null };
}
