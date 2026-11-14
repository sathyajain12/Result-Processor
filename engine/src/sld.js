import { normalizePaperCode } from "./session.js";

// SLD (Specific Learning Disability) students write a separate paper, set out of its own maximum (often 50 or 60 where the
// regular paper is out of 100). Their marks come from a separate Marks Statement whose course code ends in SLD, such as
// "UPOL-101_SLD" or "UELL-502-SLD", and are stored under the paper's own code. Each such sheet's maximum becomes that
// student's maximum for that paper, so 37 out of 60 is graded as 62%, not 37%.

export const isSldCode = code => /[-_\s]SLD\s*$/i.test(String(code ?? ""));

// Mark sheets -> course-field overrides, per student and paper: { cieMax | eseMax } plus sldCieMax | sldEseMax, which only
// labels the paper (the Grade register remarks on it). They go before any admin edit, so an edit on the student page wins.
//   sheets: [{ courseCode, component: "CIE" | "ESE", maxMarks, keys: ["<regd>|<paper code>", ...] }]
export function sldOverrides(sheets) {
  const out = [];
  for (const s of sheets) {
    const max = Number(s.maxMarks);
    if (!isSldCode(s.courseCode) || !Number.isFinite(max) || max <= 0) continue;
    const comp = s.component === "CIE" ? "Cie" : s.component === "ESE" ? "Ese" : null;
    if (!comp) continue;
    for (const key of s.keys || []) {
      const [regdNo, raw] = String(key).split("|");
      const paperCode = normalizePaperCode(raw);   // the same form the engine keys marks by
      if (!regdNo || !paperCode) continue;
      const base = { type: "course-field", regdNo, paperCode, reason: `SLD Marks Statement ${String(s.courseCode).trim()}`, sld: true };
      out.push({ ...base, field: `${comp.toLowerCase()}Max`, value: max }, { ...base, field: `sld${comp}Max`, value: max });
    }
  }
  return out;
}
