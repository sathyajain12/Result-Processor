import { useEffect, useRef, useState } from "react";

// The page people see before signing in. A deep ink panel carries the headline and the sign-in; a sample marks
// statement, laid across the panel's edge, assembles itself and ends with a green "Checked" mark. It replays every
// 15 seconds. The student is fictional, but the arithmetic follows the engine,
// because the people signing in grade results for a living and will check it:
//   COMB = CIE × 0.5 + ESE × 0.5, rounded half up to a whole number (roundSheets)
//   NP from table I-A (55–64 → 6, 65–74 → 7, 75–84 → 8)
//   GPA = Σ(credits × NP) ÷ Σ credits, to one decimal (roundGpa); grade from table II-A (6.0–6.9 → A)
const ACCESS_EMAIL = "coeoffice@sssihl.edu.in";
/* global APP_VERSION */

const roundHalfUp = x => Math.floor(x + 0.5);
const npOf = comb => (comb >= 95 ? 9.5 : comb >= 85 ? 9 : comb >= 75 ? 8 : comb >= 65 ? 7 : comb >= 55 ? 6 : comb >= 45 ? 5 : comb >= 40 ? 4 : 0);
const PAPERS = [
  ["TMAT-201", 4, 64, 61],
  ["TCSC-204", 4, 70, 68],
  ["TPHY-203", 4, 58, 66],
  ["TENG-205", 2, 80, 72],
  ["TVAL-206", 2, 66, 62]
].map(([code, credits, cie, ese]) => {
  const comb = roundHalfUp(cie * 0.5 + ese * 0.5);
  const np = npOf(comb);
  return { code, credits, cie, ese, comb, np, points: credits * np };
});
const CREDITS = PAPERS.reduce((n, p) => n + p.credits, 0);                 // 16
const POINTS = PAPERS.reduce((n, p) => n + p.points, 0);                   // 104
const GPA = Math.round((POINTS / CREDITS) * 10) / 10;                       // 6.5
const GRADE = "A", GRADE_TABLE = "II-A";

// About 2.5 s: marks typed in row by row (Prepare), COMB and NP resolve and the totals count up (Check),
// then the status turns to Checked (Release). Replays every 15 s.
const N = PAPERS.length;
const START = 300, MARK_ROW = 130, CHECK_ROW = 110, COUNT = 450, SIGN_GAP = 100;
const LOOP = 15000, CLEAR = 450;
// step: 0 nothing · 1..N marks · N+1..2N COMB and NP · 2N+1 totals · 2N+2 checked
const TOTALS = 2 * N + 1, DONE = 2 * N + 2;

function useSequence(reduced) {
  const [step, setStep] = useState(reduced ? DONE : 0);
  const [clearing, setClearing] = useState(false);
  useEffect(() => {
    if (reduced) return;
    let timers = [];
    const stop = () => { timers.forEach(clearTimeout); timers = []; };
    const play = delay => {
      for (let i = 1; i <= N; i++) timers.push(setTimeout(() => setStep(i), delay + (i - 1) * MARK_ROW));
      const check = delay + N * MARK_ROW + 80;
      for (let i = 1; i <= N; i++) timers.push(setTimeout(() => setStep(N + i), check + (i - 1) * CHECK_ROW));
      const totals = check + N * CHECK_ROW + 60;
      timers.push(setTimeout(() => setStep(TOTALS), totals));
      timers.push(setTimeout(() => setStep(DONE), totals + COUNT + SIGN_GAP));
    };
    const replay = () => {
      if (document.hidden) return;   // no point animating a background tab
      stop();
      setClearing(true);
      timers.push(setTimeout(() => { setClearing(false); setStep(0); play(200); }, CLEAR));
    };
    play(START);
    const loop = setInterval(replay, LOOP);
    return () => { stop(); clearInterval(loop); };
  }, [reduced]);
  return { step, clearing };
}

