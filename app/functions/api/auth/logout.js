import { cookie, SESSION_COOKIE } from "../../_lib/session.js";

export const onRequestGet = () =>
  new Response(null, { status: 302, headers: { location: "/", "set-cookie": cookie(SESSION_COOKIE, "", 0) } });
