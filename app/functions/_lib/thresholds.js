import { DEFAULT_THRESHOLDS } from "../../../engine/src/index.js";
import { parseJson } from "./db.js";

// Completeness rules a session may change. Values are fractions (0.75 = 75%).
export const THRESHOLD_LIMITS = {
  lowMarkRatio: { min: 0, max: 0.5 }
};

// The stored JSON may carry who/when; the engine only gets the known rules, filled in from the defaults.
export function effectiveThresholds(stored) {
  const s = typeof stored === "string" ? parseJson(stored, {}) : stored || {};
  return Object.fromEntries(Object.keys(DEFAULT_THRESHOLDS).map(k => [k, typeof s[k] === "number" ? s[k] : DEFAULT_THRESHOLDS[k]]));
}

export { DEFAULT_THRESHOLDS };
