import { useState } from "react";
import { api } from "../api.js";
import { useLoad, Loading, useAction, Modal, useSession, fmtWhen } from "../components/ui.jsx";
import { TABS } from "../../shared/tabs.js";

const ROLES = {
  admin: "Links sheets, approves results, edits grading rules and student results",
  operator: "Syncs sheets, recomputes, accepts issues",
  viewer: "Looks at results and issues"
};
const GROUPS = [...new Set(TABS.map(t => t.group))];
const tabSummary = u => (u.role === "admin" ? "Every tab (admin)" : !Array.isArray(u.tabs) ? "Every tab"
  : u.tabs.length === 0 ? "No tabs" : u.tabs.length <= 3 ? TABS.filter(t => u.tabs.includes(t.key)).map(t => t.label).join(", ") : `${u.tabs.length} of ${TABS.length} tabs`);

// Which tabs one person may open. The role still decides what they may do on those tabs.
function TabsDialog({ user, onClose, onSave, busy }) {
  const [all, setAll] = useState(!Array.isArray(user.tabs));
  const [picked, setPicked] = useState(new Set(Array.isArray(user.tabs) ? user.tabs : TABS.map(t => t.key)));
  const toggle = k => setPicked(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const setGroup = (g, on) => setPicked(s => { const n = new Set(s); for (const t of TABS.filter(t => t.group === g)) { if (on) n.add(t.key); else n.delete(t.key); } return n; });
  return (
    <Modal title={`Tabs for ${user.email}`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy || (!all && picked.size === 0)} onClick={() => onSave(all ? null : TABS.map(t => t.key).filter(k => picked.has(k)))}>Save</button>
    </>}>
      <p className="small muted">The person sees only these tabs in the menu, and the portal refuses the others' data. Their role ({user.role}) still decides what they can do there.</p>
      <div className="tab-access">
        <label className="check"><input type="radio" checked={all} onChange={() => setAll(true)} /><span><b>Every tab</b>, including ones added later</span></label>
        <label className="check"><input type="radio" checked={!all} onChange={() => setAll(false)} /><span><b>Only these tabs:</b></span></label>
        <div className={`tab-groups${all ? " off" : ""}`}>
          {GROUPS.map(g => {
            const tabs = TABS.filter(t => t.group === g);
            const on = tabs.every(t => picked.has(t.key));
            return (
              <fieldset key={g} disabled={all}>
                <legend><label className="check"><input type="checkbox" checked={on} onChange={e => setGroup(g, e.target.checked)} /><span>{g}</span></label></legend>
                {tabs.map(t => (
                  <label key={t.key} className="check"><input type="checkbox" checked={picked.has(t.key)} onChange={() => toggle(t.key)} /><span>{t.label}{t.note && <span className="small muted"> ({t.note})</span>}</span></label>
                ))}
              </fieldset>
            );
          })}
        </div>
        {!all && picked.size === 0 && <p className="small" style={{ color: "var(--seal)" }}>Pick at least one tab.</p>}
      </div>
    </Modal>
  );
}

