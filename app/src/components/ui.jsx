import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api } from "../api.js";
import { computeState } from "../lib/compute.js";
import { clearCopies, offlineState } from "../lib/offline.js";
import { Icon } from "./icons.jsx";

// The progress of a Compute running in this browser (see lib/compute.js), shown at the top of every session page.
export function ComputeStatus() {
  const p = useSyncExternalStore(computeState.subscribe, computeState.get);
  if (!p) return null;
  const pct = p.total ? Math.round((p.done / p.total) * 100) : null;
  return (
    <div className="compute-status" role="status" aria-live="polite">
      <b>Computing results…</b>
      <span className="small">{p.label}{p.total ? ` (${p.done} of ${p.total})` : p.done ? ` (${p.done})` : ""}. Keep this page open until it finishes.</span>
      <div className="strip"><i className="approved" style={{ width: `${pct ?? (p.stage === "save" ? 90 : 30)}%`, transition: "width 0.3s" }} /></div>
    </div>
  );
}

export function useLoad(path, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!path) return;
    const id = ++seq.current;
    setState(s => ({ ...s, loading: true }));
    try {
      const data = await api.get(path);
      if (id === seq.current) setState({ data, error: null, loading: false });
    } catch (error) {
      if (id === seq.current) setState({ data: null, error, loading: false });
    }
  }, [path]);
  useEffect(() => { load(); }, [load, ...deps]);
  return { ...state, reload: load };
}

// Signing out deletes the copies of pages kept in this browser (lib/offline.js) before leaving.
export function signOut(e) {
  e.preventDefault();
  const href = e.currentTarget.href;
  clearCopies().finally(() => { window.location.href = href; });
}

// Shown at the top while pages show the copies kept in this browser, because the database refused or the server is down.
export function OfflineBanner() {
  const s = useSyncExternalStore(offlineState.subscribe, offlineState.get);
  if (!s) return null;
  const at = new Date(s.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  return (
    <div className="offline-banner" role="status">
      <Icon name="alert" size={18} />
      <span>
        <b>{s.limit ? "Cloudflare's daily database limit has been reached." : "The server can't be reached right now."}</b>{" "}
        You're seeing the copy saved in this browser (oldest from {at}), so it may be out of date. Pages not opened before can't be shown,
        and nothing can be saved{s.limit ? " until the limit resets at 5:30 am IST" : ""}.
      </span>
    </div>
  );
}

const ToastContext = createContext(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);
  const show = useCallback((message, kind = "info") => {
    setToast({ message, kind, id: Date.now() });
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.kind === "error" ? 7000 : 4000);
    return () => clearTimeout(t);
  }, [toast]);
  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && <div key={toast.id} className={`toast ${toast.kind}`} role="status"><Icon name={toast.kind === "error" ? "alert" : "check"} size={18} /><span>{toast.message}</span></div>}
    </ToastContext.Provider>
  );
}

const SessionContext = createContext(null);
export const SessionProvider = SessionContext.Provider;
export const useSession = () => useContext(SessionContext);

// What the signed-in person may do in the current session; a locked session is read-only for everyone.
export function useCan() {
  const { me, session } = useSession();
  const locked = session?.data?.status === "closed";
  return { locked, operate: me.role !== "viewer" && !locked, admin: me.role === "admin" && !locked };
}

export function Skeleton() {
  return <div className="skeleton" aria-busy="true" aria-label="Loading"><i className="block" /><i className="mid" /><i /><i className="short" /></div>;
}

export function Loading({ state, children }) {
  if (state.error) return <div className="notice red">{state.error.message}</div>;
  if (!state.data) return <Skeleton />;
  return children(state.data);
}

