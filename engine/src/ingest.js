import { isNum, isBlank } from "./math.js";
import { semesterNumber } from "./cgpa.js";

const H = s => String(s ?? "").trim().toUpperCase();

function headerMap(headers, spec) {
  const map = {};
  headers.forEach((h, i) => {
    const u = H(h);
    for (const [field, aliases] of Object.entries(spec)) {
      if (map[field] === undefined && aliases.includes(u)) map[field] = i;
    }
  });
  return map;
}

function requireColumns(map, required, label, headers) {
  const missing = required.filter(k => map[k] === undefined);
  if (missing.length) {
    throw new Error(`${label}: missing column(s) ${missing.join(", ")}. Found: ${headers.filter(Boolean).join(", ")}`);
  }
}

export function normalizeRegdNo(raw) {
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "number") return String(Math.round(raw));
  const s = String(raw).trim();
  return /^\d+(\.\d+)?([eE][+-]?\d+)?$/.test(s) ? String(Math.round(Number(s))) : s;
}

const num = v => {
  if (isNum(v)) return v;
  if (isBlank(v)) return null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
};

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
export function normalizeSemester(v) {
  const s = String(v ?? "").trim().toUpperCase().replace(/^SEM(ESTER)?[-\s]*/, "");
  if (ROMAN.includes(s)) return s;
  const words = { FIRST: 1, SECOND: 2, THIRD: 3, FOURTH: 4, FIFTH: 5, SIXTH: 6, SEVENTH: 7, EIGHTH: 8 };
  const n = words[s] ?? Number(s);
  return Number.isInteger(n) && ROMAN[n] ? ROMAN[n] : s;
}

const MARK_SPEC = {
  regdNo: ["REGD. NO.", "REGD NO", "REGD.NO.", "REG NO", "REGD NO."],
  paperCode: ["PAPER CODE", "COURSE CODE", "COURSE CODE (CC)"],
  programme: ["PROGRAMME", "PROGRAM", "PROGRAMME CODE"],
  semester: ["SEMESTER", "SEM"],
  campus: ["CAMPUS"]
};

export function parseMarks(values, component) {
  if (!values?.length) return { rows: [], warnings: ["Sheet is empty"] };
  const headers = values[0];
  const spec = { ...MARK_SPEC, marks: [`${component} MARKS`, "MARKS", `${component} MARK`] };
  const map = headerMap(headers, spec);
  requireColumns(map, ["regdNo", "paperCode", "marks"], `${component} sheet`, headers);

  const rows = [];
  const seen = new Map();
  const warnings = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    const regdNo = normalizeRegdNo(r[map.regdNo]);
    const paperCode = String(r[map.paperCode] ?? "").trim().replace(/_IHA$/i, "");
    if (!regdNo || !paperCode) continue;
    const raw = r[map.marks];
    const k = `${regdNo}|${paperCode}`;
    if (seen.has(k) && String(seen.get(k)) !== String(raw ?? "")) {
      warnings.push(`Row ${i + 1}: duplicate ${regdNo} / ${paperCode} with a different mark (${seen.get(k)} vs ${raw}) — last one kept`);
    }
    seen.set(k, raw);
    rows.push({
      regdNo, paperCode, raw: raw === undefined ? null : raw,
      programme: map.programme !== undefined ? String(r[map.programme] ?? "").trim() : null,
      semester: map.semester !== undefined ? normalizeSemester(r[map.semester]) : null
    });
  }
  const dedup = new Map(rows.map(r => [`${r.regdNo}|${r.paperCode}`, r]));
  return { rows: [...dedup.values()], warnings };
}

const SMF_SPEC = {
  regdNo: ["REGD. NO.", "REGD NO", "REGD.NO.", "REG NO"],
  name: ["NAME"],
  campus: ["CAMPUS"],
  semester: ["SEMESTER"],
  programme: ["PROGRAMME CODE"],
  programmeName: ["PROGRAMME NAME", "PROGRAM NAME"],
  programmeShortName: ["PROGRAMME SHORT NAME", "PROGRAM SHORT NAME"],
  degree: ["DEGREE"],
  batch: ["BATCH"],
  semCredits: ["SEM-CREDITS", "SEM CREDITS", "SEMCREDITS", "SEMESTER CREDITS", "SEM_CREDITS"]
};
const ELECTIVE_KEYWORDS = ["IDM", "SEC", "DSE", "AEC", "MDC", "VBC", "VOC", "ELECTIVE"];

