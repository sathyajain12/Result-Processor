// Reads every tab of an uploaded workbook as rows of raw cell values. xlsx is loaded on demand (it is large).
export async function readFile(file) {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  return wb.SheetNames.map(name => ({ name, values: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: false }) }));
}
