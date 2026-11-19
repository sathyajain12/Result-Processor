import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, NavLink, Route, Routes, useNavigate, useParams, Link } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import "./styles.css";
import { api, enc } from "./api.js";
import { ToastProvider, SessionProvider, UserMenu, ComputeStatus, OfflineBanner, signOut, useLoad, useAction, fmtGpa, fmtWhen } from "./components/ui.jsx";
import { Icon } from "./components/icons.jsx";
import Sessions from "./pages/Sessions.jsx";
import Board from "./pages/Board.jsx";
import Batch from "./pages/Batch.jsx";
import Student from "./pages/Student.jsx";
import Issues from "./pages/Issues.jsx";
import Sources from "./pages/Sources.jsx";
import History from "./pages/History.jsx";
import Reference from "./pages/Reference.jsx";
import Users from "./pages/Users.jsx";
import Integral from "./pages/Integral.jsx";
import GradeRegister from "./pages/GradeRegister.jsx";
import Landing from "./pages/Landing.jsx";
import Analytics from "./pages/Analytics.jsx";
import Cycle from "./pages/Cycle.jsx";
import FinalOutput from "./pages/FinalOutput.jsx";
import Failures from "./pages/Failures.jsx";
import Grace from "./pages/Grace.jsx";
import Completeness from "./pages/Completeness.jsx";
import MarkSheets from "./pages/MarkSheets.jsx";
import MorningSummary from "./pages/MorningSummary.jsx";
import { canSee, allowedTabs } from "../shared/tabs.js";

