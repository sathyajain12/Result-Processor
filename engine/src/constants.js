export const NP_NONE = "--";
export const FAIL_4 = "< 4";
export const FAIL_5 = "< 5";
export const NP_ERROR = "#ERR";

export const STATUS = Object.freeze({
  PASS: "Pass",
  FAIL: "Fails",
  ABSENT: "Absent",
  PENDING: "Pending",
  ERROR: "Error",
  BLANK: ""
});

export const CALC_TYPE = Object.freeze({
  CIE_FROM_COMPONENTS: 1,
  CIE_AND_ESE: 2,
  CIE_ONLY: 3,
  ESE_ONLY: 4,
  NON_CREDIT: 5
});

export const POLICY = Object.freeze({
  LEGACY: Object.freeze({ missingMark: "fail", incompleteCourse: "blank", invalidMark: "compute" }),
  DEFAULT: Object.freeze({ missingMark: "pending", incompleteCourse: "error", invalidMark: "hold" })
});

export const isFailToken = v => v === FAIL_4 || v === FAIL_5;