export default function Users() {
  const state = useLoad("/users");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("operator");
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [busy, run] = useAction();
  const { me } = useSession();
  // Remove (or restore) a person's access: a removed person is refused at sign-in and on every request, at once.
  const setAccess = async (u, access) => {
    const ok = await run(() => api.put("/users", { email: u.email, access }), access ? `${u.email} can use the portal again` : `Access removed for ${u.email}`);
    if (ok) { setRemoving(null); setEmail(""); state.reload(); }
  };
  const save = async (e, r) => {
    const ok = await run(() => api.put("/users", { email: e, role: r }), `${e} is now ${r}`);
    if (ok) { setEmail(""); state.reload(); }
  };
  const saveTabs = async (u, tabs) => {
    const ok = await run(() => api.put("/users", { email: u.email, role: u.role, tabs }),
      `${u.email} can now open ${tabs === null ? "every tab" : `${tabs.length} tab${tabs.length === 1 ? "" : "s"}`}`);
    if (ok) { setEditing(null); state.reload(); }
  };
  return (
    <div className="page" style={{ maxWidth: 1000 }}>
      <div className="page-head"><div><h1>People</h1><p className="sub muted">Only the people listed here can sign in, with their institute Google account; anyone else is turned away. Someone you add can open every tab until you choose otherwise. The role decides what a person can do; Tabs decides which parts of the portal they can open.</p></div></div>
      <div className="sheet pad" style={{ marginBottom: 20 }}>
        <div className="row" style={{ alignItems: "end" }}>
          <label style={{ flex: 1 }}>Email<input value={email} onChange={e => setEmail(e.target.value)} placeholder="name@sssihl.edu.in" /></label>
          <label>Role<select value={role} onChange={e => setRole(e.target.value)}>{Object.keys(ROLES).map(r => <option key={r}>{r}</option>)}</select></label>
          <button className="btn primary" disabled={busy || !email.includes("@")} onClick={() => save(email, role)}>Add person</button>
        </div>
        <p className="small muted" style={{ marginTop: 8 }}>{ROLES[role]}. Choose their tabs after adding them.</p>
      </div>
      <div className="sheet">
        <Loading state={state}>{rows => (
          <div className="scroll">
            <table className="ledger">
              <thead><tr><th>Email</th><th>Role</th><th>Tabs</th><th /></tr></thead>
              <tbody>{rows.filter(u => !u.removedAt).map(u => (
                <tr key={u.email}>
                  <td>{u.email}{u.email === me.email && <span className="small muted"> (you)</span>}</td>
                  <td><select value={u.role} onChange={e => save(u.email, e.target.value)} aria-label={`Role for ${u.email}`}>{Object.keys(ROLES).map(r => <option key={r}>{r}</option>)}</select></td>
                  <td className={Array.isArray(u.tabs) && u.role !== "admin" ? "" : "muted"}>{tabSummary(u)}</td>
                  <td className="num nowrap">
                    {u.role !== "admin" && <button className="btn quiet small" disabled={busy} onClick={() => setEditing(u)}>Choose tabs</button>}
                    {u.email !== me.email && <button className="btn quiet small danger-text" disabled={busy} onClick={() => setRemoving(u)}>Remove access</button>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}</Loading>
      </div>
      {state.data?.some(u => u.removedAt) && (
        <div className="sheet" style={{ marginTop: 20 }}>
          <div className="sheet-head"><div><h2>Access removed</h2><span className="small muted">These people cannot sign in. Restoring gives back the role and tabs they had.</span></div></div>
          <div className="scroll">
            <table className="ledger">
              <thead><tr><th>Email</th><th>Role before</th><th>Removed</th><th /></tr></thead>
              <tbody>{state.data.filter(u => u.removedAt).map(u => (
                <tr key={u.email}>
                  <td>{u.email}</td>
                  <td className="muted">{u.role}</td>
                  <td className="small muted">{fmtWhen(u.removedAt)}{u.removedBy ? ` by ${u.removedBy}` : ""}</td>
                  <td className="num"><button className="btn small" disabled={busy} onClick={() => setAccess(u, true)}>Restore access</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}
      {removing && (
        <Modal title={`Remove access for ${removing.email}?`} onClose={() => setRemoving(null)} footer={<>
          <button className="btn" onClick={() => setRemoving(null)}>Cancel</button>
          <button className="btn danger" disabled={busy} onClick={() => setAccess(removing, false)}>Remove access</button>
        </>}>
          <p>They are shut out of the portal straight away, even if they are signed in now, and cannot sign in again until you restore their access.</p>
          <p className="small muted">Their role ({removing.role}) and tabs are kept for a restore, and what they did stays in the audit log.</p>
        </Modal>
      )}
      {editing && <TabsDialog user={editing} busy={busy} onClose={() => setEditing(null)} onSave={tabs => saveTabs(editing, tabs)} />}
    </div>
  );
}