function Search({ sid }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState([]);
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const box = useRef(null);
  const input = useRef(null);
  // "/" focuses the search box from anywhere except a text field.
  useEffect(() => {
    const onKey = e => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
      e.preventDefault();
      input.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(() => api.get(`/sessions/${enc(sid)}/students?q=${enc(q.trim())}`).then(setHits).catch(() => setHits([])), 200);
    return () => clearTimeout(t);
  }, [q, sid]);
  useEffect(() => {
    const close = e => box.current && !box.current.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  return (
    <div className="search" ref={box}>
      <Icon name="search" />
      <input ref={input} type="search" placeholder="Find a student by Regd No or name" value={q} aria-label="Find a student"
        onChange={e => { setQ(e.target.value); setOpen(true); }}
        onKeyDown={e => { if (e.key === "Enter" && hits[0]) { nav(`/s/${sid}/students/${hits[0].regdNo}`); setOpen(false); } if (e.key === "Escape") e.currentTarget.blur(); }} />
      {!q && <kbd aria-hidden="true">/</kbd>}
      {open && hits.length > 0 && (
        <div className="results">
          {hits.map(h => (
            <Link key={h.regdNo} to={`/s/${sid}/students/${h.regdNo}`} onClick={() => setOpen(false)}>
              <span><b>{h.name}</b> <span className="faint small">{h.regdNo}</span></span>
              <span className="muted small">{h.programme} Sem {h.semester}, GPA {fmtGpa(h.publishedGpa)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// Sessions arrive newest first, so cycles come out in order of their latest session.
function sessionGroups(sessions) {
  const groups = new Map();
  for (const s of sessions) {
    const label = s.cycleName || "Not in a cycle";
    (groups.get(label) || groups.set(label, { label, sessions: [] }).get(label)).sessions.push(s);
  }
  const loose = groups.get("Not in a cycle");
  groups.delete("Not in a cycle");
  return loose ? [...groups.values(), loose] : [...groups.values()];
}

// A tab this person may not open (People page): say so, and offer the ones they can.
function NoAccess({ sid, me }) {
  const tabs = allowedTabs(me);
  return (
    <div className="page">
      <div className="sheet pad">
        <h2>{tabs.length ? "You do not have access to this tab" : "You do not have access to any tab yet"}</h2>
        <p className="muted" style={{ marginTop: 8 }}>An admin decides who can open which tab, on the People page.</p>
        {tabs.some(t => t.path !== null) && <p style={{ marginTop: 12 }}>You can open: {tabs.filter(t => t.path !== null).map((t, i) => <span key={t.key}>{i ? ", " : ""}<Link to={`/s/${sid}/${t.path}`}>{t.label}</Link></span>)}.</p>}
        {canSee(me, "students") && <p style={{ marginTop: 8 }}>Use the search box above to find a student.</p>}
      </div>
    </div>
  );
}

function LockBanner({ sid, me, session }) {
  const [busy, run] = useAction();
  const s = session.data;
  const unlock = async () => {
    if (await run(() => api.post(`/sessions/${enc(sid)}/lock`, { locked: false }), "Session unlocked")) session.reload();
  };
  return (
    <div className="notice lock" role="status">
      <span><Icon name="lock" /> <b>Locked</b> by {s.closedBy} on {fmtWhen(s.closedAt)}{s.closeReason ? `: ${s.closeReason}` : ""}. Results are read-only.</span>
      {me.role === "admin" && <button className="btn small" disabled={busy} onClick={unlock}><Icon name="unlock" />Unlock</button>}
    </div>
  );
}

// The SSSIHL emblem (white, for the navy sidebar and header), served from public/Images.
const LOGO = "/Images/SSSIHL%20Logo_White.png";

function SessionShell({ me, sessions }) {
  const { sid } = useParams();
  const nav = useNavigate();
  const session = useLoad(`/sessions/${enc(sid)}`);
  const blocking = session.data?.run?.summary?.blocking;
  const see = k => canSee(me, k);
  const only = (k, el) => (see(k) ? el : <NoAccess sid={sid} me={me} />);
  const first = allowedTabs(me).find(t => t.path);   // a tab with a page of its own (Student pages has only the search)

  return (
    <SessionProvider value={{ sid, me, session }}>
      <div className="shell">
        <aside className="side">
          <Link className="brand" to="/sessions" title="All cycles and sessions">
            <img className="brand-logo" src={LOGO} alt="SSSIHL emblem" />
            <span><b>Result Processor</b><span>Controller of Examinations, SSSIHL</span></span>
          </Link>
          <div>
            <span className="session-label">Exam session</span>
            <select aria-label="Exam session" value={sid} onChange={e => e.target.value === "__all" ? nav("/sessions") : nav(`/s/${e.target.value}`)}>
              {sessionGroups(sessions).map(g => (
                <optgroup key={g.label} label={g.label}>
                  {g.sessions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </optgroup>
              ))}
              <option value="__all">All cycles and sessions…</option>
            </select>
          </div>
          {/* Grouped by workflow: prepare the data, check the results, release them; then settings. */}
          <nav aria-label="Session">
            {/* Only the tabs this person may open (People page). */}
            {(see("sources") || see("marksheets") || see("integral")) && <div className="nav-group" aria-label="Prepare">
              {see("sources") && <NavLink to={`/s/${sid}/sources`}>Data sources</NavLink>}
              {see("marksheets") && <NavLink to={`/s/${sid}/marksheets`}>Mark sheets</NavLink>}
              {see("integral") && <NavLink to={`/s/${sid}/integral`}>Integral Items</NavLink>}
            </div>}
            {(see("batches") || see("completeness") || see("issues") || see("analytics")) && <div className="nav-group" aria-label="Check">
              {see("batches") && <NavLink end to={`/s/${sid}`}>Batches</NavLink>}
              {see("completeness") && <NavLink to={`/s/${sid}/completeness`}>Completeness</NavLink>}
              {see("issues") && <NavLink to={`/s/${sid}/issues`}>Issues {blocking > 0 && <span className="count" aria-label={`${blocking} blocking`}>{blocking}</span>}</NavLink>}
              {see("analytics") && <NavLink to={`/s/${sid}/analytics`}>Analytics</NavLink>}
            </div>}
            {(see("final") || see("failures") || see("grace") || see("register")) && <div className="nav-group" aria-label="Release">
              {see("final") && <NavLink to={`/s/${sid}/final`}>Final output</NavLink>}
              {see("failures") && <NavLink to={`/s/${sid}/failures`}>Failures</NavLink>}
              {see("grace") && <NavLink to={`/s/${sid}/grace`}>Gracing</NavLink>}
              {see("register") && <NavLink to={`/s/${sid}/register`}>Grade register</NavLink>}
            </div>}
            {(see("history") || see("reference") || me.role === "admin") && <div className="nav-group" aria-label="Settings">
              {see("history") && <NavLink to={`/s/${sid}/history`}>Runs and audit</NavLink>}
              {see("reference") && <NavLink to={`/s/${sid}/reference`}>Grading rules</NavLink>}
              {me.role === "admin" && <NavLink to={`/s/${sid}/users`}>People</NavLink>}
            </div>}
          </nav>
          <div className="foot"><UserMenu me={me} up /></div>
        </aside>
        <div className="main">
          <div className="top">{see("students") && <Search sid={sid} />}</div>
          <ComputeStatus />
          {session.data?.status === "closed" && <LockBanner sid={sid} me={me} session={session} />}
          <Routes>
            {/* The session's home is the Batches list; someone without it starts on the first tab they may open. */}
            <Route index element={see("batches") ? <Board /> : first ? <Navigate to={`/s/${sid}/${first.path}`} replace /> : <NoAccess sid={sid} me={me} />} />
            <Route path="batches/:bid" element={only("batches", <Batch />)} />
            <Route path="students/:regd" element={only("students", <Student />)} />
            <Route path="issues" element={only("issues", <Issues />)} />
            <Route path="sources" element={only("sources", <Sources />)} />
            <Route path="history" element={only("history", <History />)} />
            <Route path="reference" element={only("reference", <Reference />)} />
            <Route path="users" element={me.role === "admin" ? <Users /> : <NoAccess sid={sid} me={me} />} />
            <Route path="integral" element={only("integral", <Integral />)} />
            <Route path="analytics" element={only("analytics", <Analytics />)} />
            <Route path="final" element={only("final", <FinalOutput />)} />
            <Route path="failures" element={only("failures", <Failures />)} />
            <Route path="grace" element={only("grace", <Grace />)} />
            <Route path="completeness" element={only("completeness", <Completeness />)} />
            <Route path="marksheets" element={only("marksheets", <MarkSheets />)} />
            <Route path="marksheets/morning" element={only("marksheets", <MorningSummary />)} />
            <Route path="register" element={only("register", <GradeRegister />)} />
            {/* An old or mistyped address (such as the removed Result sheet and Failure list) goes to the session's home page. */}
            <Route path="*" element={<Navigate to={`/s/${sid}`} replace />} />
          </Routes>
        </div>
      </div>
    </SessionProvider>
  );
}

// Header for the pages outside a session (all cycles, a cycle overview).
function AppBar({ me, children }) {
  return (
    <>
      <header className="appbar">
        <Link className="brand" to="/sessions">
          <img className="brand-logo" src={LOGO} alt="SSSIHL emblem" />
          <span><b>Result Processor</b><span>Controller of Examinations, SSSIHL</span></span>
        </Link>
        <div className="row">
          <UserMenu me={me} />
        </div>
      </header>
      {children}
    </>
  );
}


function App() {
  const me = useLoad("/me");
  const sessions = useLoad("/sessions");
  if (me.error?.details?.signIn) return <Landing logo={LOGO} />;
  if (me.error?.details?.removed || me.error?.details?.notInvited) return (
    <div className="page" style={{ maxWidth: 640 }}>
      <div className="sheet pad">
        <h2>No access</h2>
        <p style={{ marginTop: 8 }}>{me.error.message}</p>
        <p className="small muted" style={{ marginTop: 8 }}>Signed in as {me.error.details.email}.</p>
        <p style={{ marginTop: 14 }}><a className="btn" href="/api/auth/logout" onClick={signOut}>Sign out</a></p>
      </div>
    </div>
  );
  // Either one failing with no saved copy (e.g. the daily database limit) says why, rather than "Loading…" for ever.
  const failed = me.error || sessions.error;
  if (failed) return <div className="page"><div className="notice red">{failed.message}</div></div>;
  if (!me.data || !sessions.data) return <div className="boot">Loading the Result Processor…</div>;
  return (
    <Routes>
      <Route path="/" element={sessions.data.length === 1 ? <Navigate to={`/s/${sessions.data[0].id}`} replace /> : <AppBar me={me.data}><Sessions me={me.data} sessions={sessions.data} reload={sessions.reload} /></AppBar>} />
      <Route path="/sessions" element={<AppBar me={me.data}><Sessions me={me.data} sessions={sessions.data} reload={sessions.reload} /></AppBar>} />
      <Route path="/cycles/:cid" element={<AppBar me={me.data}><Cycle /></AppBar>} />
      <Route path="/s/:sid/*" element={<SessionShell me={me.data} sessions={sessions.data} />} />
    </Routes>
  );
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <ToastProvider><OfflineBanner /><App /></ToastProvider>
  </BrowserRouter>
);
