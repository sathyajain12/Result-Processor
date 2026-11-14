import { HttpError } from "./http.js";
import { first, run } from "./db.js";
import { readSession } from "./session.js";
import { parseTabs } from "../../shared/tabs.js";

const RANK = { viewer: 1, operator: 2, admin: 3 };

// Cloudflare Access signs every request it lets through (Cf-Access-Jwt-Assertion). The email is taken only
// from a token that verifies against the team's keys and this app's audience tag, so a request that reaches
// the app without Access (e.g. a *.pages.dev preview URL) cannot claim to be anyone.
let certCache = { at: 0, keys: null };

async function accessKeys(team) {
  if (certCache.keys && Date.now() - certCache.at < 3600_000) return certCache.keys;
  const res = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new HttpError(503, "Could not load Cloudflare Access keys");
  const { keys } = await res.json();
  certCache = { at: Date.now(), keys };
  return keys;
}

const b64url = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), c => c.charCodeAt(0));

async function accessEmail(request, env) {
  const team = String(env.ACCESS_TEAM_DOMAIN || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!team || !env.ACCESS_AUD) throw new HttpError(401, "Sign-in is not configured yet: set ACCESS_TEAM_DOMAIN and ACCESS_AUD.");
  const cookie = (request.headers.get("cookie") || "").match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  const token = request.headers.get("cf-access-jwt-assertion") || cookie?.[1];
  if (!token) throw new HttpError(401, "Not signed in through Cloudflare Access.");
  const [h, p, sig] = token.split(".");
  try {
    const header = JSON.parse(new TextDecoder().decode(b64url(h)));
    const payload = JSON.parse(new TextDecoder().decode(b64url(p)));
    const jwk = (await accessKeys(team)).find(k => k.kid === header.kid);
    if (!jwk || header.alg !== "RS256") throw new Error("unknown key");
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64url(sig), new TextEncoder().encode(`${h}.${p}`));
    const aud = [].concat(payload.aud || []);
    if (!ok || !aud.includes(env.ACCESS_AUD) || payload.iss !== `https://${team}` || payload.exp * 1000 < Date.now()) throw new Error("invalid");
    return String(payload.email || "");
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(401, "Cloudflare Access sign-in could not be verified. Reload the page to sign in again.");
  }
}

// Who is calling: the DEV_USER_EMAIL locally, else a "Sign in with Google" session, else Cloudflare Access if configured.
async function callerEmail(request, env) {
  if (env.DEV_USER_EMAIL) return request.headers.get("cf-access-authenticated-user-email") || env.DEV_USER_EMAIL;
  const session = await readSession(request, env);
  if (session) return session.email;
  if (env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD) return accessEmail(request, env);
  throw new HttpError(401, "Please sign in with your sssihl.edu.in Google account.", { signIn: true });
}

export async function resolveUser(request, env) {
  const email = (await callerEmail(request, env)).trim().toLowerCase();
  if (!email) throw new HttpError(401, "Not signed in. Put the app behind Cloudflare Access or set DEV_USER_EMAIL for local development.");

  if (env.ALLOWED_DOMAIN && !email.endsWith("@" + env.ALLOWED_DOMAIN.toLowerCase()) && !env.DEV_USER_EMAIL) {
    throw new HttpError(403, `Only ${env.ALLOWED_DOMAIN} accounts can use this app`);
  }

  let user = await first(env.DB, "SELECT email, name, role, teams, tabs, removed_at FROM users WHERE email = ?", email);
  // Access removed on the People page: refused on every request, so it takes effect at once, even mid-session.
  if (user?.removed_at) throw new HttpError(403, "Your access to the Result Processor has been removed. If you need it back, ask the Controller of Examinations' office.", { removed: true, email });
  if (!user) {
    // By invitation only: someone not on the People page is refused, even with an institute account. The exceptions are
    // the ADMIN_EMAILS (added as admins at their first sign-in), the very first person when none are configured, and
    // the local development user.
    const admins = String(env.ADMIN_EMAILS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    const anyUser = await first(env.DB, "SELECT email FROM users LIMIT 1");
    const admin = admins.includes(email) || (!anyUser && !admins.length) || env.DEV_USER_EMAIL === email;
    if (!admin) throw new HttpError(403, "You have not been given access to the Result Processor. Ask the Controller of Examinations' office to add you.", { notInvited: true, email });
    await run(env.DB, "INSERT INTO users (email, role) VALUES (?, 'admin')", email);
    user = { email, name: null, role: "admin", teams: "", tabs: null };
  }
  // tabs: null for every tab (always for an admin), else the tab keys this person may open.
  const { removed_at, ...rest } = user;
  return { ...rest, teams: parseTeams(user.teams), tabs: user.role === "admin" ? null : parseTabs(user.tabs) };
}

// Teams from the old grade register workflow: still stored per person, no longer used for any permission.
export const TEAMS = { results: "Results processing", publishing: "Publishing", checking: "Checking" };
export const parseTeams = v => String(v || "").split(",").map(s => s.trim()).filter(t => TEAMS[t]);

export function requireRole(user, role) {
  if ((RANK[user.role] || 0) < RANK[role]) {
    throw new HttpError(403, `This action needs the ${role} role; you are ${user.role}`);
  }
}
