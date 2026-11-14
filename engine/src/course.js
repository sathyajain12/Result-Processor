const parts = s => String(s || "").split("/").map(p => p.trim()).filter(Boolean);

const COHORT = /^(First|Second|Third|Fourth)\s+(UG|PG|M\.?\s?Tech\.?)$/i;

export function programmeLevel(programme) {
  const p = parts(programme)[0]?.toUpperCase().replace(/[\s.]/g, "") || "";
  if (p.startsWith("MTECH")) return "MTECH";
  if (/^(MA|MSC|MBA)(-|$)/.test(p)) return "PG";
  if (/^B/.test(p) && !/^BED/.test(p)) return "UG";
  return null;
}

export function isCohortProgramme(name) {
  return COHORT.test(String(name).trim());
}

function cohortMatches(name, studentProgramme) {
  const m = String(name).trim().match(COHORT);
  if (!m) return false;
  const level = m[2].toUpperCase().replace(/[\s.]/g, "");
  return programmeLevel(studentProgramme) === (level === "UG" ? "UG" : level === "PG" ? "PG" : "MTECH");
}

export function programmesMatch(courseProgrammes, studentProgramme) {
  const sp = new Set(parts(studentProgramme));
  return parts(courseProgrammes).some(p => sp.has(p) || cohortMatches(p, studentProgramme));
}

// The order a student's papers are listed and graced in (seriatim): the CMF Sequence, then course code. Each side is { sequence, code }.
const codeOrder = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
const sequenceOf = v => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? Infinity : Number(v));
export function seriatimOrder(a, b) {
  const x = sequenceOf(a.sequence), y = sequenceOf(b.sequence);
  return x === y ? codeOrder.compare(String(a.code), String(b.code)) : x < y ? -1 : 1;
}

export function buildCourseIndex(courses) {
  const byCode = new Map();
  const byPrefix = new Map();

  courses.forEach((c, order) => {
    const entry = { course: c, order };
    byCode.set(c.code, entry);
    let i = c.code.indexOf("-");
    while (i > 0) {
      const prefix = c.code.slice(0, i);
      if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
      byPrefix.get(prefix).push(entry);
      i = c.code.indexOf("-", i + 1);
    }
  });

  return { courses, byCode, byPrefix };
}

export function resolveCourse(index, paperCode, student) {
  const exact = index.byCode.get(paperCode);
  const candidates = [...(exact ? [exact] : []), ...(index.byPrefix.get(paperCode) || [])];
  if (!candidates.length) return { course: null, method: "unresolved", candidates: 0 };

  const sem = student?.semester;

  let best = null;
  for (const e of candidates) {
    const progMatch = programmesMatch(e.course.programmes, student?.programme);
    const semMatch = e.course.semester === sem;
    const score = (progMatch ? 2 : 0) + (semMatch ? 1 : 0) + (e === exact ? 0.5 : 0);
    if (!best || score > best.score || (score === best.score && e.order < best.e.order)) {
      best = { e, score, progMatch, semMatch };
    }
  }

  const method = best.progMatch && best.semMatch ? "programme-semester"
    : best.progMatch ? "programme-only"
    : best.semMatch ? "semester-only"
    : "fallback";

  return { course: best.e.course, method, candidates: candidates.length };
}

const globToRegex = pattern =>
  new RegExp("^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$", "i");

export function resolveCourseLegacy(index, paperCode, student) {
  const re = globToRegex(`${paperCode}*${student?.semester ?? ""}*`);
  const hit = index.courses.find(c => re.test(c.code));
  if (hit) return { course: hit, method: "legacy-wildcard" };
  const exact = index.byCode.get(paperCode);
  return exact ? { course: exact.course, method: "legacy-exact" } : { course: null, method: "unresolved" };
}
