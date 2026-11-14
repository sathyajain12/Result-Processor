// Starts "Sign in with Google": remembers a random state (and where to return) in a short cookie, then redirects to Google.
import { cookie } from "../../_lib/session.js";

export async function onRequestGet({ request, env }) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.SESSION_SECRET) {
    return new Response("Google sign-in is not configured yet: set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and SESSION_SECRET.", { status: 500 });
  }
  const url = new URL(request.url);
  const next = url.searchParams.get("next") || "/";
  const state = crypto.randomUUID();
  const google = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  google.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: `${url.origin}/api/auth/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
    ...(env.ALLOWED_DOMAIN ? { hd: env.ALLOWED_DOMAIN } : {})
  });
  return new Response(null, {
    status: 302,
    headers: { location: google.toString(), "set-cookie": cookie("rp_oauth", JSON.stringify({ state, next: next.startsWith("/") && !next.startsWith("//") ? next : "/" }), 600) }
  });
}
