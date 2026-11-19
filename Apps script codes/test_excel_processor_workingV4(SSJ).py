# %%

#  Authored by Subramanian S Iyer Nov 2024
#  Updated: PDF output for user-selected registration numbers, from one window: open the workbook, search and pick the
#  students, preview their papers, choose where to save, and generate.

import json
import os
import re
import sys
import threading
from datetime import datetime

import numpy as np
import pandas as pd
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (PageBreak, Paragraph, SimpleDocTemplate,
                                Spacer, Table, TableStyle)

# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------
CONSOLIDATED_SHEET = "Consolidated Result"
FINAL_SHEET = "FinalOutput"
NUM_STUDENTS = 2  # the usual sample size; the window suggests it, but any number of students can go in one PDF
# Shown beside the date the PDF was generated, as the web portal's Grade register shows "SSJ" beside its print date,
# so a register from this tool can be told apart from one printed from the portal.
PRINTED_BY = "Excel Processor-Sample Grade Register"

DESIRED_ORDER = [
    "Regd No", "Paper Code", "CIE-Obt Marks", "CIE- Compt as %",
    "CIE-NP", "ESE-Obt Marks", "ESE- Compt as %", "ESE-NP",
    "COMB-Marks %", "COMB-NP", "Credits", "Credit * COMB-NP"
]
FINAL_COLUMNS = [
    "Regd No", "Sum of Credits", "Sum of (Credit * COMB NP)",
    "Published GPA", "LetterGrade"
]
# The Letter Grade shown in the PDF comes with its qualitative assessment, e.g. "A (Very Good)". It is taken from the
# DigiLocker sheet's LetterGrade column (any sheet whose name contains "digilocker"), which holds it in that form.
# Without that sheet, or for a student not on it, FinalOutput's LetterGrade is used, with its QA column in brackets
# when there is one. Headers are matched ignoring case and spaces.
DIGILOCKER_SHEET_KEY = "digilocker"
DIGILOCKER_REGD = ["Regd No", "Regd. No.", "Regd No.", "Regn No", "Registration No"]
DIGILOCKER_GRADE = ["LetterGrade", "Letter Grade"]
QA_COLUMNS = ["QA", "Qualitative Assessment", "Qual Grade", "Qualifier"]


# --------------------------------------------------------------------------
# Data helpers (no GUI here, so they can be tested / reused independently)
# --------------------------------------------------------------------------
def normalize_regd(value):
    """Return Regd No as a clean string so 2310101 / '2310101' / 2310101.0 all match."""
    if pd.isna(value):
        return ""
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return str(value).strip()


def load_data(file_path):
    """Read and validate both sheets. Raises ValueError with a readable message."""
    df_consolidated = pd.read_excel(file_path, sheet_name=CONSOLIDATED_SHEET)
    df_final = pd.read_excel(file_path, sheet_name=FINAL_SHEET)

    missing = [c for c in DESIRED_ORDER if c not in df_consolidated.columns]
    if missing:
        raise ValueError(f"Missing columns in '{CONSOLIDATED_SHEET}': {missing}")
    missing = [c for c in FINAL_COLUMNS if c not in df_final.columns]
    if missing:
        raise ValueError(f"Missing columns in '{FINAL_SHEET}': {missing}")

    df_consolidated = df_consolidated[DESIRED_ORDER].copy()
    df_consolidated["Regd No"] = df_consolidated["Regd No"].map(normalize_regd)
    df_final = df_final.copy()
    df_final["Regd No"] = df_final["Regd No"].map(normalize_regd)
    df_final["Grade Display"] = grade_display(file_path, df_final)

    df_consolidated = df_consolidated[df_consolidated["Regd No"] != ""]
    return df_consolidated, df_final


def _find_col(columns, wanted):
    """The first column whose header matches one of `wanted`, ignoring case and spaces; else None."""
    key = lambda c: "".join(str(c).split()).lower()
    return next((c for w in wanted for c in columns if key(c) == key(w)), None)


def _blank(v):
    return v is None or pd.isna(v) or str(v).strip() == ""


def _num(v):
    """The value as a number, or None for blanks and text such as "Fail", "--" or "< 4"."""
    if _blank(v):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _failed(row):
    """A paper the student did not pass: its COMB-NP is not a grade point ("--", "< 4", "Fail", "Absent")."""
    return not _blank(row["COMB-NP"]) and _num(row["COMB-NP"]) is None


def grade_display(file_path, df_final):
    """Letter grade with its qualitative assessment for each FinalOutput row, e.g. "A (Very Good)":
    from the DigiLocker sheet's LetterGrade when the student is there, else FinalOutput's LetterGrade (+ QA)."""
    from_digilocker = {}
    sheet = next((s for s in pd.ExcelFile(file_path).sheet_names if DIGILOCKER_SHEET_KEY in s.lower().replace(" ", "")), None)
    if sheet is not None:
        dl = pd.read_excel(file_path, sheet_name=sheet)
        regd_col, grade_col = _find_col(dl.columns, DIGILOCKER_REGD), _find_col(dl.columns, DIGILOCKER_GRADE)
        if regd_col is not None and grade_col is not None:
            for regd, grade in zip(dl[regd_col].map(normalize_regd), dl[grade_col]):
                if regd and not _blank(grade):
                    from_digilocker[regd] = str(grade).strip()

    qa_col = _find_col(df_final.columns, QA_COLUMNS)
    def display(row):
        qa = "" if qa_col is None or _blank(row[qa_col]) else str(row[qa_col]).strip()
        lg = from_digilocker.get(row["Regd No"]) or ("" if _blank(row["LetterGrade"]) else str(row["LetterGrade"]).strip())
        # A grade without its assessment ("A") gets FinalOutput's QA in brackets, when there is one; not when the QA only
        # repeats it ("Fail", "Absent").
        add_qa = lg and qa and "(" not in lg and qa.lower() != lg.lower()
        shown = f"{lg} ({qa})" if add_qa else lg
        # "Fail (Fail)" as the DigiLocker sheet has it for a failed student: just "Fail".
        parts = re.fullmatch(r"\s*(.+?)\s*\(\s*(.+?)\s*\)\s*", shown or "")
        if parts and parts.group(1).lower() == parts.group(2).lower():
            shown = parts.group(1)
        return shown or np.nan
    return [display(r) for _, r in df_final.iterrows()]


