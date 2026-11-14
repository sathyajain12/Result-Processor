import { useState } from "react";
import { api, enc } from "../api.js";
import { Modal, useAction } from "./ui.jsx";
import { compute } from "../lib/compute.js";

const TITLES = {
  accept: "Accept this issue",
  "skip-validation": "Skip validation for this paper",
  "exclude-paper": "Leave this paper out for everyone",
  "exclude-student": "Leave this student out of results",
  "student-batch": "Use another batch's course list",
  "course-field": "Change a course value for this student"
};
const HELP = {
  accept: "The issue stays on record as accepted and no longer keeps the result pending. Results are recomputed straight away.",
  "skip-validation": "The paper is still graded, but marks checks (missing, too low, above maximum) are not applied. Use for externally conducted papers such as SWAYAM portal exams.",
  "exclude-paper": "The paper is dropped from every student's result, so it does not count towards credits or GPA.",
  "exclude-student": "The student gets no result in this session until the override is revoked.",
  "student-batch": "Expected courses come from the CMF entries for the chosen batch — for detained students.",
  "course-field": "Applies to this student and paper only. Replaces the hand-typed edits that used to be made in the sheet."
};
const FIELDS = [["cieMax", "CIE maximum"], ["eseMax", "ESE maximum"], ["credits", "Credits"], ["calcType", "Calculation type"], ["cieWeight", "CIE weight (0–1)"], ["eseWeight", "ESE weight (0–1)"]];

export default function OverrideDialog({ sessionId, preset, onClose, onDone }) {
  const [form, setForm] = useState({ reason: "", field: "eseMax", value: "", ...preset });
  const [busy, run] = useAction();
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    const r = await run(async () => {
      const saved = await api.post(`/sessions/${enc(sessionId)}/overrides`, form);
      const computed = await compute(sessionId);   // in this browser (lib/compute.js)
      return { ...saved, computed };
    }, r => `${form.type === "accept" ? "Issue accepted" : "Override saved"}. ${r.computed.releasable} of ${r.computed.students} results now ready.`);
    if (r) { onDone?.(r); onClose(); }
  };

  return (
    <Modal title={TITLES[form.type]} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy || form.reason.trim().length < 5} onClick={submit}>Save override</button>
    </>}>
      <p className="muted small">{HELP[form.type]}</p>
      <p className="small">
        {[form.regdNo && `Student ${form.regdNo}`, form.paperCode && `paper ${form.paperCode}`, form.code && `issue ${form.code}`].filter(Boolean).join(", ")}
      </p>
      {form.type === "course-field" && (
        <div className="row">
          <label>Field<select value={form.field} onChange={set("field")}>{FIELDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label>New value<input value={form.value} onChange={set("value")} inputMode="decimal" /></label>
        </div>
      )}
      {form.type === "student-batch" && <label>Batch to use<input value={form.value} onChange={set("value")} placeholder="e.g. 2024" /></label>}
      <label>Reason, recorded in the audit trail<textarea value={form.reason} onChange={set("reason")} autoFocus placeholder="e.g. ESE conducted out of 200 as per Board of Studies note dated 12 March" /></label>
    </Modal>
  );
}