// A friendly empty state: icon, one-line title, optional hint and actions.
export function EmptyState({ icon = "inbox", title, children, actions }) {
  return (
    <div className="empty-state">
      <span className="icon-wrap"><Icon name={icon} size={22} /></span>
      <b>{title}</b>
      {children && <p>{children}</p>}
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

// A line that opens to show more (Completeness, Mark sheets). What it holds is only drawn while open, so thousands of rows
// never all sit in the page. `level` 1 or 2 sets the indent; `extra` is a short note beside the title; `count` a badge.
export function Disclosure({ level = 1, head, extra, count, countLabel, defaultOpen = false, className = "", children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`cr-group l${level}${open ? " open" : ""}${className ? ` ${className}` : ""}`}>
      <div className="cr-group-head">
        <button type="button" className="cr-toggle" aria-expanded={open} onClick={() => setOpen(o => !o)}>
          <span className="cr-caret" aria-hidden="true">{open ? "▾" : "▸"}</span>
          <span className="cr-group-title">{head}</span>
          {extra && <span className="cr-group-extra">{extra}</span>}
          {count !== undefined && count !== null && <span className="cr-group-count" title={countLabel}>{count}</span>}
        </button>
      </div>
      {open && <div className="cr-group-body">{children}</div>}
    </div>
  );
}

// System / Light / Dark. The choice is kept in this browser only; index.html applies it before first paint.
const THEMES = [["system", "Use the system setting"], ["light", "Light"], ["dark", "Dark"]];
const ROLE_NAMES = { admin: "Admin", operator: "Operator", viewer: "Viewer" };

// The signed-in person as plain text. A small menu on it holds the theme choice and sign-out.
export function UserMenu({ me, up = false }) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem("rp-theme") || "system"; } catch { return "system"; }
  });
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const away = e => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = e => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  const choose = t => {
    setTheme(t);
    if (t === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", t);
    try { t === "system" ? localStorage.removeItem("rp-theme") : localStorage.setItem("rp-theme", t); } catch { /* storage unavailable */ }
  };
  return (
    <div className="user-menu" ref={ref}>
      <button className="user-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)} title="Theme and sign out">
        <span className="user-email">{me.email}</span>
        <span className="user-role">{ROLE_NAMES[me.role] || me.role}</span>
      </button>
      {open && (
        <div className={`menu-pop${up ? " up" : ""}`} role="menu">
          <div className="menu-label">Theme</div>
          {THEMES.map(([t, label]) => (
            <button key={t} role="menuitemradio" aria-checked={theme === t} onClick={() => choose(t)}>{label}{theme === t && <span className="menu-tick">✓</span>}</button>
          ))}
          <a role="menuitem" className="menu-sep" href="/api/auth/logout" onClick={signOut}>Sign out</a>
        </div>
      )}
    </div>
  );
}

export function Modal({ title, children, onClose, footer }) {
  useEffect(() => {
    const onKey = e => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <header><h2>{title}</h2></header>
        <div className="body">{children}</div>
        <footer>{footer}</footer>
      </div>
    </div>
  );
}

export const Stage = ({ stage }) => <span className={`stage ${stage.replace(/[()]/g, "").replace(/\s+/g, "-")}`}>{stage}</span>;

export const STATUS_LABEL = {
  // "held" is the stored name; people see "Pending" (the result is not finished: marks to come or an issue to fix).
  approved: "Approved", ready: "Ready", changed: "Changed since approval", held: "Pending", withheld: "Withheld"
};
export const Status = ({ status }) => <span className={`status ${status}`}>{STATUS_LABEL[status] || status}</span>;

const ORDER = ["approved", "ready", "changed", "held", "withheld"];
export function StateStrip({ counts, total }) {
  const sum = total || ORDER.reduce((n, k) => n + (counts[k] || 0), 0);
  return (
    <div className="strip" title={ORDER.filter(k => counts[k]).map(k => `${STATUS_LABEL[k]}: ${counts[k]}`).join("\n")}>
      {ORDER.map(k => counts[k] ? <i key={k} className={k} style={{ width: `${(counts[k] / sum) * 100}%` }} /> : null)}
    </div>
  );
}
export function StripLegend() {
  const colors = { approved: "var(--green-solid)", ready: "var(--ready)", changed: "var(--changed)", held: "var(--held)", withheld: "var(--seal)" };


  return <div className="legend">{ORDER.map(k => <span key={k}><i style={{ background: colors[k] }} />{STATUS_LABEL[k]}</span>)}</div>;
}

// Exceptions that cannot be accepted: the cause has to be fixed.
export const NOT_ACCEPTABLE = new Set(["SUPP_NO_BASE_RESULT"]);

export const Sev = ({ severity }) => <span className={`sev ${severity}`}>{{ block: "Blocking", warn: "Check", info: "Note" }[severity]}</span>;

export const fmtGpa = v => (v === null || v === undefined || v === "" ? "—" : isNaN(Number(v)) ? v : Number(v).toFixed(1));
export const fmtPct = v => (v === null || v === undefined ? "—" : `${v}%`);
export const fmtNP = v => (v === null || v === undefined || v === "" ? "—" : String(v));
export const fmtWhen = s => {
  if (!s) return "never";
  const d = new Date(s.includes("T") ? s : s.replace(" ", "T") + "Z");
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};
export const batchLabel = (programme, semester, batch) => `${programme} Sem ${semester}${batch ? `, batch ${batch}` : ""}`;

export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn, success) => {
    setBusy(true);
    try {
      const r = await fn();
      if (success) toast(typeof success === "function" ? success(r) : success);
      return r;
    } catch (e) {
      toast(e.message, "error");
      return null;
    } finally {
      setBusy(false);
    }
  }, [toast]);
  return [busy, run];
}
