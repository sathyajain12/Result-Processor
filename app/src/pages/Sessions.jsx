import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, enc } from "../api.js";
import { useAction, useLoad, EmptyState, Skeleton, StateStrip, fmtWhen } from "../components/ui.jsx";
import { Icon } from "../components/icons.jsx";

// Sessions grouped by examination cycle, newest cycle first; sessions without a cycle come last.
export function groupByCycle(sessions, cycles) {
  const groups = cycles.map(c => ({ ...c, sessions: sessions.filter(s => s.cycleId === c.id) }));
  const loose = sessions.filter(s => !s.cycleId || !cycles.some(c => c.id === s.cycleId));
  if (loose.length) groups.push({ id: null, name: "Not in a cycle", sessions: loose });
  return groups;
}

function CycleHead({ group, isAdmin, onChanged, onAddSession }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(group.name);
  const [busy, run] = useAction();

  const rename = async () => {
    if (await run(() => api.put(`/cycles/${enc(group.id)}`, { name }), "Cycle renamed")) { setEditing(false); onChanged(); }
  };
  const remove = async () => {
    if (!confirm(`Delete the cycle "${group.name}"?`)) return;
    if (await run(() => api.del(`/cycles/${enc(group.id)}`), "Cycle deleted")) onChanged();
  };

  if (editing) return (
    <div className="sheet-head">
      <div className="row">
        <input value={name} onChange={e => setName(e.target.value)} aria-label="Cycle name" autoFocus
          onKeyDown={e => { if (e.key === "Enter" && name.trim().length >= 3) rename(); if (e.key === "Escape") setEditing(false); }} />
        <button className="btn primary" disabled={busy || name.trim().length < 3} onClick={rename}>Save</button>
        <button className="btn quiet" onClick={() => { setName(group.name); setEditing(false); }}>Cancel</button>
      </div>
    </div>
  );
  return (
    <div className="sheet-head">
      <div><h2>{group.id ? <Link to={`/cycles/${group.id}`}>{group.name}</Link> : group.name}</h2><span className="muted small">{group.sessions.length} session{group.sessions.length === 1 ? "" : "s"}</span></div>
      {isAdmin && group.id && (
        <div className="row">
          <button className="btn small" onClick={() => onAddSession(group.id)}>Add session</button>
          <button className="btn small" onClick={() => setEditing(true)}>Rename</button>
          {group.sessions.length === 0 && <button className="btn small danger" disabled={busy} onClick={remove}>Delete</button>}
        </div>
      )}
    </div>
  );
}

// Where a session stands, from its latest compute and how many results are approved.
function sessionStage(s) {
  const sum = s.summary;
  if (!sum) return { stage: "Not computed", cls: "Collecting" };
  if (sum.blocking > 0) return { stage: `${sum.blocking} blocking issue${sum.blocking === 1 ? "" : "s"}`, cls: "Blocked" };
  if (sum.releasable > 0 && s.approved >= sum.releasable && !sum.held) return { stage: "Approved", cls: "Approved" };
  if (s.approved > 0) return { stage: "Partly approved", cls: "Under-review" };
  if (sum.releasable > 0) return { stage: "Under review", cls: "Under-review" };
  return { stage: "Collecting marks", cls: "Collecting" };
}

function RowMenu({ s, cycles, locked, busy, onRename, onToggleLock, onMove }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = e => box.current && !box.current.contains(e.target) && setOpen(false);
    const esc = e => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); window.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div className="menu" ref={box}>
      <button className="btn quiet icon-only" aria-label={`Actions for ${s.name}`} aria-expanded={open} onClick={() => setOpen(o => !o)}><Icon name="more" size={18} /></button>
      {open && (
        <div className="menu-pop" role="menu">
          <Link role="menuitem" to={`/s/${s.id}`}><Icon name="open" />Open</Link>
          <button role="menuitem" onClick={() => { setOpen(false); onRename(); }}><Icon name="edit" />Rename</button>
          <button role="menuitem" disabled={busy} onClick={() => { setOpen(false); onToggleLock(); }}><Icon name={locked ? "unlock" : "lock"} />{locked ? "Unlock" : "Lock"}</button>
          <label className="menu-field"><span><Icon name="move" />Move to cycle</span>
            <select value={s.cycleId || ""} disabled={busy} onChange={e => { setOpen(false); onMove(e.target.value); }}>
              <option value="">No cycle</option>
              {cycles.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        </div>
      )}
    </div>
  );
}

