import { HttpError } from "./http.js";

const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlText = s => b64url(new TextEncoder().encode(s));

let cached = null;

// GOOGLE_API_BASE / GOOGLE_FAKE_TOKEN point the app at a local stand-in for Google in development only.
const sheetsBase = env => (env.GOOGLE_API_BASE || "https://sheets.googleapis.com").replace(/\/$/, "");
const driveBase = env => (env.GOOGLE_DRIVE_BASE || env.GOOGLE_API_BASE || "https://www.googleapis.com").replace(/\/$/, "");

async function accessToken(env) {
  if (env.GOOGLE_FAKE_TOKEN) return env.GOOGLE_FAKE_TOKEN;
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;
  if (!env.GOOGLE_SA_EMAIL || !env.GOOGLE_SA_KEY) {
    throw new HttpError(500, "Google service account is not configured (GOOGLE_SA_EMAIL / GOOGLE_SA_KEY secrets)");
  }

  const pem = env.GOOGLE_SA_KEY.replace(/\\n/g, "\n").replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);

  const now = Math.floor(Date.now() / 1000);
  const header = b64urlText(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64urlText(JSON.stringify({
    iss: env.GOOGLE_SA_EMAIL,
    // Read-only Sheets, and read-only Drive to list the files in a shared folder and export a sheet as it looks.
    // The service account only ever sees files that have been shared with it.
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/drive.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  }));
  const signature = b64url(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claims}`)));

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claims}.${signature}` })
  });
  if (!res.ok) throw new HttpError(502, `Google sign-in failed: ${await res.text()}`);
  const data = await res.json();
  cached = { token: data.access_token, expires: Date.now() + data.expires_in * 1000 };
  return cached.token;
}

export async function readSheet(env, spreadsheetId, sheetName) {
  const token = await accessToken(env);
  const range = encodeURIComponent(sheetName ? `'${sheetName.replace(/'/g, "''")}'` : "A:ZZ");
  const url = `${sheetsBase(env)}/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${range}?valueRenderOption=UNFORMATTED_VALUE&majorDimension=ROWS`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (res.status === 403 || res.status === 404) {
    throw new HttpError(400, `Cannot read sheet "${sheetName}" in ${spreadsheetId}. Share the spreadsheet with ${env.GOOGLE_SA_EMAIL} (Viewer) and check the sheet name.`);
  }
  if (!res.ok) throw new HttpError(502, `Google Sheets error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.values || [];
}

// A Google error that says why a teacher's file could not be read, so the Mark sheets page can show it.
export class SheetAccessError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function getJson(env, url) {
  const token = await accessToken(env);
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (res.status === 403 || res.status === 404) throw new SheetAccessError(res.status, res.status === 404 ? "File not found" : `No access: share it (or its folder) with ${env.GOOGLE_SA_EMAIL || "the service account"} as Viewer`);
  if (res.status === 429) throw new SheetAccessError(429, "Google rate limit reached; try again in a minute");
  if (!res.ok) throw new SheetAccessError(res.status, `Google Sheets error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// Tab names and named ranges (with their grid positions) of a spreadsheet.
export async function readLayout(env, spreadsheetId) {
  const fields = encodeURIComponent("properties.title,sheets.properties(sheetId,title),namedRanges(name,range)");
  return getJson(env, `${sheetsBase(env)}/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=${fields}`);
}

// One tab of a spreadsheet exactly as Google renders it (colours, borders, fonts), as a PDF, landscape, hidden rows and
// columns left out. onePage fits the whole area on a single page (headers shown once); otherwise it is fitted to the page
// width over several pages with the frozen header rows repeated. Returns Google's response so the body can be streamed on.
export async function exportTabPdf(env, spreadsheetId, gid, area = null, onePage = true) {
  const token = await accessToken(env);
  const q = new URLSearchParams({ format: "pdf", gid: String(gid), portrait: "false", size: "A3", gridlines: "false",
    ...(onePage ? { scale: "4", fzr: "false" } : { fitw: "true", fzr: "true" }),
    sheetnames: "false", printtitle: "false", pagenum: "UNDEFINED", top_margin: "0.25", bottom_margin: "0.25", left_margin: "0.25", right_margin: "0.25" });
  // Only the used part of the tab (0-based, end exclusive), so hundreds of empty template rows don't shrink it.
  if (area) for (const k of ["r1", "c1", "r2", "c2"]) if (Number.isFinite(area[k])) q.set(k, String(area[k]));
  const base = (env.GOOGLE_EXPORT_BASE || env.GOOGLE_API_BASE || "https://docs.google.com").replace(/\/$/, "");
  const res = await fetch(`${base}/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/export?${q}`, { headers: { authorization: `Bearer ${token}` } });
  if (res.status === 401 || res.status === 403 || res.status === 404) throw new SheetAccessError(res.status === 404 ? 404 : 403, `No access: share it (or its folder) with ${env.GOOGLE_SA_EMAIL || "the service account"} as Viewer`);
  if (res.status === 429) throw new SheetAccessError(429, "Google rate limit reached; try again in a minute");
  if (!res.ok) throw new SheetAccessError(res.status, `Google export error ${res.status}`);
  return res;
}

// A Drive file or folder's name and type.
export async function driveItem(env, id) {
  return getJson(env, `${driveBase(env)}/drive/v3/files/${encodeURIComponent(id)}?fields=id,name,mimeType&supportsAllDrives=true`);
}

// Every Google Sheet in a folder and its subfolders (a few levels down), with the name of the folder each sits in.
export async function listSpreadsheets(env, folderId, maxDepth = 3) {
  const SHEET = "application/vnd.google-apps.spreadsheet", FOLDER = "application/vnd.google-apps.folder";
  const out = [];
  const walk = async (id, folderName, depth) => {
    let pageToken = "";
    do {
      const q = encodeURIComponent(`'${id}' in parents and trashed = false and (mimeType = '${SHEET}' or mimeType = '${FOLDER}')`);
      const data = await getJson(env, `${driveBase(env)}/drive/v3/files?q=${q}&fields=nextPageToken,files(id,name,mimeType)&pageSize=1000` +
        `&supportsAllDrives=true&includeItemsFromAllDrives=true${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`);
      for (const f of data.files || []) {
        if (f.mimeType === SHEET) out.push({ id: f.id, name: f.name, folder: folderName });
        else if (depth < maxDepth) await walk(f.id, f.name, depth + 1);
      }
      pageToken = data.nextPageToken || "";
    } while (pageToken);
  };
  const root = await driveItem(env, folderId);
  await walk(folderId, root.name, 0);
  return out;
}

// Several ranges at once (A1 notation), raw values.
export async function readRanges(env, spreadsheetId, ranges) {
  const q = ranges.map(r => `ranges=${encodeURIComponent(r)}`).join("&");
  const data = await getJson(env, `${sheetsBase(env)}/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchGet?${q}&valueRenderOption=UNFORMATTED_VALUE&majorDimension=ROWS`);
  return (data.valueRanges || []).map(v => v.values || []);
}
