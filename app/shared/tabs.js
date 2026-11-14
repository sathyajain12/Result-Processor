// Which tabs of the portal a person may open. An admin decides per person on the People page; the role (viewer, operator,
// admin) still decides what they may do there. Shared by the page (menu, routes) and the server (which refuses the data
// of a tab the person may not open).
//   users.tabs  NULL: every tab (the default, and always for admins); else a JSON list of tab keys.

export const TABS = [
  { key: "sources", label: "Data sources", group: "Prepare", path: "sources" },
  { key: "marksheets", label: "Mark sheets", group: "Prepare", path: "marksheets" },
  { key: "integral", label: "Integral Items", group: "Prepare", path: "integral" },
  { key: "batches", label: "Batches", group: "Check", path: "", note: "the batch list, batch pages, approvals and downloads" },
  { key: "completeness", label: "Completeness", group: "Check", path: "completeness" },
  { key: "issues", label: "Issues", group: "Check", path: "issues" },
  { key: "analytics", label: "Analytics", group: "Check", path: "analytics" },
  { key: "final", label: "Final output", group: "Release", path: "final" },
  { key: "failures", label: "Failures", group: "Release", path: "failures" },
  { key: "grace", label: "Gracing", group: "Release", path: "grace" },
  { key: "register", label: "Grade register", group: "Release", path: "register" },
  { key: "history", label: "Runs and audit", group: "Settings", path: "history" },
  { key: "reference", label: "Grading rules", group: "Settings", path: "reference" },
  { key: "students", label: "Student pages", group: "Students", path: null, note: "the student search and each student's page" }
];
export const TAB_KEYS = new Set(TABS.map(t => t.key));

// The stored value as a list of keys, or null for every tab.
export function parseTabs(v) {
  if (v === null || v === undefined || v === "") return null;
  try {
    const list = JSON.parse(v);
    return Array.isArray(list) ? list.filter(k => TAB_KEYS.has(k)) : null;
  } catch { return null; }
}

export const canSee = (user, tab) => !!user && (user.role === "admin" || !Array.isArray(user.tabs) || user.tabs.includes(tab));
export const allowedTabs = user => TABS.filter(t => canSee(user, t.key));

// Server side: the tabs that open an endpoint under /api/sessions/<sid>/ (any one is enough), or null when every signed-in
// person may call it (the session summary, the lock). `rest` is the path after the session id, e.g. "batches/12".
const ANY_RESULTS = ["batches", "completeness", "issues", "marksheets", "sources", "students"];
export function tabsForPath(rest) {
  const parts = String(rest || "").split("/").filter(Boolean);
  const head = parts[0] || "";
  switch (head) {
    case "": case "lock": return null;
    case "batches": return ["batches"];
    case "completeness": return ["completeness"];
    case "exceptions": return ["issues"];
    case "analytics": return ["analytics"];
    case "final": return ["final"];
    case "failures": return ["failures"];
    case "grace": return ["grace"];
    case "register": return ["register"];
    case "marksheets": return ["marksheets"];
    case "integral": return ["integral"];
    case "runs": case "audit": return ["history"];
    case "thresholds": return ["reference"];
    case "sources": case "import": case "courses": return ["sources"];
    case "sync": return ["sources", "batches"];   // Sync from Google Sheets is on Data sources and the Batches list
    case "students": return parts[2] === "detention" ? ["students", "completeness"] : ["students"];
    // Edits are made from a student's page, a batch, Issues or Completeness.
    case "overrides": return ["students", "batches", "issues", "completeness"];
    // Compute and Completeness' Check now: from the Batches list, Mark sheets, Data sources, Completeness, a student's page, Issues.
    case "calc": case "compute": return ANY_RESULTS;
    case "export": {
      const kind = parts[1] || "";
      if (kind === "integral.csv") return ["integral"];
      if (kind === "exceptions.csv") return ["issues"];
      if (kind === "final.csv") return ["batches", "final"];
      if (kind === "failures.csv") return ["batches", "failures"];
      return ["batches"];
    }
    default: return [];   // an endpoint not listed here is for admins only, until it is added
  }
}