export function parseSMF(values) {
  if (!values?.length) throw new Error("SMF sheet is empty");
  const headers = values[0];
  const map = headerMap(headers, SMF_SPEC);
  requireColumns(map, ["regdNo", "name", "semester", "programme"], "SMF", headers);

  const electiveCols = [];
  headers.forEach((h, i) => {
    const u = H(h);
    if (Object.values(map).includes(i)) return;
    if (ELECTIVE_KEYWORDS.some(k => u.includes(k))) electiveCols.push(i);
  });

  const students = {};
  const warnings = [];
  if (map.batch === undefined) warnings.push("SMF has no Batch column — batch rerouting and CMF batch matching are disabled");
  if (map.semCredits === undefined) warnings.push("SMF has no Sem-Credits column — the credit-match (WITHHELD) check is disabled");

  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    const regdNo = normalizeRegdNo(r[map.regdNo]);
    if (!regdNo) continue;
    if (students[regdNo]) warnings.push(`Row ${i + 1}: ${regdNo} appears more than once — last row kept`);
    const electives = electiveCols.map(c => String(r[c] ?? "").trim()).filter(Boolean);
    students[regdNo] = {
      regdNo,
      name: String(r[map.name] ?? "").trim(),
      campus: map.campus !== undefined ? String(r[map.campus] ?? "").trim() : "",
      semester: normalizeSemester(r[map.semester]),
      programme: String(r[map.programme] ?? "").trim(),
      batch: map.batch !== undefined ? String(r[map.batch] ?? "").trim().replace(/\.0$/, "") : "",
      semCredits: map.semCredits !== undefined ? num(r[map.semCredits]) : null,
      electives: electiveCols.length ? electives : null
    };
  }
  return { students, warnings, electiveColumns: electiveCols.map(c => headers[c]) };
}

const CMF_SPEC = {
  programCode: ["PROGRAMME CODE"],
  programmeName: ["PROGRAMME NAME", "PROGRAM NAME"],
  programmeShortName: ["PROGRAMME SHORT NAME", "PROGRAM SHORT NAME"],
  degree: ["DEGREE"],
  semester: ["SEMESTER"],
  courseCode: ["COURSE CODE", "COURSE CODE (CC)"],
  courseTitle: ["COURSE TITLE", "TITLE"],
  courseType: ["COURSE TYPE", "T / P", "TYPE"],
  credits: ["CREDITS", "CREDIT", "COURSE CREDITS"],
  category: ["COURSE CATEGORY", "CATEGORY"],
  sequence: ["SEQUENCE", "SEQ", "SEQ NO", "SEQ."],
  cieMax: ["CIE MAX", "CIE MARKS"],
  eseMax: ["ESE MAX", "ESE MARKS"],
  calcType: ["EXAM TYPE", "EXAM", "CALCULATION TYPE"],
  teachingDept: ["TEACHING DEPARTMENT"],
  cieWtg: ["CIE WTG"],
  eseWtg: ["ESE WTG"],
  batch: ["BATCH"]
};

const ARTS = ["BAH-E", "BAHR-E", "BAH-ELL", "BAHR-ELL", "BBAH", "MA-E", "MA-ELL", "BCOMH", "BCOMHR", "BED", "BPA-M", "BPAH-M", "MBA"];
const SCIENCE = ["BSH-", "BSHR-", "MSC-", "MTECH-"];

export function programmeType(code) {
  const c = String(code).toUpperCase().trim();
  if (ARTS.some(p => c === p || c.includes(p))) return "Arts";
  if (SCIENCE.some(p => c.includes(p))) return "Science";
  return "Other";
}

const maxValue = v => (H(v) === "NC" ? 0 : num(v));

