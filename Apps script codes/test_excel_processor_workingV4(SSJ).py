# %%

#  Authored by Subramanian S Iyer Nov 2024
#  Updated: PDF output for two user-selected registration numbers

import os
import re
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
NUM_STUDENTS = 2  # how many registration numbers the user must pick

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
        story.append(Paragraph(f"Source: {source_name} &nbsp;|&nbsp; Generated: {generated_on}", sub_style))
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
        # Compared only where both are numbers: a failed student's FinalOutput says "Fail" instead of a total.
        def differs(a, b):
            a, b = _num(a), _num(b)
            return a is not None and b is not None and not np.isclose(a, b)
        mismatch = (differs(summary["Sum of Credits"], summary["Total Credits (computed)"])
                    or differs(summary["Sum of (Credit * COMB NP)"], summary["Total Credit * COMB-NP (computed)"]))
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
# GUI: pick registration numbers
# --------------------------------------------------------------------------
def select_registration_numbers(parent, all_regd_nos, count=NUM_STUDENTS):
    """Modal dialog with searchable dropdowns. Returns list of selected Regd Nos or None."""
    result = {"value": None}
    win = tk.Toplevel(parent)
    win.title("Select Registration Numbers")
    win.resizable(False, False)
    win.grab_set()

    ttk.Label(win, text=f"Choose {count} registration number{'s' if count != 1 else ''} for the PDF "
                        f"(type to filter, {len(all_regd_nos)} available):"
              ).grid(row=0, column=0, columnspan=2, padx=12, pady=(12, 8), sticky="w")
    # When the file has no more students than are needed, they are all filled in already.
    prefill = all_regd_nos if len(all_regd_nos) <= count else []

    combos = []
    for i in range(count):
        ttk.Label(win, text=f"Registration No {i + 1}:").grid(row=i + 1, column=0, padx=12, pady=4, sticky="e")
        cb = ttk.Combobox(win, values=all_regd_nos, width=30)
        cb.grid(row=i + 1, column=1, padx=12, pady=4)
        if i < len(prefill):
            cb.set(prefill[i])

        def on_key(event, box=cb):  # live filter as the user types
            typed = box.get().strip().lower()
            box["values"] = [r for r in all_regd_nos if typed in r.lower()] or all_regd_nos
        cb.bind("<KeyRelease>", on_key)
        combos.append(cb)

    def on_ok():
        chosen = [cb.get().strip() for cb in combos]
        if any(not c for c in chosen):
            messagebox.showwarning("Incomplete", f"Please select {'the' if count == 1 else f'all {count}'} registration number{'s' if count != 1 else ''}.", parent=win)
            return
        invalid = [c for c in chosen if c not in all_regd_nos]
        if invalid:
            messagebox.showerror("Not found", f"Not in the file: {', '.join(invalid)}", parent=win)
            return
        if len(set(chosen)) != len(chosen):
            messagebox.showwarning("Duplicate", "Please select different registration numbers.", parent=win)
            return
        result["value"] = chosen
        win.destroy()

    btns = ttk.Frame(win)
    btns.grid(row=count + 1, column=0, columnspan=2, pady=12)
    ttk.Button(btns, text="Generate PDF", command=on_ok).pack(side="left", padx=6)
    ttk.Button(btns, text="Cancel", command=win.destroy).pack(side="left", padx=6)
    win.bind("<Return>", lambda e: on_ok())
    win.bind("<Escape>", lambda e: win.destroy())

    combos[0].focus_set()
    parent.wait_window(win)
    return result["value"]


# --------------------------------------------------------------------------
# Main flow
# --------------------------------------------------------------------------
def process_excel():
    root = tk.Tk()
    root.withdraw()

    file_path = filedialog.askopenfilename(
        title="Select the Excel file", filetypes=[("Excel files", "*.xlsx *.xls")])
    if not file_path:
        print("No file selected.")
        return

    try:
        df_consolidated, df_final = load_data(file_path)
    except Exception as e:
        messagebox.showerror("Error reading file", str(e))
        print(f"Error reading the Excel file: {e}")
        return

    all_regd_nos = sorted(df_consolidated["Regd No"].unique().tolist())
    if not all_regd_nos:
        messagebox.showerror("No data", "The file has no registration numbers.")
        return

    # A file with fewer students than NUM_STUDENTS (even just one) still gets a sample: all of its students.
    count = min(NUM_STUDENTS, len(all_regd_nos))
    selected = select_registration_numbers(root, all_regd_nos, count)
    if not selected:
        print("Selection cancelled.")
        return

    file_dir, original_filename = os.path.split(file_path)
    file_base, _ = os.path.splitext(original_filename)
    default_name = f"{file_base} sample grade register {'_'.join(selected)}.pdf"
    output_path = filedialog.asksaveasfilename(
        title="Save PDF as", initialdir=file_dir, initialfile=default_name,
        defaultextension=".pdf", filetypes=[("PDF files", "*.pdf")])
    if not output_path:
        print("Save cancelled.")
        return

    try:
        generate_pdf(df_consolidated, df_final, selected, output_path, source_name=original_filename)
    except PermissionError:
        messagebox.showerror("Save failed", "Cannot write the PDF. Is it open in another program?")
        return
    except Exception as e:
        messagebox.showerror("Error generating PDF", str(e))
        print(f"Error generating PDF: {e}")
        return

    print(f"PDF saved: {output_path}")
    if messagebox.askyesno("Done", f"PDF saved to:\n{output_path}\n\nOpen it now?"):
        try:
            os.startfile(output_path)  # Windows
        except AttributeError:
            import subprocess, sys
            subprocess.call(["open" if sys.platform == "darwin" else "xdg-open", output_path])


if __name__ == "__main__":
    process_excel()