import { useState } from "react";
import { Link } from "react-router-dom";
import { api, enc } from "../api.js";
import { useSession, useCan, useLoad, Loading, useAction, fmtWhen } from "../components/ui.jsx";

const PASS = { 1: "COMB 40%", 2: "COMB 50%", 3: "ESE 50% and COMB 50%" };

function ProgrammeRow({ p, canEdit, onSaved }) {
  const [edit, setEdit] = useState(null);
  const [busy, run] = useAction();
  const save = async () => {
    const r = await run(() => api.put("/reference/programmes", edit), "Programme saved. Recompute each open session to apply it.");
    if (r) { setEdit(null); onSaved(); }
  };
  if (edit) {
    const set = k => e => setEdit({ ...edit, [k]: e.target.value });
    return (
      <tr>
        <td><b>{p.code}</b></td>
        <td><select value={edit.passCategory} onChange={set("passCategory")}>{[1, 2, 3].map(n => <option key={n} value={n}>{PASS[n]}</option>)}</select></td>
        {["cieNP", "eseNP", "combNP"].map(k => <td key={k}><select value={edit[k]} onChange={set(k)}><option>I-A</option><option>I-B</option></select></td>)}
        <td><select value={edit.gradeTable || ""} onChange={set("gradeTable")}><option value="">None</option><option>II-A</option><option>II-B</option></select></td>
        <td className="num"><button className="btn primary" disabled={busy} onClick={save}>Save</button> <button className="btn quiet" onClick={() => setEdit(null)}>Cancel</button></td>
      </tr>
    );
  }
  return (
    <tr>
      <td><b>{p.code}</b>{p.customised && <div className="small muted">Edited by {p.updatedBy}, {fmtWhen(p.updatedAt)}</div>}</td>
      <td>{PASS[p.passCategory]}</td><td>{p.cieNP}</td><td>{p.eseNP}</td><td>{p.combNP}</td><td>{p.gradeTable || "—"}</td>
      <td className="num">{canEdit && <button className="btn quiet" onClick={() => setEdit({ code: p.code, passCategory: p.passCategory, cieNP: p.cieNP, eseNP: p.eseNP, combNP: p.combNP, gradeTable: p.gradeTable })}>Edit</button>}</td>
    </tr>
  );
}

const pct = v => `${Math.round(v * 1000) / 10}%`;