def build_student_record(df_consolidated, df_final, regd_no):
    """Return (subject_rows_df, summary_dict) for one registration number."""
    rows = (df_consolidated[df_consolidated["Regd No"] == regd_no]
            .sort_values("Paper Code", kind="stable")
            .reset_index(drop=True))
    if rows.empty:
        raise ValueError(f"Registration number '{regd_no}' not found in '{CONSOLIDATED_SHEET}'.")

    lookup = df_final[df_final["Regd No"] == regd_no]
    first = lookup.iloc[0] if not lookup.empty else None

    summary = {
        "Total Credits (computed)": rows["Credits"].sum(),
        "Total Credit * COMB-NP (computed)": rows["Credit * COMB-NP"].sum(),
        "Sum of Credits": first["Sum of Credits"] if first is not None else np.nan,
        "Sum of (Credit * COMB NP)": first["Sum of (Credit * COMB NP)"] if first is not None else np.nan,
        "Published GPA": first["Published GPA"] if first is not None else np.nan,
        "LetterGrade": first["LetterGrade"] if first is not None else np.nan,
        "Grade Display": first["Grade Display"] if first is not None else np.nan,
    }
    return rows, summary


def totals_differ(summary):
    """True when the totals worked out from the papers differ from FinalOutput's. Compared only where both are numbers:
    a failed student's FinalOutput says "Fail" instead of a total."""
    def differs(a, b):
        a, b = _num(a), _num(b)
        return a is not None and b is not None and not np.isclose(a, b)
    return (differs(summary["Sum of Credits"], summary["Total Credits (computed)"])
            or differs(summary["Sum of (Credit * COMB NP)"], summary["Total Credit * COMB-NP (computed)"]))


def student_overview(df_consolidated, df_final):
    """One entry per Regd No in Consolidated Result, for the window's student list: name and semester (from FinalOutput),
    how many papers and how many of them failed, and the GPA and letter grade."""
    name_col = _find_col(df_final.columns, ["Name", "Student Name"])
    sem_col = _find_col(df_final.columns, ["Semester", "Sem"])
    final = {r["Regd No"]: r for _, r in df_final.iterrows() if r["Regd No"]}
    out = []
    for regd, rows in df_consolidated.groupby("Regd No", sort=True):
        f = final.get(regd)
        def get(col):
            return "" if f is None or col is None or _blank(f[col]) else str(f[col]).strip()
        out.append({
            "regd": regd, "name": get(name_col), "semester": get(sem_col),
            "papers": len(rows), "failed": int(sum(_failed(r) for _, r in rows.iterrows())),
            "gpa": fmt(f["Published GPA"]) if f is not None else "-",
            "grade": fmt(f["Grade Display"]) if f is not None else "-",
            "in_final": f is not None,
        })
    return out


def workbook_summary(file_path, df_final):
    """Programme and semester as FinalOutput gives them (when every row agrees), and whether there is a DigiLocker sheet."""
    def only(wanted):
        col = _find_col(df_final.columns, wanted)
        vals = {str(v).strip() for v in df_final[col] if not _blank(v)} if col is not None else set()
        return vals.pop() if len(vals) == 1 else ""
    sheet = next((s for s in pd.ExcelFile(file_path).sheet_names if DIGILOCKER_SHEET_KEY in s.lower().replace(" ", "")), None)
    rows = len(pd.read_excel(file_path, sheet_name=sheet)) if sheet is not None else 0
    return {
        "programme": only(["Program", "Programme"]), "semester": only(["Semester", "Sem"]),
        # "found" (with students), "empty", or None (no such sheet)
        "digilocker": None if sheet is None else ("found" if rows else "empty"),
    }


def fmt(value, decimals=2):
    """Pretty-print a cell value for the PDF."""
    if value is None or (isinstance(value, float) and np.isnan(value)) or pd.isna(value):
        return "-"
    if isinstance(value, (int, np.integer)):
        return str(value)
    if isinstance(value, (float, np.floating)):
        return str(int(value)) if float(value).is_integer() else f"{value:.{decimals}f}"
    return str(value)


