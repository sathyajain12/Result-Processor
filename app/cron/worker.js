// Daily Mark sheets fetch: a small Worker with a Cron Trigger that shares the app's D1 database and code.
// Deploy from app/:  npx wrangler deploy --config cron/wrangler.toml
// It only fetches marks. Compute takes seconds of CPU, more than Cloudflare's free plan allows, so it runs in the browser:
// a session whose marks changed is marked so, and the portal says so until someone clicks Compute results.
import { runDaily } from "../functions/_lib/marksheets.js";

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runDaily(env).then(r => console.log(JSON.stringify(r))));
  }
};
