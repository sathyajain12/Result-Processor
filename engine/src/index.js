import { buildCourseIndex, resolveCourse, resolveCourseLegacy } from "./course.js";
import { computePaper } from "./paper.js";
import { computeStudent } from "./student.js";
import { POLICY } from "./constants.js";

export * from "./constants.js";
export { buildCourseIndex, resolveCourse, resolveCourseLegacy, computePaper, computeStudent };
export { STUDENT_STATE } from "./student.js";
export { lookupNP, letterGrade } from "./tables.js";
export { roundSheets, roundGpa } from "./math.js";

export function processBatch({ reference, students, marks, semCredits = {}, policy = POLICY.DEFAULT }) {
  const index = buildCourseIndex(reference.courses);
  const byStudent = new Map();
  const unknownStudents = [];

  for (const m of marks) {
    const student = students[m.regdNo];
    if (!student) { unknownStudents.push(m); continue; }

    const { course, method } = resolveCourse(index, m.paperCode, student);
    const result = computePaper(m, course, reference, policy);
    const paper = { ...m, courseCode: course?.code ?? null, resolution: method, result };

    if (!byStudent.has(m.regdNo)) byStudent.set(m.regdNo, []);
    byStudent.get(m.regdNo).push(paper);
  }

  const results = [];
  for (const [regdNo, papers] of byStudent) {
    results.push({ ...computeStudent(students[regdNo], papers, reference, { semCredits: semCredits[regdNo] }), papers });
  }

  return { results, unknownStudents };
}
export { processSession, finalizeSession, DEFAULT_THRESHOLDS, normalizeMark, normalizePaperCode, batchKey, isNptel, courseGroup, SEVERITY, EXCEPTION } from "./session.js";
export { computeCgpa, semesterNumber, CGPA_STATUS } from "./cgpa.js";
export { programmesMatch, programmeLevel, isCohortProgramme } from "./course.js";
export const ENGINE_VERSION = "1.1.0";
export * from "./ingest.js";
export { compactPaper, expandPaper, COURSE_SNAPSHOT } from "./compact.js";
export { mergeSupplementary } from "./supplementary.js";
export { applyGrace, gracePoolOf, supplementaryGrace, isPostgraduate, passMarks } from "./grace.js";
export { registerEntry, searchTerms } from "./register.js";
export { sldOverrides, isSldCode } from "./sld.js";
export { nonCreditCourses } from "./session.js";
export { seriatimOrder } from "./course.js";
