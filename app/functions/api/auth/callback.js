// Google redirects here with a code. The code is exchanged server-to-server for an ID token, which comes straight
// from Google over TLS, so its claims can be trusted without checking the signature (OpenID Connect §3.1.3.7).
import { cookie, getCookie, signSession, SESSION_COOKIE, SESSION_HOURS } from "../../_lib/session.js";

const fail = message => new Response(
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign-in failed</title>
<body style="font-family:system-ui,sans-serif;max-width:480px;margin:15vh auto;padding:0 16px;line-height:1.5">
<h2>Sign-in failed</h2><p>${message.replace(/</g, "&lt;")}</p><p><a href="/api/auth/login">Try again</a></p></body>`,
  { status: 403, headers: { "content-type": "text/html; charset=utf-8", "set-cookie": cookie("rp_oauth", "", 0) } }
);

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  let saved;
  try { saved = JSON.parse(getCookie(request, "rp_oauth") || "null"); } catch { saved = null; }
  if (url.searchParams.get("error")) return fail(`Google said: ${url.searchParams.get("error")}.`);
  if (!saved || saved.state !== url.searchParams.get("state")) return fail("The sign-in took too long or was started in another tab.");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: url.searchParams.get("code") || "",
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${url.origin}/api/auth/callback`,
      grant_type: "authorization_code"
    })
  });
  const tokens = await res.json().catch(() => ({}));
  if (!res.ok || !tokens.id_token) return fail(`Google did not accept the sign-in (${tokens.error_description || tokens.error || res.status}).`);

  const part = tokens.id_token.split(".")[1];
  const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=")), c => c.charCodeAt(0))));
  const email = String(claims.email || "").toLowerCase();
  if (claims.aud !== env.GOOGLE_CLIENT_ID || !["accounts.google.com", "https://accounts.google.com"].includes(claims.iss)) return fail("The sign-in was not meant for this app.");
  if (!claims.email_verified) return fail("Your Google email address is not verified.");
  if (env.ALLOWED_DOMAIN && !email.endsWith("@" + env.ALLOWED_DOMAIN.toLowerCase())) return fail(`Only ${env.ALLOWED_DOMAIN} accounts can use this app. You signed in as ${email}.`);

  const session = await signSession(env, { email, name: claims.name || null, exp: Math.floor(Date.now() / 1000) + SESSION_HOURS * 3600 });
  const headers = new Headers({ location: saved.next || "/" });
  headers.append("set-cookie", cookie(SESSION_COOKIE, session, SESSION_HOURS * 3600));
  headers.append("set-cookie", cookie("rp_oauth", "", 0));
  return new Response(null, { status: 302, headers });
}