function SessionRow({ s, cycles, isAdmin, onChanged }) {
  const [busy, run] = useAction();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(s.name);
  const locked = s.status === "closed";
  const sum = s.summary;
  const { stage, cls } = sessionStage(s);

  const move = async cycleId => {
    if (await run(() => api.put(`/sessions/${enc(s.id)}`, { cycleId: cycleId || null }), "Session moved")) onChanged();
  };
  const rename = async () => {
    if (await run(() => api.put(`/sessions/${enc(s.id)}`, { name: name.trim() }), "Session renamed")) { setRenaming(false); onChanged(); }
  };
  const toggleLock = async () => {
    const reason = locked ? "" : prompt(`Lock "${s.name}"? Marks, edits, overrides and approvals will be blocked until it is unlocked.\n\nReason (optional):`, "");
    if (reason === null) return;
    if (await run(() => api.post(`/sessions/${enc(s.id)}/lock`, { locked: !locked, reason }), locked ? "Session unlocked" : "Session locked")) onChanged();
  };
  const ready = sum ? Math.max(0, sum.releasable - s.approved) : 0;

  return (
    <div className={`session-row ${locked ? "is-locked" : ""}`}>
      <div className="session-name">
        {renaming ? (
          <form className="row" onSubmit={e => { e.preventDefault(); if (name.trim().length >= 3) rename(); }}>
            <input value={name} onChange={e => setName(e.target.value)} aria-label="Session name" autoFocus
              onKeyDown={e => { if (e.key === "Escape") { setName(s.name); setRenaming(false); } }} />
            <button className="btn primary small" disabled={busy || name.trim().length < 3 || name.trim() === s.name}>Save</button>
            <button type="button" className="btn small" onClick={() => { setName(s.name); setRenaming(false); }}>Cancel</button>
          </form>
        ) : (
          <>
            <Link className="session-title" to={`/s/${s.id}`}>{s.name}</Link>
            <div className="session-meta">
              <span className={`kind ${s.kind === "supplementary" ? "supp" : ""}`}>{s.kind === "supplementary" ? "Supplementary" : "Regular"}</span>
              {s.kind === "supplementary" && s.baseSessionId && <span className="small muted">of <Link to={`/s/${s.baseSessionId}`}>{s.baseSessionName}</Link></span>}
              {locked && <span className="tag lock"><Icon name="lock" size={11} />Locked</span>}
            </div>
          </>
        )}
      </div>
      <div><span className={`stage ${cls}`}>{stage}</span></div>
      <div className="session-progress">
        {sum ? (
          <>
            <StateStrip counts={{ approved: Math.min(s.approved, sum.students), ready, held: sum.held, withheld: sum.withheld }} total={sum.students} />
            <span className="small muted">{s.approved.toLocaleString()} approved, {sum.releasable.toLocaleString()} of {sum.students.toLocaleString()} ready</span>
          </>
        ) : <span className="small faint">No results yet</span>}
      </div>
      <div className="small muted nowrap" title={s.lastRunAt ? `Last computed ${fmtWhen(s.lastRunAt)}` : "Never computed"}>{s.lastRunAt ? fmtWhen(s.lastRunAt) : "—"}</div>
      <div className="session-actions">
        {isAdmin && !renaming && <RowMenu s={s} cycles={cycles} locked={locked} busy={busy} onRename={() => setRenaming(true)} onToggleLock={toggleLock} onMove={move} />}
      </div>
    </div>
  );
}