export function parseCMF(values) {
  if (!values?.length) throw new Error("CMF sheet is empty");
  const headers = values[0];
  const map = headerMap(headers, CMF_SPEC);
  requireColumns(map, ["programCode", "semester", "courseCode", "courseTitle", "category"], "CMF", headers);

  const warnings = [];
  if (map.calcType === undefined) warnings.push("CMF has no Exam Type / Calculation Type column — every course will be an error");
  if (map.cieWtg === undefined || map.eseWtg === undefined) warnings.push("CMF has no CIE WTG / ESE WTG columns — weightage falls back to 50/50");

  const records = [];
  let swayamNC = 0;
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    const raw = String(r[map.courseCode] ?? "").trim();
    if (!raw) continue;
    const teachingDept = map.teachingDept !== undefined ? String(r[map.teachingDept] ?? "").trim().toUpperCase() : "";
    if (teachingDept.includes("SWAYAM NC")) { swayamNC++; continue; }
    const code = raw.replace(/_IHA$/i, "");
    const isAssign = /_ASSIGN$/i.test(code);
    const cieW = map.cieWtg !== undefined ? num(r[map.cieWtg]) : null;
    const eseW = map.eseWtg !== undefined ? num(r[map.eseWtg]) : null;
    records.push({
      row: i + 1,
      baseCode: isAssign ? code.replace(/_ASSIGN$/i, "") : code,
      isAssign,
      isIha: code !== raw,
      programCode: String(r[map.programCode] ?? "").trim(),
      semester: normalizeSemester(r[map.semester]),
      title: String(r[map.courseTitle] ?? "").trim(),
      courseType: map.courseType !== undefined ? String(r[map.courseType] ?? "").trim() : "",
      credits: map.credits !== undefined ? num(r[map.credits]) ?? 0 : 0,
      category: String(r[map.category] ?? "").trim(),
      sequence: map.sequence !== undefined ? String(r[map.sequence] ?? "") : "",
      cieMax: map.cieMax !== undefined ? maxValue(r[map.cieMax]) : null,
      eseMax: map.eseMax !== undefined ? maxValue(r[map.eseMax]) : null,
      calcType: map.calcType !== undefined ? num(r[map.calcType]) : null,
      teachingDept,
      cieWeight: isNum(cieW) ? cieW / 100 : null,
      eseWeight: isNum(eseW) ? eseW / 100 : null,
      batch: map.batch !== undefined ? String(r[map.batch] ?? "").trim().replace(/\.0$/, "") : ""
    });
  }

  const originalCode = r => r.baseCode + (r.isAssign ? "_ASSIGN" : "");
  const counts = new Map();
  for (const r of records) counts.set(originalCode(r), (counts.get(originalCode(r)) || 0) + 1);

  // An _IHA row is the in-house assignment of the paper of the same code. Its credits are added to that paper, which is
  // graded on its one set of marks. Main rows go first so the paper keeps its own title and maximums whatever the CMF order.
  // A paper shared by several programmes has an _IHA row for each, but they are one assignment, so its credits count once.
  const courses = new Map();
  const ihaCredits = new Map();
  const ihaCieMax = new Map();
  const ihaOnly = new Set();
  for (const r of [...records.filter(x => !x.isIha), ...records.filter(x => x.isIha)]) {
    let code = r.baseCode;
    if (counts.get(originalCode(r)) > 1) {
      const t = programmeType(r.programCode);
      code = `${r.baseCode}${t === "Other" ? "" : "-" + t}-Sem-${r.semester}-${r.category}`;
    }
    const existing = courses.get(code);
    if (!existing) {
      if (r.isIha) ihaOnly.add(code);
      courses.set(code, {
        code, baseCode: r.baseCode, title: r.title, programmes: new Set(r.programCode.split("/").map(p => p.trim()).filter(Boolean)),
        semester: r.semester, batches: new Set(r.batch ? [r.batch] : []), category: r.category, credits: r.credits,
        cieMax: r.cieMax, eseMax: r.eseMax, cieWeight: r.cieWeight, eseWeight: r.eseWeight, calcType: r.calcType,
        courseType: r.courseType, teachingDept: r.teachingDept, sequence: r.sequence
      });
    } else {
      if (r.isAssign && r.credits > 0) existing.credits += r.credits;
      if (r.isIha && !ihaOnly.has(code)) {
        ihaCredits.set(code, Math.max(ihaCredits.get(code) || 0, r.credits));
        if (isNum(r.cieMax) && r.cieMax > 0) ihaCieMax.set(code, Math.max(ihaCieMax.get(code) || 0, r.cieMax));
      }
      r.programCode.split("/").map(p => p.trim()).filter(Boolean).forEach(p => existing.programmes.add(p));
      if (r.batch) existing.batches.add(r.batch);
    }
  }
  for (const [code, credits] of ihaCredits) courses.get(code).credits += credits;
  // A CIE-only paper (no ESE, e.g. UCES-001(ugc26_ge10): in-house exam 50 + in-house assignment 50) is marked as one CIE
  // out of both maximums, so the _IHA CIE maximum is added too, once. A paper with an ESE (the SWAYAM portal exams, CIE 25 /
  // ESE 75) keeps its own maximums: its CIE marks are entered out of its own CIE maximum.
  for (const [code, cieMax] of ihaCieMax) {
    const c = courses.get(code);
    if (!(isNum(c.eseMax) && c.eseMax > 0) && isNum(c.cieMax)) c.cieMax += cieMax;
  }

  const list = [...courses.values()].map(c => ({
    ...c,
    programmes: [...c.programmes].sort().join("/"),
    batches: [...c.batches].sort()
  }));

  for (const c of list) {
    if (c.calcType === 2 && (!isNum(c.cieWeight) || !isNum(c.eseWeight)) && map.cieWtg !== undefined) {
      warnings.push(`${c.code}: CIE/ESE weightage missing in CMF`);
    }
  }
  return { courses: list, warnings, skipped: { swayamNC } };
}

