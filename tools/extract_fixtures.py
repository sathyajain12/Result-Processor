import json, sys, datetime
import openpyxl

src, out = sys.argv[1], sys.argv[2]
wb = openpyxl.load_workbook(src, data_only=True)
wbf = openpyxl.load_workbook(src)
from openpyxl.worksheet.formula import ArrayFormula
from openpyxl.utils import get_column_letter
def is_formula(v): return isinstance(v, ArrayFormula) or (isinstance(v, str) and v.startswith("="))

def key(x):
    if x is None: return None
    if isinstance(x, float) and x.is_integer(): return str(int(x))
    return str(x).strip()

def val(x):
    if x is None or x == "": return None
    if isinstance(x, float) and x.is_integer(): return int(x)
    if isinstance(x, (datetime.date, datetime.datetime)): return x.isoformat()
    return x

s1 = wb["Stage1Working"]
pct = {key(r[0]): r for r in wb["Paper Code Table"].iter_rows(min_row=2, max_col=13, values_only=True) if r[0]}
courses = []
for r in s1.iter_rows(min_row=2, max_col=14, values_only=True):
    if not r[0]: continue
    code = key(r[0]); p = pct.get(code)
    courses.append(dict(
        code=code, title=val(r[1]), credits=val(r[2]), programmes=val(r[3]),
        cieNP=val(r[4]), eseNP=val(r[5]), combNP=val(r[6]),
        weightageCategory=val(r[8]), passCategory=val(r[9]), semester=key(r[10]),
        cieMax=val(r[11]), eseMax=val(r[12]), calcType=val(r[13]),
        category=val(p[1]) if p else None))

def table(r0, r1, cols):
    rows = []
    for r in s1.iter_rows(min_row=r0, max_row=r1, min_col=21, max_col=20 + cols, values_only=True):
        rows.append([val(x) for x in r])
    return rows

reference = dict(
    weightage={str(r[0]): dict(cie=r[1], ese=r[2]) for r in table(10, 12, 3)},
    passPercentage={str(r[0]): dict(cie=r[1], ese=r[2], comb=r[3]) for r in table(17, 19, 4)},
    npTables={"I-A": [dict(ll=r[0], np=r[2]) for r in table(48, 56, 3)],
              "I-B": [dict(ll=r[0], np=r[2]) for r in table(61, 68, 3)]},
    gradeTables={"II-A": [dict(ll=r[0], ul=r[1], lg=r[2], qa=r[3]) for r in table(25, 31, 4)],
                 "II-B": [dict(ll=r[0], ul=r[1], lg=r[2], qa=r[3]) for r in table(37, 43, 4)]},
    programmes={key(r[1]): dict(weightageCategory=val(r[3]), passCategory=val(r[4]), cieNP=val(r[5]),
                                eseNP=val(r[6]), combNP=val(r[7]), gradeTable=val(r[8]))
                for r in wb["Programs Table"].iter_rows(min_row=2, max_col=9, values_only=True) if r[1]},
    courses=courses)

students = {}
for r in wb["Academic Year"].iter_rows(min_row=2, max_col=7, values_only=True):
    if r[2] is None: continue
    students[key(r[2])] = dict(regdNo=key(r[2]), campus=val(r[1]), semester=key(r[4]), name=val(r[5]), programme=val(r[6]))

cols = "regdNo paperCode cie ese eseGraced check cieError eseError program cieMax eseMax weightageCategory passCategory calcType credits cieRound ciePct cieNP eseRound esePct eseGracedPct eseFinalPct eseComptPct eseNP combPct combNP status".split()
papers = []
fr = wbf["Consolidated Result"].iter_rows(min_row=2, max_col=27, values_only=True)
for r in wb["Consolidated Result"].iter_rows(min_row=2, max_col=27, values_only=True):
    f = next(fr)
    if r[0] in (None, ""): continue
    row = {c: val(x) for c, x in zip(cols, r)}
    row["manual"] = [cols[i] for i in range(6, 27) if not is_formula(f[i])]
    row["regdNo"] = key(r[0]); row["paperCode"] = key(r[1])
    papers.append(row)

final = []
for r in wb["FinalOutput"].iter_rows(min_row=2, max_col=15, values_only=True):
    if r[3] is None: continue
    final.append(dict(programme=val(r[0]), campus=val(r[1]), semester=key(r[2]), regdNo=key(r[3]), name=val(r[4]),
                      totalPapers=val(r[5]), calculatedGPA=val(r[6]), sumCredits=val(r[7]), sumCreditNP=val(r[8]),
                      publishedGPA=val(r[9]), letterGrade=val(r[10]), qa=val(r[11]), isAbsent=val(r[12]),
                      withheld=val(r[13]), failedCourses=val(r[14])))

for name, obj in [("reference", reference), ("students", students), ("papers", papers), ("finalOutput", final)]:
    with open(f"{out}/{name}.json", "w") as f: json.dump(obj, f, default=str)
    print(name, len(obj) if not isinstance(obj, dict) or name != "reference" else {k: len(v) for k, v in obj.items()})