function CompletenessRules({ sid }) {
  const state = useLoad(`/sessions/${enc(sid)}/thresholds`);
  const can = useCan();
  const [edit, setEdit] = useState(null);
  const [busy, run] = useAction();
  const save = async body => {
    const r = await run(() => api.put(`/sessions/${enc(sid)}/thresholds`, body), "Completeness rules saved. Recompute to apply them.");
    if (r) { setEdit(null); state.reload(); }
  };

  return (
    <div className="sheet" style={{ marginBottom: 20 }}>
      <div className="sheet-head">
        <div><h2>Completeness rules</h2><span className="small muted">How this session decides whether a student's marks are complete. Applies to this session only.</span></div>
        {state.data && can.admin && !edit && (
          <div className="row">
            {state.data.customised && <button className="btn quiet" disabled={busy} onClick={() => save({ reset: true })}>Reset to defaults</button>}
            <button className="btn" onClick={() => setEdit({ low: Math.round(state.data.values.lowMarkRatio * 100) })}>Change</button>
          </div>
        )}
      </div>
      <Loading state={state}>{t => {
        const v = t.values, d = t.defaults;
        const changed = k => v[k] !== d[k] && <span className="tag">default {pct(d[k])}</span>;
        return (
          <div className="pad">
            {t.customised && <p className="small muted" style={{ marginBottom: 10 }}>Changed by {t.updatedBy}, {fmtWhen(t.updatedAt)}. Results use these rules from the next compute.</p>}
            <table className="ledger rules">
              <tbody>
                <tr><td><b>Course count</b></td><td>A course in the CMF that nobody in the batch has marks for ("Course not received") keeps pending the students who may need it. A student whose credits already match their SMF Sem-Credits, with no issue of their own, goes ahead, so one campus can be released while another waits. A course only some students have marks for is a warning ("Course taken by part of batch"); it makes nobody pending. <span className="small muted">Fixed rule (Rule 1B).</span></td></tr>
                <tr>
                  <td><b>Low mark warning</b></td>
                  <td>
                    {edit
                      ? <label className="row" style={{ display: "flex", color: "var(--ink)" }}>Warn when a CIE or ESE mark is below <input type="number" min={0} max={t.limits.lowMarkRatio.max * 100} step={5} value={edit.low} onChange={e => setEdit({ ...edit, low: e.target.value })} style={{ width: 80 }} />% of its maximum</label>
                      : <>Warn when a CIE or ESE mark is below <b>{pct(v.lowMarkRatio)}</b> of its maximum {changed("lowMarkRatio")}</>}
                    <div className="small muted">A warning to check for typing errors; it never makes a result pending. A mark of 0 always gets its own warning. (Rule 2 warnings.)</div>
                  </td>
                </tr>
                <tr><td><b>Missing mark</b></td><td>A paper without a CIE or ESE mark it needs is Pending and so is the student's result, not failed. <span className="small muted">Fixed rule (Rule 2).</span></td></tr>
                <tr><td><b>Unreadable mark</b></td><td>Text that is not a mark makes the student's result pending. "A" or "AB" means absent; "L" means the student has left. <span className="small muted">Fixed rule (Rule 2).</span></td></tr>
                <tr><td><b>Mark vs maximum</b></td><td>A mark above the CMF maximum, or a mark for a component the CMF has no maximum for, is a warning; the mark is used as given. <span className="small muted">Fixed rule (Rule 3B).</span></td></tr>
                <tr><td><b>Electives</b></td><td>DSE, IDM, SEC, AEC, MDC, VBC, VOC and elective courses are expected only if the student chose them in the SMF. <span className="small muted">Fixed rule.</span></td></tr>
                <tr><td><b>Credits</b></td><td>The papers' credits must add up to the SMF Sem-Credits, otherwise the result is Withheld. <span className="small muted">Fixed rule.</span></td></tr>
                <tr><td><b>Supplementary</b></td><td>In a supplementary session students re-take only some papers, so the course-count rule is off; every paper must match one in the student's regular result. <span className="small muted">Fixed rule.</span></td></tr>
              </tbody>
            </table>
            {edit && (
              <div className="row" style={{ marginTop: 12 }}>
                <button className="btn primary" disabled={busy} onClick={() => save({ lowMarkRatio: Number(edit.low) / 100 })}>Save</button>
                <button className="btn quiet" onClick={() => setEdit(null)}>Cancel</button>
                <span className="small muted">Saved changes apply after the next <Link to={`/s/${sid}`}>Recompute</Link>.</span>
              </div>
            )}
            {can.locked && <p className="small muted" style={{ marginTop: 10 }}>This session is locked, so its rules cannot be changed.</p>}
          </div>
        );
      }}</Loading>
    </div>
  );
}

