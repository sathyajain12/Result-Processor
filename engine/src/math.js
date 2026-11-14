export const isNum = v => typeof v === "number" && Number.isFinite(v);

export const isBlank = v => v === null || v === undefined || v === "";

export function roundSheets(x, digits = 0) {
  if (!isNum(x)) return null;
  const f = 10 ** digits;
  const scaled = Number((Math.abs(x) * f).toPrecision(15));
  return (Math.sign(x) * Math.floor(scaled + 0.5)) / f;
}

export function roundGpa(x) {
  return Math.round(x * 10) / 10;
}
