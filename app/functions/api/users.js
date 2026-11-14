import { json, readJson, requireFields, HttpError } from "../_lib/http.js";
import { all, run, audit } from "../_lib/db.js";
import { requireRole, TEAMS, parseTeams } from "../_lib/auth.js";
import { parseTabs, TAB_KEYS } from "../../shared/tabs.js";

export async function onRequestGet({ env, data }) {
  requireRole(data.user, "admin");
  const rows = await all(env.DB, "SELECT email, name, role, teams, tabs, created_at AS createdAt, removed_at AS removedAt, removed_by AS removedBy FROM users ORDER BY role, email");
  return json(rows.map(u => ({ ...u, teams: parseTeams(u.teams), tabs: parseTabs(u.tabs) })));
}

export async function onRequestPut({ env, request, data }) {
  requireRole(data.user, "admin");
  const b = await readJson(request);
  // Remove or restore someone's access: { email, access: false | true }. A removed person cannot sign in until restored.
  if ("access" in b) {
    requireFields(b, ["email"]);
    const email = String(b.email).trim().toLowerCase();
    if (!b.access && email === data.user.email) throw new HttpError(400, "You cannot remove your own access");
    if (b.access) {
      await run(env.DB, "UPDATE users SET removed_at = NULL, removed_by = NULL WHERE email = ?", email);
    } else {
      // Someone who has never signed in can be kept out too.
      await run(env.DB, `INSERT INTO users (email, role, removed_at, removed_by) VALUES (?, 'viewer', datetime('now'), ?)
        ON CONFLICT (email) DO UPDATE SET removed_at = datetime('now'), removed_by = excluded.removed_by`, email, data.user.email);
    }
    await audit(env.DB, data.user.email, null, b.access ? "restore-access" : "remove-access", email, {});
    return json({ ok: true });
  }
  requireFields(b, ["email", "role"]);
  if (!["admin", "operator", "viewer"].includes(b.role)) throw new HttpError(400, "Role must be admin, operator or viewer");
  const email = b.email.trim().toLowerCase();
  if (email === data.user.email && b.role !== "admin") throw new HttpError(400, "You cannot remove your own admin role");
  // Teams are optional in the request; when left out, the person's teams stay as they are.
  const teams = Array.isArray(b.teams) ? b.teams.filter(t => TEAMS[t]).join(",") : null;
  // Tabs too: left out, they stay as they are; null, every tab; a list, only those tabs (People page).
  const setTabs = "tabs" in b;
  const tabs = setTabs && Array.isArray(b.tabs) ? JSON.stringify([...new Set(b.tabs.filter(t => TAB_KEYS.has(t)))]) : null;
  await run(env.DB, `INSERT INTO users (email, name, role, teams, tabs) VALUES (?,?,?,COALESCE(?, ''),?)
    ON CONFLICT (email) DO UPDATE SET role = excluded.role, name = COALESCE(excluded.name, users.name), teams = COALESCE(?, users.teams),
      tabs = CASE WHEN ? THEN excluded.tabs ELSE users.tabs END`,
    email, b.name || null, b.role, teams, tabs, teams, setTabs ? 1 : 0);
  await audit(env.DB, data.user.email, null, "set-role", email, { role: b.role, ...(teams !== null ? { teams } : {}), ...(setTabs ? { tabs: tabs ? JSON.parse(tabs) : "all" } : {}) });
  return json({ ok: true });
}