export function programmeDefaults(code) {
  const c = String(code).toUpperCase();
  const d = { passCategory: 1, cieNP: "I-A", eseNP: "I-A", combNP: "I-A", gradeTable: "II-B" };
  if (/(FIRST|SECOND|THIRD) UG/.test(c)) return { ...d, gradeTable: null };
  if (/(FIRST|SECOND) PG/.test(c)) return { ...d, passCategory: 2, gradeTable: null };
  if (/(FIRST|SECOND) M\.TECH/.test(c)) return { ...d, passCategory: 3, cieNP: "I-B", eseNP: "I-B", combNP: "I-B", gradeTable: null };
  if (c.includes("MTECH")) return { ...d, passCategory: 3, cieNP: "I-B", eseNP: "I-B", combNP: "I-B", gradeTable: "II-A" };
  if (c.includes("MA-") || c.includes("MSC-") || c.includes("MBA")) return { ...d, passCategory: 2, gradeTable: c.includes("MSC-") ? "II-A" : "II-B" };
  if (c.includes("BSH-") || c.includes("BSHR-")) return { ...d, gradeTable: "II-A" };
  return d;
}

const PREV_SPEC = { regdNo: ["REGD. NO.", "REGD NO", "REGD.NO.", "REG NO"] };

export function parsePrevious(values) {
  if (!values?.length) return { rows: [], warnings: [] };
  const headers = values[0];
  const map = headerMap(headers, PREV_SPEC);
  requireColumns(map, ["regdNo"], "Previous semester sheet", headers);
  const semCols = {};
  headers.forEach((h, i) => {
    const m = H(h).match(/^S(\d{2})_(EARNEDCRXNP|EARNEDCREDS|GPA)$/);
    if (m) (semCols[Number(m[1])] ||= {})[m[2]] = i;
  });
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    const regdNo = normalizeRegdNo(r[map.regdNo]);
    if (!regdNo) continue;
    for (const [sem, cols] of Object.entries(semCols)) {
      const credits = num(r[cols.EARNEDCREDS]);
      if (!isNum(credits) || credits <= 0) continue;
      rows.push({ regdNo, semesterNo: Number(sem), creditNP: num(r[cols.EARNEDCRXNP]), credits, gpa: num(r[cols.GPA]) });
    }
  }
  return { rows, warnings: [] };
}

