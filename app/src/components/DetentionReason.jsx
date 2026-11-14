import { useState } from "react";
import { api, enc } from "../api.js";
import { useAction, fmtWhen } from "./ui.jsx";

// The office's reason a student is detained: shown, and editable by operators and admins.
export default function DetentionReason({ sid, regdNo, value, canEdit, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value?.reason || "");
  const [busy, run] = useAction();
  const save = async () => {
    if (await run(() => api.put(`/sessions/${enc(sid)}/students/${enc(regdNo)}/detention`, { reason: text }), "Reason saved")) { setEditing(false); onSaved?.(); }
  };
  const remove = async () => {
    if (await run(() => api.del(`/sessions/${enc(sid)}/students/${enc(regdNo)}/detention`), "Reason removed")) { setEditing(false); setText(""); onSaved?.(); }
  };
  if (editing) {
    return (
      <div className="dr-edit">
        <input autoFocus value={text} maxLength={500} onChange={e => setText(e.target.value)} placeholder="e.g. Shortage of attendance in Sem III, 2025"
          onKeyDown={e => { if (e.key === "Enter" && text.trim()) save(); if (e.key === "Escape") setEditing(false); }} aria-label={`Detention reason for ${regdNo}`} />
        <button className="btn small primary" disabled={busy || !text.trim()} onClick={save}>Save</button>
        {value && <button className="btn small quiet" disabled={busy} onClick={remove}>Remove</button>}
        <button className="btn small quiet" onClick={() => setEditing(false)}>Cancel</button>
      </div>
    );
  }
  return (
    <div className="dr">
      <span className="dr-label">Reason recorded:</span>{" "}
      {value ? <><b>{value.reason}</b> <span className="muted">({value.by}, {fmtWhen(value.at)})</span></> : <span className="muted">none yet</span>}
      {canEdit && <button className="link-btn dr-btn" onClick={() => { setText(value?.reason || ""); setEditing(true); }}>{value ? "Edit" : "Add reason"}</button>}
    </div>
  );
}
