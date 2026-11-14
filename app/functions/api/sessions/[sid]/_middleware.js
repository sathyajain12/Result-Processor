import { assertOpen, isAllowedWhenLocked } from "../../../_lib/lock.js";
import { HttpError } from "../../../_lib/http.js";
import { tabsForPath, TABS } from "../../../../shared/tabs.js";

export async function onRequest(context) {
  const { request, env, params, data } = context;
  const pathname = new URL(request.url).pathname;
  // A person limited to some tabs (People page) gets only those tabs' data, whatever their role allows them to do there.
  const user = data.user;
  if (user && user.role !== "admin" && Array.isArray(user.tabs)) {
    const need = tabsForPath(pathname.split("/").slice(4).join("/"));
    if (need && !need.some(t => user.tabs.includes(t))) {
      const names = need.map(k => TABS.find(t => t.key === k)?.label).filter(Boolean);
      throw new HttpError(403, names.length ? `You do not have access to ${names.join(" or ")}. Ask an admin to give you that tab on the People page.` : "This needs an admin.");
    }
  }
  if (!isAllowedWhenLocked(request.method, pathname)) await assertOpen(env.DB, params.sid);
  return context.next();
}
