// A copy of what each page last loaded, kept in this browser (IndexedDB), so the portal can still show data when the
// database refuses: Cloudflare's free plan stops all database reads for the day once 5 million rows have been read.
// Only page data is kept, not Compute's paged reads or downloads. Signing out deletes the copies.

const DB_NAME = "result-processor-copies";
const STORE = "responses";

let opening = null;
function open() {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch(err => { opening = null; throw err; });
  return opening;
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

// Compute reads data in pages (part=, after=) and must never get an old copy; CSV downloads are not JSON.
export const keepsCopy = path => !/[?&](part|after|format)=|\/calc\//.test(path);

export function saveCopy(path, data) {
  if (!keepsCopy(path)) return;
  tx("readwrite", s => s.put({ data, at: Date.now() }, path)).catch(() => {});   // a full or blocked store only loses the copy
}

export async function getCopy(path) {
  if (!keepsCopy(path)) return null;
  try { return (await tx("readonly", s => s.get(path))) ?? null; } catch { return null; }
}

export async function clearCopies() {
  try { await tx("readwrite", s => s.clear()); } catch { /* nothing kept */ }
}

// Whether the pages on screen show saved copies: null, or { at, limit } for the banner, where `at` is the oldest copy shown
// and `limit` says the daily database limit was the reason (otherwise the server could not be reached).
let state = null;
const listeners = new Set();
const emit = next => { state = next; listeners.forEach(fn => fn()); };
export const offlineState = {
  get: () => state,
  subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); },
  showing: (at, limit) => emit({ at: state ? Math.min(state.at, at) : at, limit: limit || !!state?.limit }),
  live: () => { if (state) emit(null); }
};