export default function Sessions({ me, sessions, reload }) {
  const cycles = useLoad("/cycles");
  const isAdmin = me.role === "admin";
  const [cycleName, setCycleName] = useState("");
  const [name, setName] = useState("");
  const [cycleId, setCycleId] = useState(null);
  const [copyFrom, setCopyFrom] = useState(sessions[0]?.id || "");
  const [kind, setKind] = useState("regular");
  const [baseId, setBaseId] = useState("");
  const [busy, run] = useAction();
  const nav = useNavigate();

  const cycleList = cycles.data || [];
  const targetCycle = cycleId ?? cycleList[0]?.id ?? "";
  // Regular sessions a supplementary can build on, same cycle first.
  const bases = sessions.filter(s => s.kind !== "supplementary")
    .sort((a, b) => (b.cycleId === targetCycle) - (a.cycleId === targetCycle));
  const targetBase = baseId || bases[0]?.id || "";
  const refresh = () => Promise.all([reload(), cycles.reload()]);

  const createCycle = async () => {
    const r = await run(() => api.post("/cycles", { name: cycleName }), "Cycle created");
    if (r) { setCycleName(""); setCycleId(r.id); await cycles.reload(); }
  };
  const createSession = async () => {
    const r = await run(() => api.post("/sessions", {
      name, cycleId: targetCycle || undefined, copySourcesFrom: copyFrom || undefined,
      kind, baseSessionId: kind === "supplementary" ? targetBase : undefined
    }), "Session created");
    if (r) { await refresh(); nav(`/s/${r.id}/sources`); }
  };
  const addSessionTo = id => {
    setCycleId(id);
    document.getElementById("new-session")?.scrollIntoView({ behavior: "smooth" });
  };

  if (cycles.error) return <div className="page"><div className="notice red">{cycles.error.message}</div></div>;
  if (!cycles.data) return <div className="page" style={{ maxWidth: 920, margin: "0 auto" }}><Skeleton /></div>;

  const groups = groupByCycle(sessions, cycleList);

  return (
    <div className="page" style={{ maxWidth: 1080, margin: "0 auto" }}>
      <div className="page-head"><div><h1>Exam sessions</h1><p className="sub muted">Sessions are grouped by examination cycle. Each session is still processed separately.</p></div></div>

      {groups.length === 0 && <div className="sheet"><EmptyState icon="cycles" title="No cycles or sessions yet">Create an examination cycle below, then add sessions to it.</EmptyState></div>}

      {groups.map(g => (
        <div className="sheet" key={g.id ?? "loose"}>
          <CycleHead group={g} isAdmin={isAdmin} onChanged={refresh} onAddSession={addSessionTo} />
          {g.sessions.length === 0
            ? <div className="empty">No sessions in this cycle yet.</div>
            : (
              <div className="session-list">
                <div className="session-row head" aria-hidden="true"><span>Session</span><span>Status</span><span>Results</span><span>Computed</span><span /></div>
                {g.sessions.map(s => <SessionRow key={s.id} s={s} cycles={cycleList} isAdmin={isAdmin} onChanged={refresh} />)}
              </div>
            )}
        </div>
      ))}

      {isAdmin && (
        <>
          <div className="sheet pad" style={{ marginTop: 20 }}>
            <h2>New examination cycle</h2>
            <div className="row" style={{ marginTop: 12, alignItems: "end" }}>
              <label>Name<input value={cycleName} onChange={e => setCycleName(e.target.value)} placeholder="April 2026" /></label>
              <button className="btn primary" disabled={busy || cycleName.trim().length < 3} onClick={createCycle}>Create cycle</button>
            </div>
          </div>
          <div className="sheet pad" id="new-session">
            <h2>New session</h2>
            <div className="row" style={{ marginTop: 12, alignItems: "end" }}>
              <label>Cycle
                <select value={targetCycle} onChange={e => setCycleId(e.target.value)}>
                  {cycleList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  <option value="">No cycle</option>
                </select>
              </label>
              <label>Type
                <select value={kind} onChange={e => setKind(e.target.value)}>
                  <option value="regular">Regular</option>
                  <option value="supplementary" disabled={!bases.length}>Supplementary</option>
                </select>
              </label>
              {kind === "supplementary" && (
                <label>Builds on
                  <select value={targetBase} onChange={e => setBaseId(e.target.value)}>
                    {bases.map(s => <option key={s.id} value={s.id}>{s.cycleName ? `${s.name} (${s.cycleName})` : s.name}</option>)}
                  </select>
                </label>
              )}
              <label>Name<input value={name} onChange={e => setName(e.target.value)} placeholder={kind === "supplementary" ? "Supplementary" : "ESE Regular"} /></label>
              {sessions.length > 0 && (
                <label>Reuse sheet links from
                  <select value={copyFrom} onChange={e => setCopyFrom(e.target.value)}>
                    <option value="">Don't reuse</option>
                    {sessions.map(s => <option key={s.id} value={s.id}>{s.cycleName ? `${s.name} (${s.cycleName})` : s.name}</option>)}
                  </select>
                </label>
              )}
              <button className="btn primary" disabled={busy || name.trim().length < 3 || (kind === "supplementary" && !targetBase)} onClick={createSession}>Create session</button>
            </div>
            {kind === "supplementary" && <p className="small muted" style={{ marginTop: 10 }}>Load the supplementary CMF, SMF, CIE and ESE as usual. Each student's approved result in the base session is taken as it stands, the papers they re-appeared for are replaced by the new attempt, and the new result is approved here. The base session is not changed.</p>}
          </div>
        </>
      )}
    </div>
  );
}