// Counts from 0 up to the target once `on` turns true (or shows it at once with reduced motion).
function useCount(on, target, decimals, reduced) {
  const [v, setV] = useState(reduced ? target : 0);
  const raf = useRef(0);
  useEffect(() => {
    if (reduced) return;
    if (!on) { setV(0); return; }
    const t0 = performance.now();
    const f = 10 ** decimals;
    const tick = now => {
      const p = Math.min(1, (now - t0) / COUNT);
      const eased = 1 - (1 - p) ** 3;
      setV(p === 1 ? target : Math.round(target * eased * f) / f);
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [on, target, decimals, reduced]);
  return v;
}

function Statement() {
  const reduced = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const { step, clearing } = useSequence(reduced);
  const marks = i => step > i;
  const resolved = i => step > N + i;
  const totals = step >= TOTALS;
  const checked = step >= DONE;
  const credits = useCount(totals, CREDITS, 0, reduced);
  const points = useCount(totals, POINTS, 0, reduced);
  const gpa = useCount(totals, GPA, 1, reduced);
  const stages = [["Prepare", step >= 1], ["Check", step > N], ["Release", checked]];
  const cell = (on, v, cls = "") => <td className={`lp-v ${cls}${on ? " on" : ""}`}><span>{on ? v : ""}</span></td>;
  return (
    <div className="lp-sample">
      <div className={`lp-stack${clearing ? " lp-clearing" : ""}${reduced ? " still" : ""}`}>
        <i className="lp-sheet two" aria-hidden="true" />
        <i className="lp-sheet one" aria-hidden="true" />
        <figure className="lp-card"
          aria-label={`Sample marks statement: ${N} papers, ${CREDITS} credits, ${POINTS} credit points, GPA ${GPA.toFixed(1)}, grade ${GRADE} on table ${GRADE_TABLE}, checked`}>
          <figcaption className="lp-card-head">
            <span>Sample statement</span>
            <span className="lp-fict">Regd No 00000000000, not a real record</span>
          </figcaption>
          <table className="lp-table" aria-hidden="true">
            <thead><tr><th>Paper</th><th className="lp-wide">Credits</th><th className="lp-wide">CIE %</th><th className="lp-wide">ESE %</th><th>COMB %</th><th>NP</th><th className="lp-wide">Credits × NP</th></tr></thead>
            <tbody>
              {PAPERS.map((p, i) => (
                <tr key={p.code} className={marks(i) ? "typed" : ""}>
                  <td>{p.code}</td>
                  <td className="lp-wide">{p.credits}</td>
                  {cell(marks(i), p.cie, "lp-wide")}
                  {cell(marks(i), p.ese, "lp-wide")}
                  {cell(resolved(i), p.comb)}
                  {cell(resolved(i), p.np, "lp-strong")}
                  {cell(resolved(i), p.points, "lp-wide")}
                </tr>
              ))}
            </tbody>
            <tfoot className="lp-wide">
              <tr>
                <td>Total</td>
                <td><span>{totals ? credits : ""}</span></td>
                <td colSpan={4} />
                <td className="lp-strong"><span>{totals ? points : ""}</span></td>
              </tr>
            </tfoot>
          </table>
          <div className="lp-result" aria-hidden="true">
            <span>GPA {totals ? <>{POINTS} ÷ {CREDITS} = <b>{gpa.toFixed(1)}</b></> : ""}</span>
            <span>{totals ? <>Grade <b>{GRADE}</b> (table {GRADE_TABLE})</> : ""}</span>
            <span className={`lp-checked${checked ? " on" : ""}`}>{checked ? "Checked ✓" : "To check"}</span>
          </div>
          <ol className="lp-steps" aria-label="Stages">
            {stages.map(([name, lit]) => <li key={name} className={lit ? "lit" : ""}><span>{name}</span></li>)}
          </ol>
        </figure>
      </div>
    </div>
  );
}

export default function Landing({ logo }) {
  const next = encodeURIComponent(location.pathname + location.search);
  const mail = `mailto:${ACCESS_EMAIL}?subject=Result%20Processor%20access`;
  return (
    <div className="lp">
      <section className="lp-stage">
        <div className="lp-panel" aria-hidden="true" />
        <header className="lp-wrap lp-bar">
          <img className="lp-logo" src={logo} alt="SSSIHL emblem" />
          <span><b>Result Processor</b><small>Controller of Examinations, SSSIHL</small></span>
        </header>
        <div className="lp-wrap lp-grid">
          <div className="lp-copy">
            <h1><span>Results for every</span> <span>exam session,</span> <span>computed, checked</span> <span>and released.</span></h1>
            <a className="gsi-btn" href={`/api/auth/login?next=${next}`}>
              <svg className="gsi-icon" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
              </svg>
              <span>Sign in with Google</span>
            </a>
            <p className="lp-note">Use your sssihl.edu.in account.<br />No access yet? <a href={mail}>Ask the COE office</a>.</p>
          </div>
          <Statement />
        </div>
      </section>

      <footer className="lp-wrap lp-foot">
        <span>Office of the Controller of Examinations, SSSIHL, Prasanthi Nilayam</span>
        <span>Access: <a href={mail}>{ACCESS_EMAIL}</a></span>
        <span>Version {APP_VERSION.split(".").slice(0, 2).join(".")}</span>
      </footer>
    </div>
  );
}
