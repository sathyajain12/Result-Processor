import * as E from "../engine/src/index.js";

const FIELDS = ["cieMax", "eseMax", "weightageCategory", "passCategory", "calcType", "credits"];

export function legacyOverrides(fx) {
  const index = E.buildCourseIndex(fx.reference.courses);
  const out = [];
  for (const p of fx.papers) {
    const manual = p.manual.filter(f => FIELDS.includes(f));
    if (!manual.length) continue;
    const { course } = E.resolveCourse(index, p.paperCode, fx.students[p.regdNo]);
    for (const field of manual) {
      if (course && course[field] === p[field]) continue;
      out.push({ type: "course-field", regdNo: p.regdNo, paperCode: p.paperCode, field, value: p[field],
        reason: `Imported from legacy sheet: hand-typed ${field} = ${p[field]} (CMF: ${course?.[field] ?? "none"})` });
    }
  }
  return out;
}
