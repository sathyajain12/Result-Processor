import { HttpError, json } from "../_lib/http.js";
import { resolveUser } from "../_lib/auth.js";

export async function onRequest(context) {
  // The sign-in routes run before anyone is signed in.
  if (new URL(context.request.url).pathname.startsWith("/api/auth/")) return context.next();
  try {
    context.data.user = await resolveUser(context.request, context.env);
    return await context.next();
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message, details: err.details }, err.status);
    console.error(err);
    if (/daily row (read|write) limit|exceeded.*(free tier|daily).*limit/i.test(err.message || "")) {
      return json({ error: "Cloudflare's daily database limit has been reached, so nothing can be saved right now. It resets at 5:30 am IST. Your data is safe.",
        details: { dbLimit: true } }, 503);
    }
    return json({ error: "Unexpected server error", details: err.message }, 500);
  }
}
