// The stored form of a computed paper (student_results.papers) and back again.

export const COURSE_SNAPSHOT = ["code", "title", "semester", "credits", "cieMax", "eseMax", "cieWeight", "eseWeight", "weightageCategory", "passCategory", "calcType", "cieNP", "eseNP", "combNP"];

export function compactPaper(p) {
  const course = p.course;
  const r = p.result;
  return {
    paperCode: p.paperCode, courseCode: p.courseCode, title: p.courseTitle, resolution: p.resolution, expectedOnly: p.expectedOnly,
    cie: p.cieRaw, ese: p.eseRaw, overrides: p.overrides,
    course: course ? Object.fromEntries(COURSE_SNAPSHOT.map(k => [k, course[k] ?? null])) : null,
    ciePct: r.ciePct, cieNP: r.cieNP, eseComptPct: r.eseComptPct, eseNP: r.eseNP, combPct: r.combPct, combNP: r.combNP,
    credits: r.credits, status: r.status, reasons: r.reasons,
    ...(p.origin ? { origin: p.origin } : {}),
    ...(p.replaced ? { replaced: p.replaced } : {}),
    ...(p.grace ? { grace: p.grace } : {})
  };
}

// Back to the shape processSession produces, so computeStudent can use a stored paper again.
export function expandPaper(c) {
  return {
    paperCode: c.paperCode, courseCode: c.courseCode, courseTitle: c.title, course: c.course, resolution: c.resolution,
    expectedOnly: !!c.expectedOnly, cieRaw: c.cie, eseRaw: c.ese, overrides: c.overrides ?? null,
    result: {
      ciePct: c.ciePct, cieNP: c.cieNP, eseComptPct: c.eseComptPct, eseNP: c.eseNP, combPct: c.combPct, combNP: c.combNP,
      credits: c.credits, status: c.status, reasons: c.reasons || []
    },
    ...(c.origin ? { origin: c.origin } : {}),
    ...(c.replaced ? { replaced: c.replaced } : {}),
    ...(c.grace ? { grace: c.grace } : {})
  };
}
