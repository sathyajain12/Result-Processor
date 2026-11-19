import { useState } from "react";
import { Link } from "react-router-dom";
import { api, enc } from "../api.js";
import { useSession, useLoad, Loading, useAction, fmtGpa, fmtWhen } from "../components/ui.jsx";

const ACTIONS = {
  compute: "Recomputed results", sync: "Synced sheets", import: "Uploaded a file", approve: "Approved results", revoke: "Withdrew approval",
  publish: "Published results", override: "Added an override", "revoke-override": "Revoked an override", "configure-source": "Linked a sheet",
  "create-session": "Created the session", "edit-programme": "Edited programme rules", "set-role": "Changed a role",
  "print-register": "Printed the Grade register"
};

function describe(a) {
  const d = a.detail || {};
  if (a.action === "compute") return `${d.releasable} of ${d.students} ready, ${d.blocking} blocking issues`;
  if (a.action === "approve" || a.action === "revoke") return `${d.count} in ${a.entity}${d.note ? `: ${d.note}` : ""}`;
  if (a.action === "publish") return `${d.count} results${d.corrections ? `, ${d.corrections} corrections` : ""}`;
  if (a.action === "override") return `${a.entity}${d.regdNo ? ` for ${d.regdNo}` : ""}${d.paperCode ? ` ${d.paperCode}` : ""}: ${d.reason}`;
  if (a.action === "sync") return (d || []).map(s => `${s.kind} ${s.error ? "failed" : s.detail}`).join("; ");
  if (a.action === "import") return `${a.entity}: ${d.detail}${d.file ? ` from ${d.file}` : ""}`;
  if (a.action === "print-register") return `${a.entity}: ${d.count} student${d.count === 1 ? "" : "s"}${d.q ? `, search "${d.q}"` : ""}`;
  return a.entity || "";
}

export default function History() {
  const { sid } = useSession();
  const runs = useLoad(`/sessions/${enc(sid)}/runs`);
  const audit = useLoad(`/sessions/${enc(sid)}/audit`);
  const [diff, setDiff] = useState(null);
  const [busy, run] = useAction();

  const compare = r => run(() => api.get(`/sessions/${enc(sid)}/runs/${r.id}`)).then(d => d && setDiff({ ...d, at: r.startedAt }));

  return (
    <div className="page">
      <div className="page-head"><div><h1>Runs and audit</h1><p className="sub muted">Every computation is kept, so you can see exactly whose result changed between two runs and why.</p></div></div>
      <div className="two-col">
        <div>
          <div className="sheet">
            <div className="sheet-head"><h2>Runs</h2></div>
            <Loading state={runs}>{rows => (
              <table className="ledger">
                <thead><tr><th>When</th><th>By</th><th className="num">Ready</th><th className="num">Pending</th><th className="num">Blocking</th><th /></tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.id}>
                      <td>{fmtWhen(r.startedAt)}{r.status === "failed" && <span className="small" style={{ color: "var(--seal)" }}> failed: {r.summary?.error}</span>}</td>
                      <td className="muted small">{r.by}</td>
                      <td className="num">{r.summary?.releasable ?? ""}</td>
                      <td className="num">{r.summary?.held ?? ""}</td>
                      <td className="num">{r.summary?.blocking ?? ""}</td>
                      <td className="num">{r.status === "done" && i < rows.length - 1 && <button className="btn quiet" disabled={busy} onClick={() => compare(r)}>What changed</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}</Loading>
          </div>

          {diff && (
            <div className="sheet">
              <div className="sheet-head"><h2>Changed in the run of {fmtWhen(diff.at)}</h2><button className="btn quiet" onClick={() => setDiff(null)}>Close</button></div>
              {diff.changes.length === 0 && <div className="empty">No student's result changed in this run.</div>}
              <table className="ledger">
                <tbody>
                  {diff.changes.slice(0, 300).map(c => (
                    <tr key={c.regdNo}>
                      <td><Link to={`/s/${sid}/students/${c.regdNo}`}>{c.regdNo}</Link> <span className="muted">{c.name}</span></td>
                      <td className="muted small">{c.batchKey.split("|").slice(0, 2).join(" Sem ")}</td>
                      <td>{c.before ? `${fmtGpa(c.before.gpa)} ${c.before.letterGrade || ""}${c.before.releasable ? "" : " (pending)"}` : "new"}</td>
                      <td>to {fmtGpa(c.after.gpa)} {c.after.letterGrade || ""}{c.after.releasable ? "" : " (pending)"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="sheet">
          <div className="sheet-head"><h2>Audit trail</h2></div>
          <Loading state={audit}>{rows => (
            <div className="pad timeline">
              {rows.map(a => <div key={a.id}><b>{ACTIONS[a.action] || a.action}</b><br /><span className="small">{describe(a)}</span><br /><span className="small muted">{a.actor}, {fmtWhen(a.at)}</span></div>)}
            </div>
          )}</Loading>
        </div>
      </div>
    </div>
  );
}
