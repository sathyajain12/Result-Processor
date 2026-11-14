import { all } from "./db.js";

export async function approvalMap(db, sessionId) {
  const rows = await all(db, "SELECT * FROM approvals WHERE session_id = ? ORDER BY id", sessionId);
  const map = new Map();
  for (const a of rows) {
    for (const s of JSON.parse(a.regd_nos || "[]")) {
      if (a.action === "approve") map.set(s.regdNo, { digest: s.digest, runId: a.run_id, by: a.created_by, at: a.created_at });
      else map.delete(s.regdNo);
    }
  }
  return map;
}

// Where one student's result stands. Approval is the final step: a result whose marks or rules changed after
// approval comes back as "changed" and needs approving again.
export function studentStatus(row, approval) {
  if (row.state === "Withheld") return "withheld";
  if (!row.releasable) return "held";
  if (approval && approval.digest === row.digest) return "approved";
  if (approval) return "changed";
  return "ready";
}

export function batchStage(c) {
  if (c.blocked) return "Blocked";
  if (c.students === 0) return "Empty";
  const releasable = c.ready + c.approved + c.changed;
  if (releasable === 0) return "Collecting";
  if (c.approved === releasable && c.held === 0) return "Approved";
  if (c.approved > 0 && c.ready === 0 && c.changed === 0) return "Approved (partial)";
  return "Under review";
}

export function tally(rows, approvals) {
  const c = { ready: 0, approved: 0, changed: 0, held: 0, withheld: 0 };
  for (const r of rows) c[studentStatus(r, approvals.get(r.regd_no))]++;
  return c;
}