// Port of populateIntegralItems (Apps Script ReferenceData). A standalone report: it does not feed GPA.
// files: [{ name, values }] in load order, values = the file's "Consolidated" tab or null when the tab is missing.
const INTEGRAL_HEADERS = { regdNo: "Regd.No.", item1: "Item-1-NP", item2: "Item-2-NP", item3: "Item-3-NP", item4: "Item-4-NP", item5: "Item-5-NP" };
export const INTEGRAL_FILE_MARKER = "Integral Items-Data Entry";

// Same as the sheet: falsy cells (including 0) and anything parseFloat cannot read become "X".
export function integralItemValue(value) {
  if (!value) return "X";
  const str = String(value).trim();
  if (str === "") return "X";
  const n = parseFloat(str);
  return isNaN(n) ? "X" : n;
}

export function parseIntegralItems(files, { checkNames = true } = {}) {
  const byRegd = new Map();
  const report = [];
  const warnings = [];
  for (const { name, values } of files) {
    if (checkNames && !String(name).includes(INTEGRAL_FILE_MARKER)) warnings.push(`${name}: file name does not contain "${INTEGRAL_FILE_MARKER}"`);
    if (!values) { report.push({ name, rows: 0, skipped: true, reason: 'No "Consolidated" tab' }); continue; }
    if (values.length < 2) { report.push({ name, rows: 0, skipped: true, reason: "No data rows" }); continue; }
    const col = {};
    values[0].forEach((h, i) => {
      const key = Object.keys(INTEGRAL_HEADERS).find(k => INTEGRAL_HEADERS[k] === String(h ?? "").trim());
      if (key) col[key] = i;
    });
    const missing = Object.keys(INTEGRAL_HEADERS).filter(k => col[k] === undefined).map(k => INTEGRAL_HEADERS[k]);
    if (missing.length) { report.push({ name, rows: 0, skipped: true, reason: `Missing column(s) ${missing.join(", ")}` }); continue; }
    let rows = 0;
    for (let i = 1; i < values.length; i++) {
      const r = values[i];
      const regdNo = normalizeRegdNo(r[col.regdNo]);
      if (!regdNo) continue;
      if (byRegd.has(regdNo) && byRegd.get(regdNo).sourceFile !== name) warnings.push(`${regdNo}: also in ${byRegd.get(regdNo).sourceFile}; using ${name}`);
      const items = [1, 2, 3, 4, 5].map(k => integralItemValue(r[col[`item${k}`]]));
      const numeric = items.filter(v => v !== "X");
      byRegd.set(regdNo, {
        regdNo, items, sourceFile: name,
        total: Math.round(numeric.reduce((a, b) => a + b, 0) * 100) / 100,
        count: numeric.length
      });
      rows++;
    }
    report.push({ name, rows, skipped: false, reason: null });
  }
  const rows = [...byRegd.values()].sort((a, b) => a.regdNo.localeCompare(b.regdNo));
  return { rows, files: report, warnings };
}

export function buildReference({ npTables, gradeTables, weightage, programmes, courses }) {
  const programmeOf = code => {
    if (programmes[code]) return programmes[code];
    const explicit = String(code).split("/").map(p => p.trim()).find(p => programmes[p]?.customised);
    return explicit ? programmes[explicit] : programmeDefaults(code);
  };
  const enriched = courses.map(c => {
    const p = programmeOf(c.programmes);
    return {
      ...c,
      cieNP: p.cieNP, eseNP: p.eseNP, combNP: p.combNP,
      passCategory: p.passCategory,
      weightageCategory: 1
    };
  });
  const programmeMap = new Proxy({ ...programmes }, {
    get: (t, k) => (typeof k === "string" ? t[k] ?? programmeOf(k) : t[k])
  });
  return { npTables, gradeTables, weightage, programmes: programmeMap, courses: enriched };
}

export { semesterNumber };
