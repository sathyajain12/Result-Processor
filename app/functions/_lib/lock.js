import { first } from "./db.js";
import { HttpError } from "./http.js";

// Every session-scoped route lives under /api/sessions/:sid/ so the [sid]/_middleware.js guard covers it.
// These are the only writes allowed while a session is locked.
export function isAllowedWhenLocked(method, pathname) {
  const rest = pathname.replace(/^\/api\/sessions\/[^/]+/, "").replace(/\/$/, "");
  if (method === "GET" || method === "HEAD") return true;
  if (method === "PUT" && rest === "") return true;       // move between cycles
  if (method === "POST" && rest === "/lock") return true; // lock / unlock
  if (method === "POST" && rest === "/register/printed") return true; // a record that the Grade register was printed
  return false;
}

export async function assertOpen(db, sessionId) {
  const s = await first(db, "SELECT status, closed_by, closed_at FROM exam_sessions WHERE id = ?", sessionId);
  if (s?.status === "closed") throw new HttpError(409, `Session is locked (by ${s.closed_by} on ${s.closed_at}). Unlock it to make changes.`);
}
