import { getCopy, offlineState, saveCopy } from "./lib/offline.js";

export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

// `text`: send the body as it is (already JSON text), so the server can store it without reading it.
async function request(method, path, body, text = false) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { "content-type": text ? "text/plain" : "application/json" } : {},
    body: body ? (text ? body : JSON.stringify(body)) : undefined
  });
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  if (!res.ok) throw new ApiError(data?.error || `Request failed (${res.status})`, res.status, data?.details);
  return data;
}

// A page read: kept as a copy in this browser; when the database refuses (its daily limit) or the server can't be
// reached, the last copy is shown instead, with a banner at the top (lib/offline.js).
async function get(path) {
  try {
    const data = await request("GET", path);
    saveCopy(path, data);
    offlineState.live();
    return data;
  } catch (err) {
    const limit = !!err.details?.dbLimit;
    const unreachable = !(err instanceof ApiError) || err.status >= 500;
    if (!limit && !unreachable) throw err;
    const copy = await getCopy(path);
    if (!copy) throw err;
    offlineState.showing(copy.at, limit);
    return copy.data;
  }
}

export const api = {
  get,
  post: (p, b = {}) => request("POST", p, b),
  postText: (p, text) => request("POST", p, text, true),
  put: (p, b) => request("PUT", p, b),
  del: p => request("DELETE", p)
};

export const enc = encodeURIComponent;