function GracingRules() {
  return (
    <div className="sheet" style={{ marginBottom: 20 }}>
      <div className="sheet-head"><div><h2>Gracing</h2><span className="small muted">Applied automatically when results are computed. Every graced paper is listed under Issues, Notes, Grace applied.</span></div></div>
      <div className="pad">
        <table className="ledger rules">
          <tbody>
            <tr><td><b>Pool</b></td><td>1% of the total ESE maximum of the student's papers in the semester. Five papers out of 100 give 5 marks; with one out of 50, 4.5 marks. Viva and project papers count; internal-only and non-credit papers do not.</td></tr>
            <tr><td><b>Which papers</b></td><td>Failed Theory papers with an ESE (Course Type Theory in the CMF), SWAYAM and NPTEL included. Never Practicals, Viva, Project, or an absent paper.</td></tr>
            <tr><td><b>Range</b></td><td>Up to 3 below the pass mark, after converting to whole percentages: 37 to 39 at a pass mark of 40, 47 to 49 at 50.</td></tr>
            <tr><td><b>Order</b></td><td>In seriatim: the order papers appear in the Grade register (CMF Sequence, then course code). A paper the remaining pool cannot cover fails, and the next paper is still tried.</td></tr>
            <tr><td><b>ESE grace</b></td><td>ESE is raised to its pass mark, only if the paper then passes on COMB. It costs the ESE shortfall: 39 to 40 out of 100 costs 1; 19 out of 50 (38%) costs 1.</td></tr>
            <tr><td><b>COMB grace</b></td><td>Where ESE grace does not apply: ESE is raised just enough for COMB to reach its pass mark, and CIE is not touched. Only when the ESE passes or is itself within 3 of its pass mark: CIE 40% with ESE 34 gives COMB 37, but the ESE is 6 short, so the paper fails. It costs the COMB shortfall: CIE 30, ESE 46, COMB 38 costs 2, and ESE becomes 50. A paper takes ESE or COMB grace, never both.</td></tr>
            <tr><td><b>PG and professional</b></td><td>The same rules. The portal holds the final ESE mark, so the note on each graced paper says to add the grace to E1, or to TEB after a third evaluation. Teachers' sheets are not changed.</td></tr>
            <tr><td><b>Supplementary</b></td><td>UG first attempt: the pool less the grace used in the regular exam; if none is left, borderline papers fail. Terminal attempt (UG second, PG and professional first): a fresh full pool.</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Reference() {
  const { me, sid } = useSession();
  const state = useLoad("/reference");
  return (
    <div className="page">
      <div className="page-head"><div><h1>Grading rules</h1><p className="sub muted">The rules results are checked and graded with. Programme rules start from the same defaults the old Programs Table used; every change is kept in the audit trail.</p></div></div>
      <CompletenessRules sid={sid} />
      <GracingRules />
      <Loading state={state}>{d => (
        <>
          <div className="sheet scroll">
            <div className="sheet-head"><h2>Programmes</h2><span className="small muted">Grade-point tables for CIE, ESE and COMB, the pass rule, and the GPA-to-letter table</span></div>
            <table className="ledger">
              <thead><tr><th>Programme</th><th>Pass rule</th><th>CIE</th><th>ESE</th><th>COMB</th><th>Letter grades</th><th /></tr></thead>
              <tbody>{d.programmes.map(p => <ProgrammeRow key={p.code} p={p} canEdit={me.role === "admin"} onSaved={state.reload} />)}</tbody>
            </table>
          </div>
          <div className="row" style={{ alignItems: "start", marginTop: 20, gap: 20 }}>
            {Object.entries(d.npTables).map(([code, rows]) => (
              <div className="sheet" key={code} style={{ flex: "1 1 220px" }}>
                <div className="sheet-head"><h3>Grade points, table {code}</h3></div>
                <table className="ledger small"><thead><tr><th>From</th><th className="num">Points</th></tr></thead>
                  <tbody>{rows.map(r => <tr key={r.ll}><td>{r.ll}%</td><td className="num">{r.np === "Fails" ? "Fail" : r.np}</td></tr>)}</tbody></table>
              </div>
            ))}
            {Object.entries(d.gradeTables).map(([code, rows]) => (
              <div className="sheet" key={code} style={{ flex: "1 1 260px" }}>
                <div className="sheet-head"><h3>Letter grades, table {code}</h3></div>
                <table className="ledger small"><thead><tr><th>GPA</th><th>Grade</th></tr></thead>
                  <tbody>{rows.map(r => <tr key={r.ll}><td>{r.ll} to {r.ul}</td><td>{r.lg}, {r.qa}</td></tr>)}</tbody></table>
              </div>
            ))}
          </div>
        </>
      )}</Loading>
    </div>
  );
}
