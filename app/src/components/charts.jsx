// Small single-series charts in plain HTML/SVG. Every chart sits next to a table with the same numbers.

// Horizontal bars: [{ label, value, display?, tone?: "fail", title? }]. Scaled to the largest value unless `max` is given.
export function BarList({ items, max, empty = "Nothing to show yet." }) {
  if (!items.length) return <p className="muted small">{empty}</p>;
  const top = max ?? Math.max(1, ...items.map(i => i.value || 0));
  return (
    <div className="bar-list">
      {items.map(i => (
        <div key={i.label} className={i.tone || ""} title={i.title || `${i.label}: ${i.display ?? i.value}`}>
          <span className="label">{i.label}</span>
          <span className="track"><i style={{ width: `${Math.max(0, Math.min(100, ((i.value || 0) / top) * 100))}%` }} /></span>
          <span className="num">{i.display ?? i.value}</span>
        </div>
      ))}
    </div>
  );
}

// GPA histogram on a fixed 0–10 axis: bins = [{ from, to, count }].
export function Histogram({ bins, height = 140 }) {
  const total = bins.reduce((n, b) => n + b.count, 0);
  if (!total) return <p className="muted small">No passing GPAs yet.</p>;
  const w = 400, pad = 18, bw = (w - 8) / bins.length, top = Math.max(...bins.map(b => b.count));
  const y = c => (height - pad) - (c / top) * (height - pad - 8);
  return (
    <svg className="chart" viewBox={`0 0 ${w} ${height}`} role="img" aria-label={`GPA distribution of ${total} passing students`}>
      <line className="axis" x1="4" x2={w - 4} y1={height - pad} y2={height - pad} />
      {bins.map((b, i) => b.count > 0 && (
        <g key={i} className="hit">
          <rect x={4 + i * bw} y="0" width={bw} height={height - pad} fill="transparent" />
          <path className="mark" d={roundedTop(4 + i * bw + 1, y(b.count), bw - 2, height - pad - y(b.count))} />
          <title>{`GPA ${b.from.toFixed(1)}–${b.to === 10 ? "10.0" : (b.to - 0.1).toFixed(1)}: ${b.count} student${b.count === 1 ? "" : "s"}`}</title>
        </g>
      ))}
      {[0, 2, 4, 6, 8, 10].map(t => <text key={t} className="tick" x={4 + (t * 2) * bw} y={height - 4} textAnchor={t === 0 ? "start" : t === 10 ? "end" : "middle"}>{t}</text>)}
    </svg>
  );
}

// Column with a 4px rounded top, anchored square to the baseline.
function roundedTop(x, y, w, h) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

// GPA spread on a 0–10 scale: whiskers min–max, box q1–q3, tick at the median.
export function BoxRow({ s, width = 160 }) {
  if (!s?.n) return <span className="faint">—</span>;
  const x = v => 2 + (v / 10) * (width - 4);
  return (
    <svg className="chart box-row" viewBox={`0 0 ${width} 16`} width={width} height="16" role="img"
      aria-label={`GPA min ${s.min}, quartiles ${s.q1} to ${s.q3}, median ${s.median}, max ${s.max}`}>
      <title>{`Min ${s.min}, Q1 ${s.q1}, median ${s.median}, Q3 ${s.q3}, max ${s.max}`}</title>
      <line className="axis" x1="2" x2={width - 2} y1="8" y2="8" />
      <line className="whisker" x1={x(s.min)} x2={x(s.max)} y1="8" y2="8" />
      <rect className="mark" x={x(s.q1)} y="3" width={Math.max(2, x(s.q3) - x(s.q1))} height="10" rx="2" />
      <line className="median" x1={x(s.median)} x2={x(s.median)} y1="1" y2="15" />
    </svg>
  );
}