# --------------------------------------------------------------------------
# PDF generation
# --------------------------------------------------------------------------
def generate_pdf(df_consolidated, df_final, regd_numbers, output_path, source_name=""):
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle("TitleC", parent=styles["Title"], fontSize=16, spaceAfter=4)
    sub_style = ParagraphStyle("Sub", parent=styles["Normal"], fontSize=9,
                               textColor=colors.HexColor("#555555"), alignment=1)
    head_style = ParagraphStyle("Head", parent=styles["Heading2"], fontSize=12, spaceBefore=6)
    cell_hdr = ParagraphStyle("CellHdr", parent=styles["Normal"], fontSize=8,
                              leading=10, alignment=1, fontName="Helvetica-Bold",
                              textColor=colors.white)
    cell_code = ParagraphStyle("CellCode", parent=styles["Normal"], fontSize=8.5, leading=10, alignment=1)
    cell_code_failed = ParagraphStyle("CellCodeFailed", parent=cell_code, fontName="Helvetica-Bold",
                                      textColor=colors.HexColor("#B00020"))

    doc = SimpleDocTemplate(
        output_path, pagesize=landscape(A4),
        leftMargin=12 * mm, rightMargin=12 * mm, topMargin=12 * mm, bottomMargin=14 * mm,
        title="Sample Grade Register", author="COE Office",
    )

    page_w = landscape(A4)[0] - doc.leftMargin - doc.rightMargin
    # Paper Code gets more room; the rest share evenly
    col_widths = [page_w * 0.13] + [page_w * 0.87 / (len(DESIRED_ORDER) - 2)] * (len(DESIRED_ORDER) - 2)
    display_cols = DESIRED_ORDER[1:]  # Regd No is shown in the section heading instead

    story = []
    generated_on = datetime.now().strftime("%d-%b-%Y %H:%M")

    for i, regd_no in enumerate(regd_numbers):
        rows, summary = build_student_record(df_consolidated, df_final, regd_no)

        story.append(Paragraph("Sample Grade Register", title_style))
        story.append(Paragraph(f"Source: {source_name} &nbsp;|&nbsp; Generated: {generated_on} · "
                               f'<font size="18" color="#000000"><b><u>{PRINTED_BY.replace(" ", "&nbsp;")}</u></b></font>',
                               ParagraphStyle("SubPrintedBy", parent=sub_style, leading=22)))
        story.append(Spacer(1, 6 * mm))
        story.append(Paragraph(f"Registration No: <b>{regd_no}</b>", head_style))
        story.append(Spacer(1, 2 * mm))

        # ---- Subject table ----
        data = [[Paragraph(c, cell_hdr) for c in display_cols]]
        failed_rows = []
        for n, (_, r) in enumerate(rows.iterrows(), start=1):
            failed = _failed(r)
            cells = [fmt(r[c]) for c in display_cols]
            # The paper code wraps inside its cell: codes such as UMAT-702(IM-TAM)-BSH-M are wider than the column.
            cells[0] = Paragraph(cells[0], cell_code_failed if failed else cell_code)
            data.append(cells)
            if failed:
                failed_rows.append(n)
        data.append(["TOTAL"] + [""] * (len(display_cols) - 3)
                    + [fmt(summary["Total Credits (computed)"]),
                       fmt(summary["Total Credit * COMB-NP (computed)"])])

        t = Table(data, colWidths=col_widths, repeatRows=1)
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1F3B5C")),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            ("FONTSIZE", (0, 1), (-1, -1), 8.5),
            ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#9AA5B1")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -2), [colors.white, colors.HexColor("#F2F5F8")]),
            ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#DDE6EF")),
            ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
            ("SPAN", (0, -1), (len(display_cols) - 3, -1)),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            # A failed paper's row in red, so it stands out.
            *[s for n in failed_rows for s in (("TEXTCOLOR", (0, n), (-1, n), colors.HexColor("#B00020")),
                                               ("FONTNAME", (0, n), (-1, n), "Helvetica-Bold"))],
        ]))
        story.append(t)
        story.append(Spacer(1, 6 * mm))

        # ---- Result summary (from FinalOutput) ----
        mismatch = totals_differ(summary)
        sdata = [
            ["Sum of Credits", "Sum of (Credit * COMB NP)", "Published GPA", "Letter Grade"],
            [fmt(summary["Sum of Credits"]), fmt(summary["Sum of (Credit * COMB NP)"]),
             fmt(summary["Published GPA"]), fmt(summary["Grade Display"])],
        ]
        st = Table(sdata, colWidths=[page_w * 0.18] * 4, hAlign="LEFT")
        st.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1F3B5C")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTNAME", (0, 1), (-1, 1), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#9AA5B1")),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        story.append(Paragraph("Result Summary (FinalOutput)", head_style))
        story.append(st)

        if mismatch:
            warn = ParagraphStyle("Warn", parent=styles["Normal"], fontSize=9,
                                  textColor=colors.HexColor("#B00020"))
            story.append(Spacer(1, 3 * mm))
            story.append(Paragraph(
                "Note: computed totals differ from FinalOutput values — please verify.", warn))

        if i < len(regd_numbers) - 1:
            story.append(PageBreak())  # one student per printed page

    def footer(canvas, doc_):
        canvas.saveState()
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(colors.HexColor("#777777"))
        canvas.drawRightString(landscape(A4)[0] - doc.rightMargin, 8 * mm, f"Page {doc_.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=footer, onLaterPages=footer)


# --------------------------------------------------------------------------
# GUI: one window to open the workbook, pick the students and save the PDF
# --------------------------------------------------------------------------
# The folders used last time (to open workbooks from, and to save PDFs in) are remembered here, per Windows user.
SETTINGS_PATH = os.path.join(os.environ.get("APPDATA") or os.path.expanduser("~"), "SampleGradeRegister", "settings.json")

RED, GREEN, AMBER, GREY = "#B00020", "#1B6E2E", "#8A5300", "#5F6B76"
PREVIEW_HEADINGS = {
    "Paper Code": "Paper Code", "CIE-Obt Marks": "CIE", "CIE- Compt as %": "CIE %", "CIE-NP": "CIE-NP",
    "ESE-Obt Marks": "ESE", "ESE- Compt as %": "ESE %", "ESE-NP": "ESE-NP", "COMB-Marks %": "COMB %",
    "COMB-NP": "COMB-NP", "Credits": "Credits", "Credit * COMB-NP": "Credit × NP",
}


def load_settings():
    try:
        with open(SETTINGS_PATH, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def save_settings(settings):
    try:
        os.makedirs(os.path.dirname(SETTINGS_PATH), exist_ok=True)
        with open(SETTINGS_PATH, "w", encoding="utf-8") as f:
            json.dump(settings, f, indent=2)
    except Exception:
        pass  # remembering folders is a convenience; never stop the work for it


def open_path(path):
    try:
        os.startfile(path)  # Windows
    except AttributeError:
        import subprocess
        subprocess.call(["open" if sys.platform == "darwin" else "xdg-open", path])


def show_in_folder(path):
    if sys.platform.startswith("win"):
        import subprocess
        subprocess.Popen(["explorer", "/select,", os.path.normpath(path)])
    else:
        open_path(os.path.dirname(path))


class App:
    PAD = 8

    def __init__(self, root, initial_file=None):
        self.root = root
        self.settings = load_settings()
        self.file_path = None
        self.df_consolidated = self.df_final = None
        self.students = {}       # Regd No -> overview (name, semester, papers, failed, GPA, grade)
        self.order = []          # every Regd No in the workbook, sorted
        self.selected = []       # the Regd Nos going into the PDF, in page order
        self.auto_name = ""      # the file name last filled in automatically; a name the user typed is left alone
        self.last_pdf = None
        self.busy = False
        self._dir_cache = (None, [])

        root.title("Sample Grade Register  -  Excel Processor")
        self._style()
        # Fit the screen: at most 92% of it, so the window never opens larger than the display.
        w = min(self.px(1240), int(root.winfo_screenwidth() * 0.92))
        h = min(self.px(820), int(root.winfo_screenheight() * 0.88))
        root.geometry(f"{w}x{h}+{(root.winfo_screenwidth() - w) // 2}+{max(0, (root.winfo_screenheight() - h) // 3)}")
        root.minsize(min(w, self.px(1000)), min(h, self.px(640)))
        self._build()
        self._refresh_state()
        root.bind("<Control-o>", lambda e: self.browse())
        root.bind("<F5>", lambda e: self.load(self.file_path))
        root.bind("<Control-f>", lambda e: (self.search.focus_set(), "break")[1])
        root.bind("<Control-g>", lambda e: self.generate())
        if initial_file:
            root.after(150, lambda: self.load(initial_file))
        else:
            root.after(150, lambda: self.browse_btn.focus_set())

    # ---- look ----
    def px(self, n):
        """n pixels at 100% display scaling, in this screen's pixels (fonts scale by themselves; widths and heights do not)."""
        return int(round(n * self.scale))

    def _style(self):
        from tkinter import font as tkfont
        s = ttk.Style(self.root)
        if "vista" in s.theme_names():
            s.theme_use("vista")
        self.scale = max(1.0, self.root.winfo_fpixels("1i") / 96)
        for name in ("TkDefaultFont", "TkTextFont", "TkMenuFont", "TkHeadingFont"):
            tkfont.nametofont(name).configure(family="Segoe UI", size=10)
        base = ("Segoe UI", 10)
        self.bold = ("Segoe UI", 10, "bold")
        s.configure(".", font=base)
        s.configure("Header.TLabel", font=("Segoe UI", 16, "bold"))
        s.configure("Tag.TLabel", font=("Segoe UI", 10, "bold underline"), foreground="#000000")
        s.configure("Sub.TLabel", foreground=GREY)
        s.configure("Ok.TLabel", foreground=GREEN)
        s.configure("Err.TLabel", foreground=RED)
        s.configure("Warn.TLabel", foreground=AMBER)
        s.configure("Bold.TLabel", font=self.bold)
        s.configure("Section.TLabelframe.Label", font=self.bold)
        s.configure("Accent.TButton", font=("Segoe UI", 11, "bold"), padding=(18, 8))
        s.configure("Treeview", rowheight=self.px(24))
        s.configure("Treeview.Heading", font=self.bold)

    def _tree(self, parent, columns, selectmode, height=10, stretch_all=False):
        """A Treeview with a vertical scrollbar, `height` rows tall. columns: [(id, heading, width, anchor)]."""
        holder = ttk.Frame(parent)
        tree = ttk.Treeview(holder, columns=[c[0] for c in columns], show="headings", selectmode=selectmode, height=height)
        for cid, heading, width, anchor in columns:
            tree.heading(cid, text=heading, anchor=anchor)
            tree.column(cid, width=self.px(width), minwidth=self.px(40), anchor=anchor, stretch=stretch_all or anchor == "w")
        bar = ttk.Scrollbar(holder, orient="vertical", command=tree.yview)
        tree.configure(yscrollcommand=bar.set)
        tree.pack(side="left", fill="both", expand=True)
        bar.pack(side="right", fill="y")
        tree.tag_configure("failed", foreground=RED)
        tree.tag_configure("chosen", background="#E4EEF9")
        tree.tag_configure("total", font=self.bold, background="#EEF2F6")
        return holder, tree

    def _build(self):
        P = self.PAD
        outer = ttk.Frame(self.root, padding=(14, 10, 14, 8))
        outer.pack(fill="both", expand=True)
        outer.columnconfigure(0, weight=1)
        outer.rowconfigure(2, weight=1)

        head = ttk.Frame(outer)
        head.grid(row=0, column=0, sticky="ew")
        ttk.Label(head, text="Sample Grade Register", style="Header.TLabel").pack(side="left")
        ttk.Label(head, text=PRINTED_BY, style="Tag.TLabel").pack(side="left", padx=(14, 0), pady=(8, 0))
        ttk.Label(head, text="Ctrl+O open  ·  Ctrl+F search  ·  Ctrl+G generate", style="Sub.TLabel").pack(side="right", pady=(8, 0))

        # 1. Workbook
        wb = ttk.LabelFrame(outer, text=" 1.  Excel workbook ", style="Section.TLabelframe", padding=P)
        wb.grid(row=1, column=0, sticky="ew", pady=(8, 6))
        wb.columnconfigure(0, weight=1)
        self.file_var = tk.StringVar()
        ttk.Entry(wb, textvariable=self.file_var, state="readonly").grid(row=0, column=0, sticky="ew", ipady=2)
        self.browse_btn = ttk.Button(wb, text="Open workbook…", command=self.browse)
        self.browse_btn.grid(row=0, column=1, padx=(P, 0))
        self.reload_btn = ttk.Button(wb, text="Reload", command=lambda: self.load(self.file_path))
        self.reload_btn.grid(row=0, column=2, padx=(6, 0))
        self.file_info = ttk.Label(wb, style="Sub.TLabel",
                                   text=f"Open the results workbook. It needs the '{CONSOLIDATED_SHEET}' and '{FINAL_SHEET}' sheets.")
        self.file_info.grid(row=1, column=0, columnspan=3, sticky="w", pady=(6, 0))

        panes = ttk.Panedwindow(outer, orient="vertical")
        panes.grid(row=2, column=0, sticky="nsew")
        pick = ttk.LabelFrame(panes, text=" 2.  Choose the students ", style="Section.TLabelframe", padding=P)
        prev = ttk.LabelFrame(panes, text=" Preview ", style="Section.TLabelframe", padding=P)
        panes.add(pick, weight=3)
        panes.add(prev, weight=1)

        # 2. Students: everyone in the workbook on the left, the PDF's students on the right
        pick.columnconfigure(0, weight=3)
        pick.columnconfigure(2, weight=2)
        pick.rowconfigure(0, weight=1)
        left = ttk.Frame(pick)
        left.grid(row=0, column=0, sticky="nsew")
        bar = ttk.Frame(left)
        bar.pack(fill="x", pady=(0, 6))
        ttk.Label(bar, text="Search").pack(side="left")
        self.search_var = tk.StringVar()
        self.search_var.trace_add("write", lambda *a: self._fill_students())
        self.search = ttk.Entry(bar, textvariable=self.search_var, width=30)
        self.search.pack(side="left", padx=6)
        self.only_failed = tk.BooleanVar(value=False)
        ttk.Checkbutton(bar, text="Only students with a failed paper", variable=self.only_failed,
                        command=self._fill_students).pack(side="left", padx=6)
        self.count_lbl = ttk.Label(bar, style="Sub.TLabel")
        self.count_lbl.pack(side="right")
        holder, self.tree = self._tree(left, [
            ("regd", "Regd No", 115, "center"), ("name", "Name", 210, "w"), ("sem", "Sem", 50, "center"),
            ("papers", "Papers", 62, "center"), ("failed", "Failed", 62, "center"), ("gpa", "GPA", 60, "center"),
            ("grade", "Letter Grade", 150, "w")], "extended", height=9)
        holder.pack(fill="both", expand=True)
        self.tree.bind("<Double-1>", lambda e: self.add())
        self.tree.bind("<Return>", lambda e: self.add())
        self.tree.bind("<<TreeviewSelect>>", lambda e: self._preview_from(self.tree))
        ttk.Label(left, style="Sub.TLabel",
                  text="Double-click or press Enter to add. Ctrl- or Shift-click picks several. Red: has a failed paper."
                  ).pack(anchor="w", pady=(6, 0))

        mid = ttk.Frame(pick)
        mid.grid(row=0, column=1, padx=P + 2)
        self.add_btn = ttk.Button(mid, text="Add  →", width=12, command=self.add)
        self.remove_btn = ttk.Button(mid, text="←  Remove", width=12, command=self.remove)
        self.clear_btn = ttk.Button(mid, text="Clear all", width=12, command=self.clear)
        for b in (self.add_btn, self.remove_btn, self.clear_btn):
            b.pack(pady=4)

        right = ttk.Frame(pick)
        right.grid(row=0, column=2, sticky="nsew")
        self.sel_title = ttk.Label(right, text="In the PDF", style="Bold.TLabel")
        self.sel_title.pack(anchor="w", pady=(2, 8))
        holder, self.sel_tree = self._tree(right, [
            ("n", "Page", 48, "center"), ("regd", "Regd No", 115, "center"), ("name", "Name", 180, "w")], "browse", height=9)
        holder.pack(fill="both", expand=True)
        self.sel_tree.bind("<Double-1>", lambda e: self.remove())
        self.sel_tree.bind("<Delete>", lambda e: self.remove())
        self.sel_tree.bind("<<TreeviewSelect>>", lambda e: self._preview_from(self.sel_tree))
        moves = ttk.Frame(right)
        moves.pack(fill="x", pady=(6, 0))
        self.up_btn = ttk.Button(moves, text="Move up", command=lambda: self.move(-1))
        self.up_btn.pack(side="left")
        self.down_btn = ttk.Button(moves, text="Move down", command=lambda: self.move(1))
        self.down_btn.pack(side="left", padx=6)
        self.sel_hint = ttk.Label(right, style="Sub.TLabel", wraplength=self.px(330), justify="left")
        self.sel_hint.pack(anchor="w", pady=(6, 0))

        # Preview of one student's papers, as the PDF will show them
        prev.columnconfigure(0, weight=1)
        prev.rowconfigure(1, weight=1)
        self.prev_title = ttk.Label(prev, text="Click a student to see their papers here.", style="Sub.TLabel")
        self.prev_title.grid(row=0, column=0, sticky="w", pady=(0, 6))
        cols = [(c, PREVIEW_HEADINGS.get(c, c), 170 if c == "Paper Code" else 70, "w" if c == "Paper Code" else "center")
                for c in DESIRED_ORDER[1:]]
        holder, self.prev_tree = self._tree(prev, cols, "none", height=7, stretch_all=True)
        holder.grid(row=1, column=0, sticky="nsew")
        self.prev_sum = ttk.Label(prev, style="Bold.TLabel")
        self.prev_sum.grid(row=2, column=0, sticky="w", pady=(6, 0))
        self.prev_warn = ttk.Label(prev, style="Err.TLabel")
        self.prev_warn.grid(row=3, column=0, sticky="w")

        # 3. Where to save
        out = ttk.LabelFrame(outer, text=" 3.  Save the PDF ", style="Section.TLabelframe", padding=P)
        out.grid(row=3, column=0, sticky="ew", pady=(6, 0))
        out.columnconfigure(1, weight=1)
        ttk.Label(out, text="Folder").grid(row=0, column=0, sticky="e")
        self.dir_var = tk.StringVar(value=self.settings.get("save_dir", ""))
        self.dir_var.trace_add("write", lambda *a: self._check_existing())
        ttk.Entry(out, textvariable=self.dir_var).grid(row=0, column=1, sticky="ew", padx=6, ipady=2)
        ttk.Button(out, text="Change…", command=self.choose_dir).grid(row=0, column=2, sticky="ew")
        ttk.Label(out, text="File name").grid(row=1, column=0, sticky="e", pady=(6, 0))
        self.name_var = tk.StringVar()
        self.name_var.trace_add("write", lambda *a: self._check_existing())
        ttk.Entry(out, textvariable=self.name_var).grid(row=1, column=1, sticky="ew", padx=6, pady=(6, 0), ipady=2)
        self.open_after = tk.BooleanVar(value=self.settings.get("open_after", True))
        ttk.Checkbutton(out, text="Open the PDF when ready", variable=self.open_after).grid(row=1, column=2, sticky="w", pady=(6, 0))
        self.exist_lbl = ttk.Label(out, style="Warn.TLabel")
        self.exist_lbl.grid(row=2, column=1, columnspan=2, sticky="w", padx=6, pady=(4, 0))
        self.gen_btn = ttk.Button(out, text="Generate PDF", style="Accent.TButton", command=self.generate)
        self.gen_btn.grid(row=0, column=3, rowspan=3, sticky="nsew", padx=(14, 0))

        status = ttk.Frame(outer)
        status.grid(row=4, column=0, sticky="ew", pady=(8, 0))
        self.status = ttk.Label(status, style="Sub.TLabel", text="Ready.")
        self.status.pack(side="left")
        self.folder_btn = ttk.Button(status, text="Show in folder", command=lambda: self.last_pdf and show_in_folder(self.last_pdf))
        self.pdf_btn = ttk.Button(status, text="Open PDF", command=lambda: self.last_pdf and open_path(self.last_pdf))
        self.progress = ttk.Progressbar(status, mode="indeterminate", length=self.px(160))

    # ---- state ----
    def _refresh_state(self):
        loaded = self.df_consolidated is not None
        def able(widget, on):
            widget.state(["!disabled"] if on else ["disabled"])
        able(self.browse_btn, not self.busy)
        able(self.reload_btn, bool(self.file_path) and not self.busy)
        able(self.add_btn, loaded and not self.busy)
        able(self.remove_btn, bool(self.selected) and not self.busy)
        able(self.clear_btn, bool(self.selected) and not self.busy)
        able(self.up_btn, len(self.selected) > 1 and not self.busy)
        able(self.down_btn, len(self.selected) > 1 and not self.busy)
        able(self.gen_btn, loaded and bool(self.selected) and not self.busy)
        n = len(self.selected)
        self.sel_title.config(text=f"In the PDF  ({n} student{'s' if n != 1 else ''}, one page each)")
        if not loaded:
            hint = ""
        elif n == 0:
            hint = f"Add {min(NUM_STUDENTS, len(self.order))} students, the usual sample."
        elif n < NUM_STUDENTS <= len(self.order):
            hint = f"The usual sample is {NUM_STUDENTS}. Add {NUM_STUDENTS - n} more, or generate with {n}."
        else:
            hint = "Ready. Use Move up / Move down to change the page order."
        self.sel_hint.config(text=hint)

    def _set_busy(self, busy, message=""):
        self.busy = busy
        if busy:
            self.progress.pack(side="right")
            self.progress.start(12)
            self.root.config(cursor="watch")
        else:
            self.progress.stop()
            self.progress.pack_forget()
            self.root.config(cursor="")
        if message:
            self._say(message)
        self._refresh_state()

    def _say(self, text, style="Sub.TLabel"):
        self.status.config(text=text, style=style)

    def _run(self, work, done, fail):
        """Run work() off the window's thread, so the window stays responsive; then done(result) or fail(error) on it."""
        box = {}
        def target():
            try:
                box["ok"] = work()
            except BaseException as e:  # reported to the user in fail()
                box["err"] = e
        t = threading.Thread(target=target, daemon=True)
        t.start()
        def poll():
            if t.is_alive():
                self.root.after(60, poll)
            elif "err" in box:
                fail(box["err"])
            else:
                done(box["ok"])
        self.root.after(60, poll)

    # ---- 1. workbook ----
    def browse(self):
        if self.busy:
            return
        start = os.path.dirname(self.file_path) if self.file_path else self.settings.get("open_dir") or os.path.expanduser("~")
        path = filedialog.askopenfilename(parent=self.root, title="Open the results workbook", initialdir=start,
                                          filetypes=[("Excel workbooks", "*.xlsx *.xlsm *.xls"), ("All files", "*.*")])
        if path:
            self.load(path)

    def load(self, path):
        if not path or self.busy:
            return
        name = os.path.basename(path)
        self._set_busy(True, f"Reading {name}…")

        def work():
            dc, df = load_data(path)
            return dc, df, student_overview(dc, df), workbook_summary(path, df)

        def done(res):
            dc, df, overview, info = res
            same_file = path == self.file_path
            self.file_path, self.df_consolidated, self.df_final = path, dc, df
            self.students = {s["regd"]: s for s in overview}
            self.order = [s["regd"] for s in overview]
            if same_file:
                self.selected = [r for r in self.selected if r in self.students]
            else:
                # A workbook with no more students than the usual sample: they are all chosen already.
                self.selected = list(self.order) if len(self.order) <= NUM_STUDENTS else []
                self.search_var.set("")
                self.name_var.set("")
                self.auto_name = ""
            self.file_var.set(path)
            self.settings["open_dir"] = os.path.dirname(path)
            save_settings(self.settings)
            if not os.path.isdir(self.dir_var.get().strip()):
                self.dir_var.set(os.path.dirname(path))

            failed = sum(1 for s in overview if s["failed"])
            missing = sum(1 for s in overview if not s["in_final"])
            what = "  ·  ".join(x for x in (info["programme"], f"Sem {info['semester']}" if info["semester"] else "") if x)
            parts = [what, f"{len(self.order)} students", f"{len(dc)} paper rows",
                     f"{failed} with a failed paper" if failed else "no failed papers",
                     {"found": "grades from the DigiLocker sheet",
                      "empty": "DigiLocker sheet is empty, so grades come from FinalOutput"}.get(
                         info["digilocker"], "no DigiLocker sheet, so grades come from FinalOutput")]
            text = "  ·  ".join(p for p in parts if p)
            if missing:
                text += f"  ·  {missing} not in {FINAL_SHEET}"
            self.file_info.config(text=text, style="Warn.TLabel" if missing else "Ok.TLabel")
            if not self.order:
                self.file_info.config(text=f"No registration numbers in '{CONSOLIDATED_SHEET}'.", style="Err.TLabel")
            self._fill_students()
            self._selection_changed()
            self._clear_preview()
            self._set_busy(False, f"Loaded {name}.")
            self.search.focus_set()

        def fail(e):
            self._set_busy(False)
            msg = str(e)
            if isinstance(e, PermissionError):
                msg = "The workbook is locked. Close it in Excel and try again."
            elif "Worksheet named" in msg or "No sheet named" in msg:
                msg = f"This workbook has no '{CONSOLIDATED_SHEET}' or '{FINAL_SHEET}' sheet.\n\n{msg}"
            self._say(f"Could not read {name}.", "Err.TLabel")
            messagebox.showerror("Could not read the workbook", msg, parent=self.root)

        self._run(work, done, fail)

    # ---- 2. students ----
    def _fill_students(self):
        q = self.search_var.get().strip().lower()
        only_failed = self.only_failed.get()
        self.tree.delete(*self.tree.get_children())
        shown = 0
        for regd in self.order:
            s = self.students[regd]
            if q and q not in regd.lower() and q not in s["name"].lower():
                continue
            if only_failed and not s["failed"]:
                continue
            self.tree.insert("", "end", iid=regd, tags=self._tags(regd),
                             values=(regd, s["name"], s["semester"], s["papers"], s["failed"] or "", s["gpa"], s["grade"]))
            shown += 1
        if not self.order:
            self.count_lbl.config(text="")
        elif q or only_failed:
            self.count_lbl.config(text=f"{shown} of {len(self.order)} shown")
        else:
            self.count_lbl.config(text=f"{len(self.order)} students")
        kids = self.tree.get_children()
        if q and len(kids) == 1:   # one match: ready to add with Enter
            self.tree.selection_set(kids[0])
            self.tree.focus(kids[0])

    def _tags(self, regd):
        s = self.students[regd]
        return tuple(t for t, on in (("failed", s["failed"]), ("chosen", regd in self.selected)) if on)

    def add(self):
        if self.df_consolidated is None:
            return
        rank = {r: i for i, r in enumerate(self.order)}
        new = sorted((i for i in self.tree.selection() if i not in self.selected), key=lambda r: rank.get(r, 0))
        if not new:
            if self.tree.selection():
                self._say("Already in the PDF.")
            return
        self.selected.extend(new)
        self._selection_changed()
        self._say(f"Added {', '.join(new)}.")

    def remove(self):
        gone = [i for i in self.sel_tree.selection() if i in self.selected]
        if not gone:
            return
        at = self.selected.index(gone[0])
        self.selected = [r for r in self.selected if r not in gone]
        self._selection_changed()
        if self.selected:
            nxt = self.selected[min(at, len(self.selected) - 1)]
            self.sel_tree.selection_set(nxt)
            self.sel_tree.focus(nxt)

    def clear(self):
        self.selected = []
        self._selection_changed()

    def move(self, step):
        sel = self.sel_tree.selection()
        if not sel:
            return
        i = self.selected.index(sel[0])
        j = i + step
        if 0 <= j < len(self.selected):
            self.selected[i], self.selected[j] = self.selected[j], self.selected[i]
            self._selection_changed()
            self.sel_tree.selection_set(sel[0])
            self.sel_tree.focus(sel[0])

    def _selection_changed(self):
        self.sel_tree.delete(*self.sel_tree.get_children())
        for n, regd in enumerate(self.selected, start=1):
            s = self.students.get(regd, {})
            self.sel_tree.insert("", "end", iid=regd, values=(n, regd, s.get("name", "")),
                                 tags=("failed",) if s.get("failed") else ())
        for regd in self.tree.get_children():
            self.tree.item(regd, tags=self._tags(regd))
        self._update_name()
        self._refresh_state()

    # ---- preview ----
    def _clear_preview(self):
        self.prev_tree.delete(*self.prev_tree.get_children())
        self.prev_title.config(text="Click a student to see their papers here.", style="Sub.TLabel")
        self.prev_sum.config(text="")
        self.prev_warn.config(text="")

    def _preview_from(self, tree):
        regd = tree.focus() or next(iter(tree.selection()), None)
        if not regd or regd not in self.students or self.df_consolidated is None:
            return
        try:
            rows, summary = build_student_record(self.df_consolidated, self.df_final, regd)
        except Exception as e:
            self._clear_preview()
            self.prev_warn.config(text=str(e))
            return
        self.prev_tree.delete(*self.prev_tree.get_children())
        cols = DESIRED_ORDER[1:]
        for _, r in rows.iterrows():
            self.prev_tree.insert("", "end", values=[fmt(r[c]) for c in cols], tags=("failed",) if _failed(r) else ())
        self.prev_tree.insert("", "end", tags=("total",), values=["TOTAL"] + [""] * (len(cols) - 3)
                              + [fmt(summary["Total Credits (computed)"]), fmt(summary["Total Credit * COMB-NP (computed)"])])
        s = self.students[regd]
        inpdf = f"   (page {self.selected.index(regd) + 1} of the PDF)" if regd in self.selected else "   (not in the PDF)"
        self.prev_title.config(text=f"{regd}   {s['name']}{inpdf}", style="Bold.TLabel")
        self.prev_sum.config(text=f"FinalOutput:   Sum of Credits {fmt(summary['Sum of Credits'])}   ·   "
                                  f"Sum of (Credit × COMB NP) {fmt(summary['Sum of (Credit * COMB NP)'])}   ·   "
                                  f"Published GPA {fmt(summary['Published GPA'])}   ·   Letter Grade {fmt(summary['Grade Display'])}")
        self.prev_warn.config(text="The totals worked out from the papers differ from FinalOutput's. Please verify."
                              if totals_differ(summary) else
                              ("" if s["in_final"] else f"This student is not in {FINAL_SHEET}, so the summary is blank."))

    # ---- 3. save ----
    def choose_dir(self):
        start = self.dir_var.get().strip() or (os.path.dirname(self.file_path) if self.file_path else "")
        d = filedialog.askdirectory(parent=self.root, title="Save the PDF in", initialdir=start or None, mustexist=True)
        if d:
            self.dir_var.set(os.path.normpath(d))

    def _update_name(self):
        if not self.file_path:
            return
        base = os.path.splitext(os.path.basename(self.file_path))[0]
        auto = f"{base} sample grade register {'_'.join(self.selected)}.pdf" if self.selected else ""
        if self.name_var.get().strip() in ("", self.auto_name):
            self.name_var.set(auto)
        self.auto_name = auto

    def _pdfs_in(self, d, refresh=False):
        if refresh or self._dir_cache[0] != d:
            try:
                names = [n for n in os.listdir(d) if n.lower().endswith(".pdf")]
            except OSError:
                names = []
            self._dir_cache = (d, names)
        return self._dir_cache[1]

    def _check_existing(self, refresh=False):
        """Warn before a PDF is replaced, or when the folder already has a sample register from this workbook."""
        d, n = self.dir_var.get().strip(), self.name_var.get().strip()
        text = ""
        if d and os.path.isdir(d) and self.file_path:
            pdfs = self._pdfs_in(d, refresh)
            name = n if n.lower().endswith(".pdf") else n + ".pdf"
            base = os.path.splitext(os.path.basename(self.file_path))[0].lower()
            others = [p for p in pdfs if p.lower().startswith(base + " sample grade register") and p.lower() != name.lower()]
            if n and self.last_pdf and os.path.normcase(os.path.join(d, name)) == os.path.normcase(self.last_pdf):
                text = "This is the PDF just saved. Generating again will replace it."
            elif n and any(p.lower() == name.lower() for p in pdfs):
                text = "A PDF with this name is already in the folder. Generating will replace it."
            elif others:
                text = f"This folder already has a sample register from this workbook: {others[0]}"
                if len(others) > 1:
                    text += f" (and {len(others) - 1} more)"
        elif d and not os.path.isdir(d):
            text = "This folder does not exist."
        self.exist_lbl.config(text=text)

    def generate(self):
        if self.busy:
            return
        if self.df_consolidated is None:
            messagebox.showinfo("Open a workbook", "Open the results workbook first.", parent=self.root)
            return
        if not self.selected:
            messagebox.showinfo("Choose students", "Add at least one student to the PDF.", parent=self.root)
            return
        d = self.dir_var.get().strip()
        if not d or not os.path.isdir(d):
            messagebox.showerror("Folder not found", "Choose a folder that exists to save the PDF in.", parent=self.root)
            return
        n = self.name_var.get().strip() or self.auto_name
        if not n.lower().endswith(".pdf"):
            n += ".pdf"
        bad = re.findall(r'[<>:"/\\|?*]', n)
        if bad:
            messagebox.showerror("File name", f"A file name cannot contain {' '.join(sorted(set(bad)))}", parent=self.root)
            return
        out = os.path.join(d, n)
        if os.path.exists(out) and not messagebox.askyesno("Replace the PDF?", f"{n}\n\nis already in this folder. Replace it?", parent=self.root):
            return

        chosen, dc, df, src = list(self.selected), self.df_consolidated, self.df_final, os.path.basename(self.file_path)
        self._set_busy(True, f"Making the PDF for {len(chosen)} student{'s' if len(chosen) != 1 else ''}…")

        def done(_):
            self.last_pdf = out
            self.settings["save_dir"] = d
            self.settings["open_after"] = bool(self.open_after.get())
            save_settings(self.settings)
            self._set_busy(False)
            self._say(f"Saved:  {n}", "Ok.TLabel")
            self.pdf_btn.pack(side="left", padx=(12, 0))
            self.folder_btn.pack(side="left", padx=(6, 0))
            self._check_existing(refresh=True)
            print(f"PDF saved: {out}")
            if self.open_after.get():
                open_path(out)

        def fail(e):
            self._set_busy(False)
            msg = "Cannot write the PDF. Is it open in another program?" if isinstance(e, PermissionError) else str(e)
            self._say("The PDF was not saved.", "Err.TLabel")
            messagebox.showerror("Error generating the PDF", msg, parent=self.root)

        self._run(lambda: generate_pdf(dc, df, chosen, out, source_name=src), done, fail)


# --------------------------------------------------------------------------
# Main flow
# --------------------------------------------------------------------------
def process_excel():
    # Sharp text on a scaled display (125%, 150%): without this Windows stretches the window and blurs it.
    try:
        import ctypes
        ctypes.windll.shcore.SetProcessDpiAwareness(1)
    except Exception:
        pass
    root = tk.Tk()
    # A workbook can be given on the command line, or by dropping it on the script's icon in Explorer.
    initial = next((a for a in sys.argv[1:] if os.path.isfile(a) and a.lower().endswith((".xlsx", ".xlsm", ".xls"))), None)
    App(root, initial)
    root.mainloop()


if __name__ == "__main__":
    process_excel()
