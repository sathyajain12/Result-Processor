import { STATUS } from "./constants.js";
import { computeStudent, STUDENT_STATE } from "./student.js";
import { finalizeSession, courseGroup, normalizePaperCode, EXCEPTION, SEVERITY } from "./session.js";
import { expandPaper } from "./compact.js";

// Builds supplementary results: each student's approved result in the base session, with the papers they
// re-appeared for replaced by the supplementary attempt (always, even when the new attempt is worse).
//   supp      processSession output for the supplementary session (graded without CMF expectations)
//   base      Map regdNo -> { sessionId, approvedAt, approvedBy, runId, digest, batchKey, sumCredits, publishedGPA, papers (stored form) }
//   students  supplementary SMF, keyed by regdNo
// The base results are only read, never changed. Returns { batches, results, exceptions } like processSession.
export function mergeSupplementary({ supp, base, students, reference, overrides = [] }) {
  const exceptions = [...supp.exceptions];
  const raise = (code, severity, scope, message, details = {}) =>
    exceptions.push({ code, severity, batchKey: null, regdNo: null, paperCode: null, courseCode: null, ...scope, message, details });

  const results = supp.results.map(r => {
    const scope = { batchKey: r.batchKey, regdNo: r.regdNo };
    const b = base.get(r.regdNo);
    const suppPapers = r.papers.map(p => ({ ...p, origin: "supp" }));

    if (!b) {
      raise(EXCEPTION.SUPP_NO_BASE_RESULT, SEVERITY.BLOCK, scope, "No approved result in the base session to build on");
      const s = computeStudent(students[r.regdNo], suppPapers, reference, { semCredits: null });
      // Held whatever happens to the exception: a GPA from the re-appeared papers alone is never a semester result.
      return { ...s, state: STUDENT_STATE.HELD, reasons: ["No approved result in the base session", ...s.reasons],
        batchKey: r.batchKey, effectiveBatch: r.effectiveBatch, papers: suppPapers, grace: r.grace, supplementary: null };
    }

    const merged = b.papers.map(p => ({ ...expandPaper(p), origin: "base" }));
    const keys = p => [normalizePaperCode(p.paperCode), p.courseCode, courseGroup(p.courseCode || p.paperCode)];
    const replaced = [];

    if (!suppPapers.length) {
      raise(EXCEPTION.SUPP_NOTHING_REAPPEARED, SEVERITY.BLOCK, scope, "In the supplementary SMF but no supplementary marks were received");
    }
    for (const p of suppPapers) {
      const [code, courseCode, group] = keys(p);
      let i = merged.findIndex(m => m.origin === "base" && normalizePaperCode(m.paperCode) === code);
      if (i < 0 && courseCode) i = merged.findIndex(m => m.origin === "base" && m.courseCode === courseCode);
      if (i < 0) i = merged.findIndex(m => m.origin === "base" && courseGroup(m.courseCode || m.paperCode) === group);
      const pScope = { ...scope, paperCode: p.paperCode, courseCode: p.courseCode };
      if (i < 0) {
        // Never appended: an extra paper would change the semester's credits. Accepting the exception drops it.
        raise(EXCEPTION.SUPP_PAPER_NOT_IN_BASE, SEVERITY.BLOCK, pScope, `${p.paperCode} is not in the student's approved result for the base session`);
        continue;
      }
      const old = merged[i];
      if (old.result.status === STATUS.PASS) {
        raise(EXCEPTION.SUPP_REAPPEAR_PASSED, SEVERITY.WARN, pScope, `${p.paperCode} was already passed in the base session (${old.result.combPct}%); the supplementary attempt replaces it`);
      }
      merged[i] = { ...p, replaced: { paperCode: old.paperCode, combPct: old.result.combPct, combNP: old.result.combNP, status: old.result.status } };
      replaced.push(p.paperCode);
    }

    const s = computeStudent(students[r.regdNo], merged, reference, { semCredits: null });
    if (b.sumCredits !== null && b.sumCredits !== undefined && s.sumCredits !== b.sumCredits) {
      raise(EXCEPTION.SUPP_CREDITS_CHANGED, SEVERITY.WARN, scope, `Credits ${s.sumCredits} differ from ${b.sumCredits} in the base result`);
    }
    if (b.batchKey && b.batchKey !== r.batchKey) {
      raise(EXCEPTION.SUPP_BATCH_DIFFERS, SEVERITY.WARN, scope, `Batch ${r.batchKey.replaceAll("|", " ")} differs from ${b.batchKey.replaceAll("|", " ")} in the base session`);
    }
    return {
      ...s, batchKey: r.batchKey, effectiveBatch: r.effectiveBatch, papers: merged, grace: r.grace,
      supplementary: { baseSessionId: b.sessionId, baseApprovedAt: b.approvedAt ?? null, baseApprovedBy: b.approvedBy ?? null, baseRunId: b.runId, baseDigest: b.digest, baseGpa: b.publishedGPA, replaced }
    };
  });

  return finalizeSession(results, exceptions, overrides);
}
