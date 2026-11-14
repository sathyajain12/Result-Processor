// Shown while the grade register goes to print. While the pages load ("loading"), a sheet feeds into a printer; once they
// are loaded ("flipping"), the real pages flip past (each student's name, Regd No and page number) just before the
// browser's print dialog opens. It sits inside the app, which the print stylesheet hides, so it never reaches the paper.
// With reduced motion, the global rule stops it and the dialog opens at once (GradeRegister.jsx).

const MAX_FLIP = 12;          // pages shown flipping past, spread evenly from first to last
const FLIP_MS = 1300;         // all the flips together, whatever the number of pages
const TURN_MS = 380;          // one page turning
const HOLD_MS = 350;          // the last page held still before the dialog

// The pages to flip through: up to MAX_FLIP, evenly spread and always including the first and the last.
export function flipPages(students) {
  const n = students.length;
  const count = Math.min(n, MAX_FLIP);
  const picks = count <= 1 ? [0] : [...new Set(Array.from({ length: count }, (_, i) => Math.round((i * (n - 1)) / (count - 1))))];
  return picks.map(i => ({ page: i + 1, regdNo: students[i].regdNo, name: students[i].name, programme: students[i].programme, semester: students[i].semester }));
}
const stepMs = count => (count > 1 ? Math.min(220, FLIP_MS / (count - 1)) : 0);
export const flipDurationMs = count => (count > 1 ? (count - 1) * stepMs(count) + TURN_MS : 0) + HOLD_MS;

// A miniature grade register page: the emblem, the title, and rows of figures.
function SheetFace({ lines = 7 }) {
  return (
    <div className="printer-face" aria-hidden="true">
      <div className="printer-face-head"><i className="printer-logo" /><i className="printer-title" /></div>
      {Array.from({ length: lines }, (_, i) => <i key={i} className="printer-line" style={{ "--n": i, width: `${[92, 78, 86, 70, 90, 64, 82][i % 7]}%` }} />)}
    </div>
  );
}

// One page of the register as it will print: header, the student, a few rows, and the page number.
function FlipPage({ p, total, index, count }) {
  const last = index === count - 1;
  return (
    <div className={`flip-page${last ? " last" : ""}`} style={{ zIndex: count - index, "--d": `${index * stepMs(count)}ms`, "--t": `${TURN_MS}ms` }} aria-hidden="true">
      <div className="flip-head"><i className="printer-logo" /><span>Grade Register</span></div>
      <b className="flip-name">{p.name || p.regdNo}</b>
      <span className="flip-meta">{p.regdNo}{p.programme ? ` · ${p.programme}${p.semester ? ` Sem ${p.semester}` : ""}` : ""}</span>
      {[88, 74, 82, 66].map((w, i) => <i key={i} className="printer-line" style={{ width: `${w}%` }} />)}
      <span className="flip-foot">Page {p.page} of {total}</span>
    </div>
  );
}

export default function PrinterAnimation({ phase, pages, flip = [] }) {
  const label = phase === "flipping" ? `${pages.toLocaleString()} page${pages === 1 ? "" : "s"} ready, sending to printer…`
    : `Preparing ${pages ? `${pages.toLocaleString()} page${pages === 1 ? "" : "s"}` : "the pages"}…`;
  return (
    <div className="modal-back printer-back" role="status" aria-live="polite">
      <div className="printer-card">
        {phase === "flipping" ? (
          <div className="flip-book">
            {flip.map((p, i) => <FlipPage key={p.page} p={p} total={pages} index={i} count={flip.length} />)}
          </div>
        ) : (
          <div className="printer loading">
            <div className="printer-feed-area"><div className="printer-in"><SheetFace lines={5} /></div></div>
            <div className="printer-body">
              <span className="printer-feed-slot" />
              <span className="printer-light" />
              <span className="printer-front-slot" />
            </div>
          </div>
        )}
        <p className="printer-label">{label}</p>
      </div>
    </div>
  );
}
