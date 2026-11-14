import { useEffect, useRef, useState } from "react";
import { api, enc } from "../api.js";
import { useAction, fmtWhen } from "./ui.jsx";
import { Icon } from "./icons.jsx";
import { compute } from "../lib/compute.js";

// Edits on the student page are overrides: each needs a reason, is audited, survives the next sync,
// and the result is recomputed straight away.
export function useEdits(sid, reload) {
  const [busy, run] = useAction();
  const recompute = async () => compute(sid);   // in this browser (lib/compute.js)
  const save = async (edits, reason) => {
    const r = await run(async () => {
      for (const e of edits) await api.post(`/sessions/${enc(sid)}/overrides`, { ...e, reason });
      return recompute();
    }, r => `Saved and recomputed. ${r.releasable} of ${r.students} results ready.`);
    if (r) reload();
    return !!r;
  };
  const revert = async id => {
    const r = await run(async () => { await api.del(`/sessions/${enc(sid)}/overrides/${id}`); return recompute(); }, "Edit reverted to the sheet value and recomputed.");
    if (r) reload();
    return !!r;
  };
  return { busy, save, revert };
}

const shown = v => (v === null || v === undefined || v === "" ? "blank" : v);

// What an edit replaced, for a tooltip and the small line under an editor.
export function editNote(edit) {
  return `Edited by ${edit.by}, ${fmtWhen(edit.at)}: ${edit.reason}. Sheet value: ${shown(edit.sheetValue)}.`;
}

// A small pop-over with one value, a reason and Save. Closes on Escape or a click outside.
export function EditPopover({ label, initial, hint, edit, inputMode, onSave, onRevert, onClose, busy, options, anchor }) {
  const [value, setValue] = useState(initial ?? "");
  const [reason, setReason] = useState("");
  const box = useRef(null);
  useEffect(() => {
    const onKey = e => e.key === "Escape" && onClose();
    // A click on the anchor (the value that opened this) is handled by the anchor itself.
    const inside = e => (anchor?.current || box.current)?.contains(e.target);
    const onDown = e => !inside(e) && onClose();
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => { window.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onDown); };
  }, [onClose, anchor]);
  const changed = String(value).trim() !== String(initial ?? "").trim();
  const submit = async e => { e.preventDefault(); if (await onSave(String(value).trim(), reason.trim())) onClose(); };

  return (
    <form className="edit-pop" ref={box} onSubmit={submit} role="dialog" aria-label={`Edit ${label}`}>
      <label>{label}
        {options
          ? <select value={value} onChange={e => setValue(e.target.value)} autoFocus>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          : <span className="row" style={{ flexWrap: "nowrap" }}><input value={value} onChange={e => setValue(e.target.value)} inputMode={inputMode} autoFocus />{hint && <span className="small muted nowrap">{hint}</span>}</span>}
      </label>
      <label>Reason, kept in the audit trail<input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Re-totalled answer script" /></label>
      {edit && <p className="small muted">{editNote(edit)}</p>}
      <div className="row between">
        <span>{edit && onRevert && <button type="button" className="btn quiet small" disabled={busy} onClick={async () => { if (await onRevert(edit.id)) onClose(); }}>Revert to sheet</button>}</span>
        <span className="row">
          <button type="button" className="btn small" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary small" disabled={busy || !changed || reason.length < 5} title={reason.length < 5 ? "Give a reason (at least 5 characters)" : undefined}>Save</button>
        </span>
      </div>
    </form>
  );
}

// A value that an admin can click to edit. Shows a marker and the sheet value once edited.
export function Editable({ children, label, initial, hint, edit, canEdit, editor, inputMode, options, className = "" }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const content = <>{children}{edit && <span className="edited-dot" title={editNote(edit)} aria-label="edited" />}</>;
  if (!canEdit) return <span className={`editable ${className}`} title={edit ? editNote(edit) : undefined}>{content}</span>;
  return (
    <span className={`editable can ${className}`} ref={wrap}>
      <button type="button" className="edit-trigger" onClick={() => setOpen(o => !o)} title={edit ? editNote(edit) : `Edit ${label}`}>
        {content}<Icon name="edit" size={12} className="edit-icon" />
      </button>
      {open && <EditPopover label={label} initial={initial} hint={hint} edit={edit} inputMode={inputMode} options={options} busy={editor.busy}
        onSave={editor.onSave} onRevert={editor.onRevert} onClose={() => setOpen(false)} anchor={wrap} />}
    </span>
  );
}

const CALC = [["1", "CIE from components"], ["2", "CIE + ESE"], ["3", "CIE only"], ["4", "ESE only"]];
const PASS = [["1", "COMB 40%"], ["2", "COMB 50%"], ["3", "ESE 50% and COMB 50%"]];
export const COURSE_FIELDS = [
  ["credits", "Credits"], ["cieMax", "CIE maximum"], ["eseMax", "ESE maximum"], ["calcType", "Exam type", CALC],
  ["cieWeight", "CIE weight %", null, 100], ["eseWeight", "ESE weight %", null, 100], ["passCategory", "Pass rule", PASS]
];

// All course values for one paper at once: only the changed fields are saved, with one reason.
export function CourseEditor({ paper, edits, editor, onClose }) {
  // Start from this student's current value: their edit if there is one, otherwise the CMF value.
  const start = Object.fromEntries(COURSE_FIELDS.map(([k, , , scale]) => {
    const ed = edits[`course|${paper.paperCode}|${k}`];
    const v = ed ? Number(ed.value) : paper.course?.[k];
    return [k, v === null || v === undefined ? "" : String(scale ? Math.round(v * scale * 100) / 100 : v)];
  }));
  const [form, setForm] = useState(start);
  const [reason, setReason] = useState("");
  const changed = COURSE_FIELDS.filter(([k]) => form[k].trim() !== start[k]);
  const save = async e => {
    e.preventDefault();
    const list = changed.map(([k, , , scale]) => ({ type: "course-field", regdNo: editor.regdNo, paperCode: paper.paperCode, field: k,
      value: scale ? Number(form[k]) / scale : Number(form[k]) }));
    if (await editor.save(list, reason.trim())) onClose();
  };
  return (
    <form className="course-edit" onSubmit={save}>
      <div className="row between"><b>Course values for {paper.paperCode}, this student only</b><button type="button" className="btn quiet small" onClick={onClose}>Close</button></div>
      <div className="course-grid">
        {COURSE_FIELDS.map(([k, label, options]) => {
          const ed = edits[`course|${paper.paperCode}|${k}`];
          return (
            <label key={k}><span>{label}{ed && <span className="edited-dot" title={editNote(ed)} />}</span>
              {options
                ? <select value={form[k]} onChange={e => setForm({ ...form, [k]: e.target.value })}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                : <input value={form[k]} inputMode="decimal" onChange={e => setForm({ ...form, [k]: e.target.value })} />}
              {ed && <button type="button" className="btn quiet small revert" disabled={editor.busy} onClick={() => editor.revert(ed.id)}>Revert</button>}
            </label>
          );
        })}
      </div>
      <label>Reason, kept in the audit trail<input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. ESE conducted out of 200 as per BoS note" /></label>
      <div className="row between">
        <span className="small muted">{changed.length ? `Changing ${changed.map(c => c[1]).join(", ")}` : "Change a value to save"}</span>
        <button type="submit" className="btn primary small" disabled={editor.busy || !changed.length || reason.trim().length < 5}>Save and recompute</button>
      </div>
    </form>
  );
}
