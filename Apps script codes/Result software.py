import tkinter as tk
from tkinter import ttk, filedialog, messagebox, scrolledtext
import pandas as pd
from docx import Document
from docx.shared import Pt, Inches, Cm, RGBColor
from docx.enum.section import WD_ORIENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING, WD_TAB_ALIGNMENT
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ROW_HEIGHT_RULE, WD_CELL_VERTICAL_ALIGNMENT, WD_ALIGN_VERTICAL
from docx.enum.style import WD_STYLE_TYPE
from docx.oxml import OxmlElement, parse_xml
from docx.oxml.ns import qn, nsdecls
import os
from datetime import datetime
import threading
import time
from PIL import Image, ImageTk, ImageDraw
import calendar
import logging
import textwrap
import tempfile

# Configure logging
logging.basicConfig(
    filename='academic_generator.log',
    level=logging.DEBUG,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

# Add this utility function near the top of the file, after the roman_to_int function

def extract_campus_from_regno(regno):
    """
    Extract campus from registration number.
    If regno is 11 digits, 4th digit determines campus.
    If regno is 6 digits, 3rd digit determines campus.
    Campus mapping:
    1 - Prasanthi Nilayam
    2 - Anantapur
    3 - Brindavan
    4 - Nandigiri
    """
    regno_str = str(regno).strip()
    
    # Remove any non-digit characters
    regno_digits = ''.join(filter(str.isdigit, regno_str))
    
    campus_mapping = {
        '1': 'Prasanthi Nilayam',
        '2': 'Anantapur',
        '3': 'Brindavan',
        '4': 'Nandigiri'
    }
    
    if len(regno_digits) == 11:
        # For 11-digit numbers, 4th digit (index 3)
        campus_digit = regno_digits[3]
        return campus_mapping.get(campus_digit, None)
    
    elif len(regno_digits) == 6:
        # For 6-digit numbers, 3rd digit (index 2)
        campus_digit = regno_digits[2]
        return campus_mapping.get(campus_digit, None)
    
    else:
        # If neither 11 nor 6 digits, return None
        logging.warning(f"Registration number {regno} has {len(regno_digits)} digits - expected 11 or 6")
        return None

def roman_to_int(roman_str):
    """Convert Roman numeral to integer"""
    if not isinstance(roman_str, str):
        roman_str = str(roman_str)

    roman_str = roman_str.strip().upper()

    roman_values = {
        'I': 1, 'V': 5, 'X': 10, 'L': 50,
        'C': 100, 'D': 500, 'M': 1000
    }

    total = 0
    prev_value = 0

    for char in reversed(roman_str):
        if char not in roman_values:
            return None
        value = roman_values[char]
        if value < prev_value:
            total -= value
        else:
            total += value
        prev_value = value

    return total

class ModernUI:
    """Helper class for modern UI elements and styling"""
    
    # Minimalistic color palette
    COLORS = {
        'primary': '#2C3E50',
        'primary_light': '#34495E',
        'primary_dark': '#1A252F',
        'secondary': '#7F8C8D',
        'accent': '#3498DB',
        'success': '#27AE60',
        'warning': '#F39C12',
        'error': '#E74C3C',
        'background': '#FFFFFF',
        'card': '#F8F9FA',
        'text_primary': '#2C3E50',
        'text_secondary': '#7F8C8D',
        'border': '#E0E0E0',
        'hover': '#ECF0F1',
    }
    
    FONTS = {
        'heading': ('Segoe UI', 16, 'bold'),
        'subheading': ('Segoe UI', 12, 'bold'),
        'title': ('Segoe UI', 11, 'bold'),
        'body': ('Segoe UI', 9),
        'small': ('Segoe UI', 8),
        'button': ('Segoe UI', 9),
    }
    
    PADDING = {'small': 3, 'medium': 6, 'large': 10, 'xlarge': 15}
    
    @staticmethod
    def setup_styles(style):
        """Configure ttk styles for minimalistic appearance"""
        style.theme_use('clam')
        
        # Configure basic styles
        style.configure('TLabel', 
                       font=ModernUI.FONTS['body'], 
                       foreground=ModernUI.COLORS['text_primary'],
                       background=ModernUI.COLORS['background'])
        
        style.configure('TFrame', 
                       background=ModernUI.COLORS['background'])
        
        # Button styles - flat design
        style.configure('TButton', 
                       font=ModernUI.FONTS['button'],
                       borderwidth=1,
                       relief='flat',
                       padding=(8, 4))
        
        style.map('TButton',
                 background=[('active', ModernUI.COLORS['hover']),
                           ('pressed', ModernUI.COLORS['primary_light'])])
        
        # Primary button - minimal style
        style.configure('Primary.TButton', 
                       background=ModernUI.COLORS['primary'],
                       foreground='white',
                       borderwidth=0)
        
        style.map('Primary.TButton',
                 background=[('active', ModernUI.COLORS['primary_dark']),
                           ('pressed', ModernUI.COLORS['primary_dark'])])
        
        # Success button
        style.configure('Success.TButton', 
                       background=ModernUI.COLORS['success'],
                       foreground='white',
                       borderwidth=0)
        
        style.map('Success.TButton',
                 background=[('active', '#229954')])
        
        # Danger button
        style.configure('Danger.TButton', 
                       background=ModernUI.COLORS['error'],
                       foreground='white',
                       borderwidth=0)
        
        style.map('Danger.TButton',
                 background=[('active', '#C0392B')])
        
        # Accent button
        style.configure('Accent.TButton', 
                       background=ModernUI.COLORS['accent'],
                       foreground='white',
                       borderwidth=0)
        
        style.map('Accent.TButton',
                 background=[('active', '#2980B9')])
        
        # Heading styles - simplified
        style.configure('Heading.TLabel', 
                       font=ModernUI.FONTS['heading'], 
                       foreground=ModernUI.COLORS['text_primary'])
        
        style.configure('Title.TLabel', 
                       font=ModernUI.FONTS['title'], 
                       foreground=ModernUI.COLORS['text_primary'])
        
        # Entry and Combobox - minimal borders
        style.configure('TEntry', 
                       font=ModernUI.FONTS['body'],
                       fieldbackground=ModernUI.COLORS['background'],
                       borderwidth=1,
                       relief='solid')
        
        style.configure('TCombobox', 
                       font=ModernUI.FONTS['body'],
                       fieldbackground=ModernUI.COLORS['background'],
                       borderwidth=1,
                       relief='solid')
        
        # LabelFrame - minimal border
        style.configure('TLabelframe', 
                       background=ModernUI.COLORS['background'],
                       borderwidth=1,
                       relief='solid')
        
        style.configure('TLabelframe.Label',
                       font=ModernUI.FONTS['title'],
                       foreground=ModernUI.COLORS['text_primary'],
                       background=ModernUI.COLORS['background'])

class ProgressDialog:
    """Modern progress dialog with detailed status"""
    
    def __init__(self, parent, title="Working...", message="Please wait", cancelable=False):
        self.parent = parent
        self.title = title
        self.message = message
        self.dialog = None
        self.progress_var = tk.DoubleVar(value=0)
        self.message_var = tk.StringVar(value=message)
        
    def show(self):
        """Show the minimalistic progress dialog"""
        self.dialog = tk.Toplevel(self.parent)
        self.dialog.title(self.title)
        self.dialog.transient(self.parent)
        self.dialog.resizable(False, False)
        self.dialog.protocol("WM_DELETE_WINDOW", self._on_close)
    
        # Center dialog
        self.dialog.update_idletasks()
        parent_x = self.parent.winfo_rootx()
        parent_y = self.parent.winfo_rooty()
        parent_width = self.parent.winfo_width()
        parent_height = self.parent.winfo_height()
        
        dialog_width = 350
        dialog_height = 120
        
        x = parent_x + (parent_width - dialog_width) // 2
        y = parent_y + (parent_height - dialog_height) // 2
        
        self.dialog.geometry(f"{dialog_width}x{dialog_height}+{x}+{y}")
        
        # Content frame - minimal padding
        frame = ttk.Frame(self.dialog, padding=ModernUI.PADDING['medium'])
        frame.pack(fill=tk.BOTH, expand=True)
        
        # Title - smaller font
        title_label = ttk.Label(frame, text=self.title, font=ModernUI.FONTS['title'])
        title_label.pack(anchor=tk.W, pady=(0, ModernUI.PADDING['small']))
        
        # Message
        message_label = ttk.Label(frame, textvariable=self.message_var, 
                                font=ModernUI.FONTS['small'])
        message_label.pack(anchor=tk.W, pady=(0, ModernUI.PADDING['small']))
        
        # Progress bar - thinner
        progress_bar = ttk.Progressbar(frame, variable=self.progress_var, 
                                    mode='determinate', length=300)
        progress_bar.pack(fill=tk.X, pady=ModernUI.PADDING['small'])
        
        # Make dialog modal
        self.dialog.grab_set()
        
    def update_progress(self, value, message=None):
        """Update progress value and optionally message"""
        self.progress_var.set(value)
        if message:
            self.message_var.set(message)
        if self.dialog:
            self.dialog.update_idletasks()
        
    def close(self):
        """Close the dialog"""
        if self.dialog:
            self.dialog.grab_release()
            self.dialog.destroy()
            
    def _on_close(self):
        """Handle window close attempt"""
        pass

class DocumentProcessor:
    """Base class for document processing functionality"""
    
    @staticmethod
    def set_document_defaults(doc):
        """Set document defaults for consistent rendering"""
        styles = doc.styles
        default_style = styles['Normal']
        default_style.font.name = 'Courier New'
        default_style.font.size = Pt(12)
        default_style.paragraph_format.space_before = Pt(0)
        default_style.paragraph_format.space_after = Pt(0)
        default_style.paragraph_format.line_spacing = 1.0
    
    @staticmethod
    def configure_section(doc, orientation="Portrait", use_tight_margins=False):
        """Configure document section"""
        section = doc.sections[0] if doc.sections else doc.add_section()

        if orientation.lower() == "landscape":
            section.orientation = WD_ORIENT.LANDSCAPE
            section.page_width = Cm(29.7)
            section.page_height = Cm(21.0)
        else:
            section.orientation = WD_ORIENT.PORTRAIT
            section.page_width = Cm(21.0)
            section.page_height = Cm(29.7)

        if use_tight_margins:
            # 0.5 inch margins for result sheets
            section.left_margin = Inches(0.5)
            section.right_margin = Inches(0.5)
            section.top_margin = Inches(0.5)
            section.bottom_margin = Inches(0.5)
            section.header_distance = Inches(0.3)
            section.footer_distance = Inches(0.3)
        else:
            section.left_margin = Cm(1.5)
            section.right_margin = Cm(1.5)
            section.top_margin = Cm(1.5)
            section.bottom_margin = Cm(1.5)

        return section
    
    @staticmethod
    def add_page_numbers(doc, simple_format=False):
        """Add page numbers to the footer"""
        sections = doc.sections
        for section in sections:
            footer = section.footer
            paragraph = footer.paragraphs[0] if footer.paragraphs else footer.add_paragraph()
            paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT
            paragraph.paragraph_format.space_before = Pt(0)
            paragraph.paragraph_format.space_after = Pt(0)

            if simple_format:
                # Page number format for result sheets: "Page X of Y" (10pt)
                # Add 'Page ' prefix
                run = paragraph.add_run('Page ')
                run.font.name = 'Courier New'
                run.font.size = Pt(10)
                run.font.bold = True

                # Add current page number
                run = paragraph.add_run()
                run.font.name = 'Courier New'
                run.font.size = Pt(10)
                run.font.bold = True

                fldChar1 = OxmlElement('w:fldChar')
                fldChar1.set(qn('w:fldCharType'), 'begin')

                instrText = OxmlElement('w:instrText')
                instrText.set(qn('xml:space'), 'preserve')
                instrText.text = 'PAGE'

                fldChar2 = OxmlElement('w:fldChar')
                fldChar2.set(qn('w:fldCharType'), 'end')

                r_element = run._r
                r_element.append(fldChar1)
                r_element.append(instrText)
                r_element.append(fldChar2)

                # Add ' of ' separator
                run = paragraph.add_run(' of ')
                run.font.name = 'Courier New'
                run.font.size = Pt(10)
                run.font.bold = True

                # Add total pages
                run = paragraph.add_run()
                run.font.name = 'Courier New'
                run.font.size = Pt(10)
                run.font.bold = True

                fldChar3 = OxmlElement('w:fldChar')
                fldChar3.set(qn('w:fldCharType'), 'begin')

                instrText2 = OxmlElement('w:instrText')
                instrText2.set(qn('xml:space'), 'preserve')
                instrText2.text = 'NUMPAGES'

                fldChar4 = OxmlElement('w:fldChar')
                fldChar4.set(qn('w:fldCharType'), 'end')

                r_element = run._r
                r_element.append(fldChar3)
                r_element.append(instrText2)
                r_element.append(fldChar4)
            else:
                # Add 'Page ' prefix
                run = paragraph.add_run('Page ')
                run.font.name = 'Courier New'
                run.font.size = Pt(10)
                run.font.bold = True

                # Add current page number
                fldChar1 = OxmlElement('w:fldChar')
                fldChar1.set(qn('w:fldCharType'), 'begin')

                instrText = OxmlElement('w:instrText')
                instrText.set(qn('xml:space'), 'preserve')
                instrText.text = 'PAGE'

                fldChar2 = OxmlElement('w:fldChar')
                fldChar2.set(qn('w:fldCharType'), 'end')

                r_element = run._r
                r_element.append(fldChar1)
                r_element.append(instrText)
                r_element.append(fldChar2)

                # Add ' of ' separator
                run = paragraph.add_run(' of ')
                run.font.name = 'Courier New'
                run.font.size = Pt(10)
                run.font.bold = True

                # Add total pages
                run = paragraph.add_run()
                run.font.name = 'Courier New'
                run.font.size = Pt(10)
                run.font.bold = True

                fldChar3 = OxmlElement('w:fldChar')
                fldChar3.set(qn('w:fldCharType'), 'begin')

                instrText2 = OxmlElement('w:instrText')
                instrText2.set(qn('xml:space'), 'preserve')
                instrText2.text = 'NUMPAGES'

                fldChar4 = OxmlElement('w:fldChar')
                fldChar4.set(qn('w:fldCharType'), 'end')

                r_element = run._r
                r_element.append(fldChar3)
                r_element.append(instrText2)
                r_element.append(fldChar4)
    
    @staticmethod
    def remove_table_borders(table):
        """Remove all borders from a table"""
        tbl = table._tbl
        tblPr = tbl.xpath('./w:tblPr')
        if tblPr:
            tblPr = tblPr[0]
        else:
            tblPr = OxmlElement('w:tblPr')
            tbl.insert(0, tblPr)
        
        # Create borders element with nil values
        tblBorders = OxmlElement('w:tblBorders')
        
        for border in ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']:
            borderElem = OxmlElement(f'w:{border}')
            borderElem.set(qn('w:val'), 'nil')
            tblBorders.append(borderElem)
        
        # Remove existing borders
        existing_borders = tblPr.find(qn('w:tblBorders'))
        if existing_borders is not None:
            tblPr.remove(existing_borders)
        
        # Add new borders with nil values
        tblPr.append(tblBorders)

    @staticmethod
    def set_table_alignment(table, alignment):
        """Set table alignment (left, center, or right)"""
        tbl = table._tbl
        tblPr = tbl.xpath('./w:tblPr')
        if tblPr:
            tblPr = tblPr[0]
        else:
            tblPr = OxmlElement('w:tblPr')
            tbl.insert(0, tblPr)

        # Remove existing alignment
        existing_align = tblPr.find(qn('w:jc'))
        if existing_align is not None:
            tblPr.remove(existing_align)

        # Add new alignment
        jc = OxmlElement('w:jc')
        jc.set(qn('w:val'), alignment)
        tblPr.append(jc)

    @staticmethod
    def add_separator_line(doc, space_before=6, space_after=6):
        """Add a dashed separator line"""
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_before = Pt(space_before)
        p.paragraph_format.space_after = Pt(space_after)
        p.paragraph_format.line_spacing = 1.0
        # For landscape, available width is approximately 26 cm
        dash_count = 270  # Increased for full width
        separator_run = p.add_run('‐' * dash_count)
        separator_run.font.name = "Calibri"
        separator_run.font.size = Pt(9)
        separator_run.font.bold = False

    @staticmethod
    def set_repeat_table_header(row):
        tr = row._tr
        trPr = tr.get_or_add_trPr()
        tblHeader = OxmlElement('w:tblHeader')
        tblHeader.set(qn('w:val'), "true")
        trPr.append(tblHeader)
        return row

class AcademicDocumentGenerator:
    """Main application class combining all document generation functionalities"""
    
    def __init__(self, root):
        self.root = root
        self.root.title("Academic Document Generator")
        self.root.geometry("1100x750")  # Slightly smaller
        self.root.minsize(900, 650)
        
        # Configure modern styling
        self.style = ttk.Style()
        ModernUI.setup_styles(self.style)
        
        # Set global background color
        self.root.configure(bg=ModernUI.COLORS['background'])
        
        self.programme_mapping_file = r"Z:\Chandra\Results Processing - November 2025\List of Programmes.xlsx"
        
        # Initialize variables
        self.init_variables()
        
        # Create UI
        self.create_ui()
        
        # Set default values
        self.set_defaults()
    
    def init_variables(self):
        """Initialize all tkinter variables"""
        # File paths
        self.excel_path = tk.StringVar()

        # Common settings
        self.campus = tk.StringVar()
        self.semester = tk.StringVar()
        self.batch = tk.StringVar()
        self.program_type = tk.StringVar()
        self.examination_month = tk.StringVar()

        # Document settings
        self.orientation = tk.StringVar()
        self.document_type = tk.StringVar()
        self.program_type_cgpa = tk.StringVar()
        self.program_name = tk.StringVar()

        # Status
        self.status_var = tk.StringVar()

        # Data storage
        self.student_data = []
        self.selected_students = []
    
    def set_defaults(self):
        """Set default values for variables"""
        self.campus.set("Prasanthi Nilayam")
        self.semester.set("01")
        self.batch.set(str(datetime.now().year))
        self.program_type.set("UNDERGRADUATE")
        self.orientation.set("Portrait")
        self.document_type.set("Result Sheet")
        self.program_type_cgpa.set("UG")

        # Set current month and year
        # Commented out automatic month detection - hard coded to November
        # current_date = datetime.now()
        # self.examination_month.set(f"{current_date.strftime('%B')} {current_date.year}")
        self.examination_month.set("November 2025")

        self.status_var.set("Ready. Please select document type and files to begin.")
    
    def create_ui(self):
        """Create the main user interface"""
        # Main container
        main_container = ttk.Frame(self.root)
        main_container.pack(fill=tk.BOTH, expand=True)

        # Header
        self.create_header(main_container)

        # Create notebook for tabs
        self.notebook = ttk.Notebook(main_container)
        self.notebook.pack(fill=tk.BOTH, expand=True)

        # Create single unified tab
        self.create_unified_tab(self.notebook)

        # Status bar
        self.create_status_bar(main_container)
    
    def create_header(self, parent):
        header_frame = ttk.Frame(parent)
        header_frame.pack(fill=tk.X, padx=ModernUI.PADDING['large'], 
                     pady=ModernUI.PADDING['medium'])
    
        # Simple divider line
        separator = ttk.Separator(header_frame, orient='horizontal')
        separator.pack(fill=tk.X, pady=(0, ModernUI.PADDING['small']))
    
        # App title - centered and simple
        title_container = ttk.Frame(header_frame)
        title_container.pack(fill=tk.X)
        
        title_label = ttk.Label(
            title_container, 
            text="Academic Document Generator", 
            style='Heading.TLabel'
        )
        title_label.pack()
        
        # Simple divider line
        separator = ttk.Separator(header_frame, orient='horizontal')
        separator.pack(fill=tk.X, pady=(ModernUI.PADDING['small'], 0))
    
    def create_unified_tab(self, parent):
        """Create unified tab for all document types"""
        # Create tab frame
        tab_frame = ttk.Frame(parent)
        parent.add(tab_frame, text="  Document Generator  ")

        # Create scrollable frame
        canvas = tk.Canvas(tab_frame, bg=ModernUI.COLORS['background'])
        scrollbar = ttk.Scrollbar(tab_frame, orient="vertical", command=canvas.yview)
        scrollable_frame = ttk.Frame(canvas)

        scrollable_frame.bind(
            "<Configure>",
            lambda e: canvas.configure(scrollregion=canvas.bbox("all"))
        )

        canvas.create_window((0, 0), window=scrollable_frame, anchor="nw")
        canvas.configure(yscrollcommand=scrollbar.set)

        # Document Type Selection
        doc_type_section = ttk.LabelFrame(scrollable_frame, text="Document Type",
                                         padding=ModernUI.PADDING['medium'])
        doc_type_section.pack(fill=tk.X, padx=ModernUI.PADDING['medium'], pady=ModernUI.PADDING['small'])

        doc_types = ["Result Sheet","Failure List"]
        for doc_type in doc_types:
            ttk.Radiobutton(doc_type_section, text=doc_type,
                          variable=self.document_type, value=doc_type,
                          command=self.on_document_type_change).pack(side=tk.LEFT,
                                                                     padx=ModernUI.PADDING['medium'])

        # File selection section
        file_section = ttk.LabelFrame(scrollable_frame, text="File Selection",
                                    padding=ModernUI.PADDING['medium'])
        file_section.pack(fill=tk.X, padx=ModernUI.PADDING['medium'], pady=ModernUI.PADDING['small'])

        # Single Excel file for all document types
        excel_frame = ttk.Frame(file_section)
        excel_frame.pack(fill=tk.X, pady=ModernUI.PADDING['small'])
        ttk.Label(excel_frame, text="Excel File:").pack(side=tk.LEFT,
                                                        padx=(0, ModernUI.PADDING['small']))
        ttk.Entry(excel_frame, textvariable=self.excel_path, state="readonly").pack(
            side=tk.LEFT, fill=tk.X, expand=True, padx=(0, ModernUI.PADDING['small']))
        ttk.Button(excel_frame, text="Browse", command=self.browse_excel_file,
                style='Primary.TButton').pack(side=tk.RIGHT)

        # Settings section
        settings_section = ttk.LabelFrame(scrollable_frame, text="Document Settings",
                                        padding=ModernUI.PADDING['medium'])
        settings_section.pack(fill=tk.X, padx=ModernUI.PADDING['medium'], pady=ModernUI.PADDING['small'])

        # Create settings grid
        settings_grid = ttk.Frame(settings_section)
        settings_grid.pack(fill=tk.X)

        # Configure grid columns
        for i in range(4):
            settings_grid.columnconfigure(i, weight=1)

        # Settings rows
        settings_data = [
            ("Campus:", self.campus, ["Prasanthi Nilayam", "Anantapur", "Brindavan", "Nandigiri"]),
            ("Batch:", self.batch, [str(year) for year in range(2020, datetime.now().year + 1)]),
            ("Program Type:", self.program_type, ["UNDERGRADUATE", "POSTGRADUATE", "PROFESSIONAL"])
        ]

        for i, (label, variable, values) in enumerate(settings_data):
            row = i // 2
            col = (i % 2) * 2

            ttk.Label(settings_grid, text=label).grid(row=row, column=col, sticky="w",
                                                     padx=ModernUI.PADDING['small'],
                                                     pady=ModernUI.PADDING['small'])

            if values:
                combo = ttk.Combobox(settings_grid, textvariable=variable, values=values,
                                   state="readonly", width=20)
                combo.grid(row=row, column=col+1, sticky="ew",
                          padx=ModernUI.PADDING['small'], pady=ModernUI.PADDING['small'])
            else:
                entry = ttk.Entry(settings_grid, textvariable=variable, width=20)
                entry.grid(row=row, column=col+1, sticky="ew",
                          padx=ModernUI.PADDING['small'], pady=ModernUI.PADDING['small'])

        

        # Examination month
        exam_frame = ttk.Frame(settings_section)
        exam_frame.pack(fill=tk.X, pady=ModernUI.PADDING['small'])
        ttk.Label(exam_frame, text="Examination Month:").pack(side=tk.LEFT,
                                                            padx=(0, ModernUI.PADDING['small']))
        ttk.Entry(exam_frame, textvariable=self.examination_month).pack(side=tk.LEFT,
                                                                      fill=tk.X, expand=True)

        # CGPA Program Type (shown only for Gracing Lists)
        self.cgpa_program_type_frame = ttk.Frame(settings_section)
        self.cgpa_program_type_frame.pack(fill=tk.X, pady=ModernUI.PADDING['small'])
        ttk.Label(self.cgpa_program_type_frame, text="CGPA Program Type:").pack(side=tk.LEFT,
                                                                               padx=(0, ModernUI.PADDING['small']))
        ttk.Radiobutton(self.cgpa_program_type_frame, text="Undergraduate (UG)",
                       variable=self.program_type_cgpa, value="UG").pack(side=tk.LEFT,
                                                                         padx=(0, ModernUI.PADDING['medium']))
        ttk.Radiobutton(self.cgpa_program_type_frame, text="Postgraduate (PG-PRO)",
                       variable=self.program_type_cgpa, value="PG-PRO").pack(side=tk.LEFT)

        # Orientation (shown only for failure lists)
        self.orientation_frame = ttk.Frame(settings_section)
        self.orientation_frame.pack(fill=tk.X, pady=ModernUI.PADDING['small'])
        ttk.Label(self.orientation_frame, text="Page Orientation:").pack(side=tk.LEFT,
                                                                        padx=(0, ModernUI.PADDING['small']))
        ttk.Radiobutton(self.orientation_frame, text="Portrait", variable=self.orientation,
                       value="Portrait").pack(side=tk.LEFT, padx=(0, ModernUI.PADDING['medium']))
        ttk.Radiobutton(self.orientation_frame, text="Landscape", variable=self.orientation,
                       value="Landscape").pack(side=tk.LEFT)

        # Student selection section (for failure lists)
        self.student_section = ttk.LabelFrame(scrollable_frame, text="Student Selection",
                                             padding=ModernUI.PADDING['medium'])
        self.student_section.pack(fill=tk.BOTH, expand=True, padx=ModernUI.PADDING['medium'],
                                 pady=ModernUI.PADDING['small'])

        # Search frame
        search_frame = ttk.Frame(self.student_section)
        search_frame.pack(fill=tk.X, pady=(0, ModernUI.PADDING['small']))
        ttk.Label(search_frame, text="Search:").pack(side=tk.LEFT,
                                                   padx=(0, ModernUI.PADDING['small']))
        self.search_var = tk.StringVar()
        search_entry = ttk.Entry(search_frame, textvariable=self.search_var, width=30)
        search_entry.pack(side=tk.LEFT, padx=(0, ModernUI.PADDING['medium']))
        ttk.Button(search_frame, text="Select All",
                  command=lambda: self.toggle_all_students(True)).pack(side=tk.LEFT,
                                                                      padx=ModernUI.PADDING['small'])
        ttk.Button(search_frame, text="Deselect All",
                  command=lambda: self.toggle_all_students(False)).pack(side=tk.LEFT)

        # Student list frame
        self.student_list_frame = ttk.Frame(self.student_section)
        self.student_list_frame.pack(fill=tk.BOTH, expand=True, pady=ModernUI.PADDING['small'])
        self.show_student_placeholder()

        # Actions section
        actions_section = ttk.Frame(scrollable_frame)
        actions_section.pack(fill=tk.X, padx=ModernUI.PADDING['medium'], pady=ModernUI.PADDING['medium'])

        ttk.Button(actions_section, text="Load Data",
                  command=self.load_data_unified,
                  style='Primary.TButton').pack(side=tk.RIGHT, padx=ModernUI.PADDING['small'])

        ttk.Button(actions_section, text="Generate Document",
                  command=self.generate_document_unified,
                  style='Accent.TButton').pack(side=tk.RIGHT, padx=ModernUI.PADDING['small'])

        # Pack canvas and scrollbar
        canvas.pack(side="left", fill="both", expand=True, padx=ModernUI.PADDING['medium'],
                   pady=ModernUI.PADDING['medium'])
        scrollbar.pack(side="right", fill="y", pady=ModernUI.PADDING['medium'])

        # Initial visibility update
        self.on_document_type_change()

    def on_document_type_change(self):
    
        doc_type = self.document_type.get()

        if doc_type == "Result Sheet":
            # Hide CGPA and failure-specific options
            self.cgpa_program_type_frame.pack_forget()
            self.orientation_frame.pack_forget()
            self.student_section.pack_forget()

        elif doc_type == "Gracing List":
            # Show CGPA program type, hide others
            self.cgpa_program_type_frame.pack(fill=tk.X, pady=ModernUI.PADDING['small'])
            self.orientation_frame.pack_forget()
            self.student_section.pack_forget()

        elif doc_type == "Failure List":
            # Show orientation and student selection
            self.cgpa_program_type_frame.pack_forget()
            self.orientation_frame.pack(fill=tk.X, pady=ModernUI.PADDING['small'])
            self.student_section.pack(fill=tk.BOTH, expand=True, padx=ModernUI.PADDING['medium'],
                                    pady=ModernUI.PADDING['small'])

    def load_data_unified(self):
        """Load data based on selected document type"""
        doc_type = self.document_type.get()

        if doc_type == "Result Sheet":
            self.load_result_sheet_data()
        elif doc_type == "Gracing List":
            self.load_gracing_data()
        elif doc_type == "Failure List":
            self.load_failure_data()

    def generate_document_unified(self):
        """Generate document based on selected type"""
        doc_type = self.document_type.get()

        if doc_type == "Result Sheet":
            self.generate_result_sheet()
        elif doc_type == "Gracing List":
            self.generate_gracing_list()
        elif doc_type == "Failure List":
            self.generate_failure_list()
    
    def generate_result_sheet(self):
        """Generate result sheet document"""
        if not hasattr(self, 'result_sheet_data'):
            messagebox.showerror("Error", "Please load result sheet data first")
            return
        
        # Show progress dialog
        progress = ProgressDialog(self.root, "Generating Result Sheet", "Creating document...")
        progress.show()
        
        # Use threading to prevent UI freeze
        threading.Thread(target=self._generate_result_sheet_thread, 
                        args=(progress,), daemon=True).start()
    
    def _generate_result_sheet_thread(self, progress):
        """Background thread for result sheet generation"""
        try:
            progress.update_progress(10, "Setting up document...")
            
            # Create document
            doc = Document()
            DocumentProcessor.set_document_defaults(doc)
            
            # Result sheet always uses portrait orientation
            DocumentProcessor.configure_section(doc, orientation="Portrait")
            DocumentProcessor.add_page_numbers(doc)
            
            progress.update_progress(30, "Adding header...")
            
            # Add header
            self._add_result_sheet_header(doc)
            
            progress.update_progress(60, "Processing result data...")
            
            # Add result data
            self._add_result_sheet_data(doc)
            
            progress.update_progress(90, "Finalizing document...")
            
            # Save document
            self.root.after(0, lambda: self._save_document(doc, "Result_Sheet", progress))
            
        except Exception as e:
            error_msg = str(e)
            self.root.after(0, lambda: self._handle_generation_error(error_msg, progress))
    
    def _add_result_sheet_header(self, doc):
        """Add header for result sheet"""
        # University header
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = p.add_run("Sri Sathya Sai Institute of Higher Learning")
        run.bold = True
        run.font.name = 'Courier New'
        run.font.size = Pt(12)
        
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = p.add_run("(Deemed to be University)")
        run.bold = True
        run.font.name = 'Courier New'
        run.font.size = Pt(12)
        
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = p.add_run("Vidyagiri, Prasanthi Nilayam")
        run.bold = True
        run.font.name = 'Courier New'
        run.font.size = Pt(12)
        
        # Title
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = p.add_run("\nRESULT SHEET")
        run.bold = True
        run.font.name = 'Courier New'
        run.font.size = Pt(12)
        
        # Examination details
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = p.add_run(f"END SEMESTER EXAMINATIONS - {self.examination_month.get()}")
        run.bold = True
        run.font.name = 'Courier New'
        run.font.size = Pt(12)

        # Program Type
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = p.add_run(f"{self.program_type.get()} PROGRAMMES")
        run.bold = True
        run.font.name = 'Courier New'
        run.font.size = Pt(12)
        
        # Batch and Semester on one line
        p = doc.add_paragraph()
        # Set tab stop for right alignment (Page width 21cm - 3cm margins = 18cm)
        p.paragraph_format.tab_stops.add_tab_stop(Cm(18.0), WD_TAB_ALIGNMENT.RIGHT)
        
        # Batch (Left)
        run = p.add_run(f"Batch: {self.batch.get()}")
        run.bold = True
        run.font.name = 'Courier New'
        run.font.size = Pt(12)
        
        run = p.add_run("\t")
        
        # Semester (Right)
        semester = self.semester.get()
        run = p.add_run(f"Semester: {semester}")
        run.bold = True
        run.font.name = 'Courier New'
        run.font.size = Pt(12)

        # Campus on separate line (Left)
        campus = self.campus.get()
        if campus != "All":
            p = doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.LEFT
            run = p.add_run(f"{campus} Campus")
            run.bold = True
            run.font.name = 'Courier New'
            run.font.size = Pt(12)
        
        # Add spacing
        doc.add_paragraph()

    def create_result_sheet_tab(self):
        """Create result sheet generation tab"""
        tab_frame = ttk.Frame(self.notebook)
        self.notebook.add(tab_frame, text="  Result Sheets  ")
        
        # Create scrollable frame
        canvas = tk.Canvas(tab_frame, bg=ModernUI.COLORS['background'])
        scrollbar = ttk.Scrollbar(tab_frame, orient="vertical", command=canvas.yview)
        scrollable_frame = ttk.Frame(canvas)
        
        scrollable_frame.bind(
            "<Configure>",
            lambda e: canvas.configure(scrollregion=canvas.bbox("all"))
        )
        
        canvas.create_window((0, 0), window=scrollable_frame, anchor="nw")
        canvas.configure(yscrollcommand=scrollbar.set)
        
        # File selection section
        file_section = ttk.LabelFrame(scrollable_frame, text="File Selection", padding=ModernUI.PADDING['medium'])
        file_section.pack(fill=tk.X, padx=ModernUI.PADDING['medium'], pady=ModernUI.PADDING['small'])
        
        # Excel file selection
        excel_frame = ttk.Frame(file_section)
        excel_frame.pack(fill=tk.X, pady=ModernUI.PADDING['small'])
        
        ttk.Label(excel_frame, text="Excel File:").pack(side=tk.LEFT, padx=(0, ModernUI.PADDING['small']))
        ttk.Entry(excel_frame, textvariable=self.excel_path, state="readonly").pack(
            side=tk.LEFT, fill=tk.X, expand=True, padx=(0, ModernUI.PADDING['small']))
        ttk.Button(excel_frame, text="Browse", command=self.browse_excel_file, 
                  style='Primary.TButton').pack(side=tk.RIGHT)
        
        # Settings section
        settings_section = ttk.LabelFrame(scrollable_frame, text="Document Settings", 
                                        padding=ModernUI.PADDING['medium'])
        settings_section.pack(fill=tk.X, padx=ModernUI.PADDING['medium'], pady=ModernUI.PADDING['small'])
        
        # Create settings grid
        settings_grid = ttk.Frame(settings_section)
        settings_grid.pack(fill=tk.X)
        
        # Configure grid columns
        for i in range(4):
            settings_grid.columnconfigure(i, weight=1)
        
        # Settings rows
        settings_data = [
            ("Campus:", self.campus, ["Prasanthi Nilayam", "Anantapur", "Brindavan", "Nandigiri"]),
            ("Batch:", self.batch, [str(year) for year in range(2020, datetime.now().year + 1)]),
            ("Program Type:", self.program_type, ["UNDERGRADUATE", "POSTGRADUATE", "PROFESSIONAL"])
        ]
        
        for i, (label, variable, values) in enumerate(settings_data):
            row = i // 2
            col = (i % 2) * 2
            
            ttk.Label(settings_grid, text=label).grid(row=row, column=col, sticky="w", 
                                                     padx=ModernUI.PADDING['small'], 
                                                     pady=ModernUI.PADDING['small'])
            
            if values:
                combo = ttk.Combobox(settings_grid, textvariable=variable, values=values, 
                                   state="readonly", width=20)
                combo.grid(row=row, column=col+1, sticky="ew", 
                          padx=ModernUI.PADDING['small'], pady=ModernUI.PADDING['small'])
            else:
                entry = ttk.Entry(settings_grid, textvariable=variable, width=20)
                entry.grid(row=row, column=col+1, sticky="ew", 
                          padx=ModernUI.PADDING['small'], pady=ModernUI.PADDING['small'])
        
        # Program name
        program_frame = ttk.Frame(settings_section)
        program_frame.pack(fill=tk.X, pady=ModernUI.PADDING['small'])
        
        ttk.Label(program_frame, text="Program Name:").pack(side=tk.LEFT, 
                                                           padx=(0, ModernUI.PADDING['small']))
        ttk.Entry(program_frame, textvariable=self.program_name).pack(side=tk.LEFT, 
                                                                    fill=tk.X, expand=True)
        
        # Examination month
        exam_frame = ttk.Frame(settings_section)
        exam_frame.pack(fill=tk.X, pady=ModernUI.PADDING['small'])
        
        ttk.Label(exam_frame, text="Examination Month:").pack(side=tk.LEFT, 
                                                            padx=(0, ModernUI.PADDING['small']))
        ttk.Entry(exam_frame, textvariable=self.examination_month).pack(side=tk.LEFT, 
                                                                      fill=tk.X, expand=True)
        
        # Actions section
        actions_section = ttk.Frame(scrollable_frame)
        actions_section.pack(fill=tk.X, padx=ModernUI.PADDING['medium'], pady=ModernUI.PADDING['medium'])
        
        ttk.Button(actions_section, text="Generate Result Sheet", 
                  command=lambda: self.generate_document("result_sheet"),
                  style='Accent.TButton').pack(side=tk.RIGHT, padx=ModernUI.PADDING['small'])
        
        ttk.Button(actions_section, text="Load Student Data", 
                  command=self.load_result_sheet_data,
                  style='Primary.TButton').pack(side=tk.RIGHT, padx=ModernUI.PADDING['small'])
        
        # Pack canvas and scrollbar
        canvas.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")
    
    def load_gracing_data(self):
        """Load gracing list data"""
        if not self.excel_path.get():
            messagebox.showerror("Error", "Please select an Excel file first")
            return
        
        self.status_var.set("Loading gracing list data...")
        
        # Use threading to prevent UI freeze
        threading.Thread(target=self._load_gracing_data_thread, daemon=True).start()

    def _load_gracing_data_thread(self):
        """Background thread for loading gracing data"""
        try:
            # Read the Excel file - adjust sheet name as needed
            df = pd.read_excel(self.excel_path.get(), sheet_name='GracingList')
            
            # Store the data
            self.gracing_data = df
            
            # Automatically detect and set semester from the data
            semester_column = None
            for col_name in ['Semester', 'semester', 'SEM', 'Sem']:
                if col_name in df.columns:
                    semester_column = col_name
                    break

            if semester_column:
                semester_value = df[semester_column].dropna().iloc[0] if not df[semester_column].dropna().empty else None
                if semester_value is not None:
                    semester_int = roman_to_int(semester_value)
                    if semester_int is not None:
                        semester_str = f"{semester_int:02d}"
                        self.root.after(0, lambda s=semester_str: self.semester.set(s))
            
            # Update UI from main thread
            self.root.after(0, lambda: self.status_var.set("Gracing list data loaded successfully"))
            
        except Exception as e:
            error_msg = str(e)
            self.root.after(0, lambda: messagebox.showerror("Error", f"Failed to load gracing data: {error_msg}"))
            self.root.after(0, lambda: self.status_var.set("Failed to load gracing data"))

    def generate_gracing_list(self):
        """Generate gracing list document"""
        if not hasattr(self, 'gracing_data'):
            messagebox.showerror("Error", "Please load gracing data first")
            return

        # Show progress dialog
        progress = ProgressDialog(self.root, "Generating Gracing List", "Creating document...")
        progress.show()

        # Use threading to prevent UI freeze
        threading.Thread(target=self._generate_gracing_list_thread, 
                        args=(progress,), daemon=True).start()

    def _generate_gracing_list_thread(self, progress):
        """Background thread for gracing list generation"""
        try:
            progress.update_progress(10, "Setting up document...")

            # Create document
            doc = Document()
            DocumentProcessor.set_document_defaults(doc)
            DocumentProcessor.configure_section(doc, use_tight_margins=True)
            DocumentProcessor.add_page_numbers(doc, simple_format=True)
        
            progress.update_progress(30, "Adding header...")
        
            # Add header
            self._add_gracing_header(doc)
        
            progress.update_progress(60, "Processing gracing data...")
        
            # Add gracing data
            self._add_gracing_data(doc)
        
            progress.update_progress(80, "Adding footer notes...")
        
            # Add footer notes
            self._add_gracing_footer(doc)
        
            progress.update_progress(90, "Finalizing document...")
        
            # Save document
            self.root.after(0, lambda: self._save_document(doc, "Gracing_List", progress))
        
        except Exception as e:
            error_msg = str(e)
            self.root.after(0, lambda: self._handle_generation_error(error_msg, progress))

    def _add_gracing_header(self, doc):
        """Add header to the gracing list document"""

        def center_para(text, bold=True, italic=False, space_before=0, space_after=0):
            p = doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            p.paragraph_format.space_before = Pt(space_before)
            p.paragraph_format.space_after = Pt(space_after)
            p.paragraph_format.line_spacing = 1.0
            run = p.add_run(text)
            run.bold = bold
            run.italic = italic
            run.font.name = "Courier New"
            run.font.size = Pt(12)
            return p

        # Header with exact spacing
        center_para("Sri Sathya Sai Institute of Higher Learning", bold=True, space_after=0)

        # Examination details
        center_para(f"{self.examination_month.get()} Examinations", bold=True, space_before=0, space_after=10)

        # Create table for batch/program/semester line
        table1 = doc.add_table(rows=1, cols=3)
        table1.style = 'Table Grid'

        table_width = 7.0
        table1.width = Inches(table_width)
        DocumentProcessor.set_table_alignment(table1, 'center')
        DocumentProcessor.remove_table_borders(table1)

        col_widths = [0.25, 0.5, 0.25]
        for i, width_pct in enumerate(col_widths):
            table1.columns[i].width = Inches(table_width * width_pct)

        # Left cell - Batch
        left_cell = table1.cell(0, 0)
        p = left_cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.LEFT
        batch_run = p.add_run("Batch : ")
        batch_run.bold = True
        batch_run.font.name = "Courier New"
        batch_run.font.size = Pt(12)

        year_run = p.add_run(f"{self.batch.get()}")
        year_run.bold = True
        year_run.font.name = "Courier New"
        year_run.font.size = Pt(12)

        # Center cell - Program
        center_cell = table1.cell(0, 1)
        p = center_cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        prog_run = p.add_run(f"{self.program_type.get().upper()} COURSES")
        prog_run.bold = True
        prog_run.font.name = "Courier New"
        prog_run.font.size = Pt(12)

        # Right cell - Semester
        right_cell = table1.cell(0, 2)
        p = right_cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        sem_run = p.add_run("Semester : ")
        sem_run.bold = True
        sem_run.font.name = "Courier New"
        sem_run.font.size = Pt(12)
        sem_num_run = p.add_run(f"{self.semester.get()}")
        sem_num_run.bold = True
        sem_num_run.font.name = "Courier New"
        sem_num_run.font.size = Pt(12)

        # Add spacing
        spacer = doc.add_paragraph()
        spacer.paragraph_format.space_before = Pt(0)
        spacer.paragraph_format.space_after = Pt(0)

        # Title
        center_para("STUDENTS QUALIFYING FOR GRACING (Comb. Marks)", bold=True, space_before=10, space_after=6)

        # Separator line
        DocumentProcessor.add_separator_line(doc, space_before=2, space_after=6)

    def _add_gracing_data(self, doc):
        """Add gracing data table"""

        df = self.gracing_data.copy()

        # Filter by selected campus if campus column exists
        selected_campus = self.campus.get()
        campus_mapping = {
            'Prasanthi Nilayam': ['Prasanthi Nilayam', 'Prashanti Nilayam', 'PSN', 'Prasanthi Nilayam Campus'],
            'Anantapur': ['Anantapur', 'ATP', 'Anantapur Campus'],
            'Brindavan': ['Brindavan', 'BRN', 'Brindavan Campus'],
            'Nandigiri': ['Nandigiri', 'NDG', 'Nandigiri Campus', 'Muddenahalli']
        }

        campus_column = None
        for col_name in ['Campus', 'campus', 'Campus Name', 'Location', 'CAMPUS']:
            if col_name in df.columns:
                campus_column = col_name
                break

        if campus_column:
            possible_names = campus_mapping.get(selected_campus, [selected_campus])
            df = df[df[campus_column].astype(str).str.strip().isin(possible_names)].copy()

        # Create table with 9 columns
        table = doc.add_table(rows=1, cols=9)
        table.style = 'Table Grid'

        # Set column widths
        table.columns[0].width = Cm(0.8)   # Sl. No.
        table.columns[1].width = Cm(2.5)   # Regd. no
        table.columns[2].width = Cm(2.0)   # Paper Code
        table.columns[3].width = Cm(1.5)   # CIE Marks
        table.columns[4].width = Cm(1.5)   # ESE Marks
        table.columns[5].width = Cm(1.8)   # Combined Marks
        table.columns[6].width = Cm(2.2)   # Grace Marks needed
        table.columns[7].width = Cm(1.5)   # Total Max. marks
        table.columns[8].width = Cm(1.8)   # 1% of total

        # Header row
        header_row = table.rows[0]
        header_row.height = Cm(1.2)
        header_row.height_rule = WD_ROW_HEIGHT_RULE.EXACTLY

        headers = ["Sl.\nNo.", "Regd. no", "Paper\nCode", "Cie\nMarks", "Ese\nMarks", 
                "Combined\nMarks", "Grace Marks needed\nin the Combined", 
                "Total\nMax. marks", "1% of total\ntotal max.marks"]

        alignments = [WD_ALIGN_PARAGRAPH.CENTER] * 9

        for i, header_text in enumerate(headers):
            cell = header_row.cells[i]
            cell.text = header_text
            cell.paragraphs[0].alignment = alignments[i]
            cell.paragraphs[0].runs[0].bold = True
            cell.paragraphs[0].runs[0].font.name = 'Courier New'
            cell.paragraphs[0].runs[0].font.size = Pt(10)
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER

        DocumentProcessor.set_repeat_table_header(header_row)

        # Separator row
        sep_row = table.add_row()
        sep_row.height = Cm(0.4)
        sep_row.height_rule = WD_ROW_HEIGHT_RULE.EXACTLY
        sep_cell = sep_row.cells[0]
        sep_cell.merge(sep_row.cells[8])
        sep_para = sep_cell.paragraphs[0]
        sep_para.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = sep_para.add_run("-" * 120)
        run.font.name = 'Courier New'
        run.font.size = Pt(10)
        run.bold = True

        DocumentProcessor.set_repeat_table_header(sep_row)

        # Add data rows
        for idx, (_, student) in enumerate(df.iterrows()):
            student_row = table.add_row()
            student_row.height = Cm(0.8)
            student_row.height_rule = WD_ROW_HEIGHT_RULE.EXACTLY
            cells = student_row.cells
        
            # Sl. No.
            cells[0].text = f"{idx + 1}."
            cells[0].paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
            cells[0].paragraphs[0].runs[0].bold = True
            cells[0].paragraphs[0].runs[0].font.name = 'Courier New'
            cells[0].paragraphs[0].runs[0].font.size = Pt(10)
            cells[0].vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        
            # Regd. no
            cells[1].text = str(student.get('Regd No', ''))
            cells[1].paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
            cells[1].paragraphs[0].runs[0].bold = True
            cells[1].paragraphs[0].runs[0].font.name = 'Courier New'
            cells[1].paragraphs[0].runs[0].font.size = Pt(10)
            cells[1].vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        
            # Paper Code
            cells[2].text = str(student.get('Paper Code', ''))
            cells[2].paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
            cells[2].paragraphs[0].runs[0].bold = True
            cells[2].paragraphs[0].runs[0].font.name = 'Courier New'
            cells[2].paragraphs[0].runs[0].font.size = Pt(10)
            cells[2].vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        
            # CIE Marks
            cie_marks = student.get('CIE Marks', student.get('Cie Marks', ''))
            cells[3].text = str(cie_marks) if pd.notna(cie_marks) else ''
            cells[3].paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
            cells[3].paragraphs[0].runs[0].bold = True
            cells[3].paragraphs[0].runs[0].font.name = 'Courier New'
            cells[3].paragraphs[0].runs[0].font.size = Pt(10)
            cells[3].vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        
            # ESE Marks
            ese_marks = student.get('ESE Marks', student.get('Ese Marks', ''))
            cells[4].text = str(ese_marks) if pd.notna(ese_marks) else ''
            cells[4].paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
            cells[4].paragraphs[0].runs[0].bold = True
            cells[4].paragraphs[0].runs[0].font.name = 'Courier New'
            cells[4].paragraphs[0].runs[0].font.size = Pt(10)
            cells[4].vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        
            # Combined Marks
            combined_marks = student.get('Combined Marks', student.get('Combined', ''))
            cells[5].text = str(combined_marks) if pd.notna(combined_marks) else ''
            cells[5].paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
            cells[5].paragraphs[0].runs[0].bold = True
            cells[5].paragraphs[0].runs[0].font.name = 'Courier New'
            cells[5].paragraphs[0].runs[0].font.size = Pt(10)
            cells[5].vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        
            # Grace Marks needed
            grace_marks = student.get('Grace Marks', student.get('Grace Marks Needed', ''))
            cells[6].text = str(grace_marks) if pd.notna(grace_marks) else ''
            cells[6].paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
            cells[6].paragraphs[0].runs[0].bold = True
            cells[6].paragraphs[0].runs[0].font.name = 'Courier New'
            cells[6].paragraphs[0].runs[0].font.size = Pt(10)
            cells[6].vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        
            # Total Max. marks
            total_marks = student.get('Total Max Marks', student.get('Max Marks', 400))
            cells[7].text = str(total_marks) if pd.notna(total_marks) else '400'
            cells[7].paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
            cells[7].paragraphs[0].runs[0].bold = True
            cells[7].paragraphs[0].runs[0].font.name = 'Courier New'
            cells[7].paragraphs[0].runs[0].font.size = Pt(10)
            cells[7].vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        
            # 1% of total
            one_percent = student.get('1% of Total', '')
            if not one_percent or pd.isna(one_percent):
                # Calculate 1% if not provided
                try:
                    total_val = float(total_marks) if pd.notna(total_marks) else 400
                    one_percent = int(total_val * 0.01)
                except:
                    one_percent = 4
            cells[8].text = str(one_percent)
            cells[8].paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
            cells[8].paragraphs[0].runs[0].bold = True
            cells[8].paragraphs[0].runs[0].font.name = 'Courier New'
            cells[8].paragraphs[0].runs[0].font.size = Pt(10)
            cells[8].vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER

        # Remove table borders
        DocumentProcessor.remove_table_borders(table)

    def _add_gracing_footer(self, doc):
        """Add footer notes for gracing list"""
        # Add spacing
        doc.add_paragraph()
        doc.add_paragraph()

        # WEIGHTAGE note
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(6)
        p.paragraph_format.space_after = Pt(6)
        run = p.add_run("WEIGHTAGE (for all groups) ::  C.I.E. ---> 50%")
        run.bold = True
        run.font.name = 'Courier New'
        run.font.size = Pt(10)

        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(0)
        p.paragraph_format.space_after = Pt(12)
        p.paragraph_format.left_indent = Inches(2.5)
        run = p.add_run("E.S.E. ---> 50%")
        run.bold = True
        run.font.name = 'Courier New'
        run.font.size = Pt(10)

        # Main NOTE
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(6)
        p.paragraph_format.space_after = Pt(6)
        run = p.add_run("** NOTE: ")
        run.bold = True
        run.font.name = 'Courier New'
        run.font.size = Pt(10)

        run = p.add_run("The total marks allowable for the purpose of Gracing would be 1% of the maximum marks of all the")
        run.font.name = 'Courier New'
        run.font.size = Pt(10)

        # Second line of note
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(0)
        p.paragraph_format.space_after = Pt(6)
        p.paragraph_format.left_indent = Inches(0.8)
        run = p.add_run("papers, (T max as per academic regulations) in which a student has taken End Semester Examinations")
        run.font.name = 'Courier New'
        run.font.size = Pt(10)

        # Third line of note
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(0)
        p.paragraph_format.space_after = Pt(12)
        p.paragraph_format.left_indent = Inches(0.8)
        run = p.add_run("in any particular semester.")
        run.font.name = 'Courier New'
        run.font.size = Pt(10)

        # Additional note about max grace marks
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(6)
        p.paragraph_format.space_after = Pt(6)
        p.paragraph_format.left_indent = Inches(0.8)
        run = p.add_run("From the total allowable grace marks, the maximum grace marks ALLOWABLE FOR ANY SINGLE PAPER shall")
        run.font.name = 'Courier New'
        run.font.size = Pt(10)

        # Last line
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(0)
        p.paragraph_format.space_after = Pt(6)
        p.paragraph_format.left_indent = Inches(0.8)
        run = p.add_run("not exceed 3 marks in the combined marks")
        run.font.name = 'Courier New'
        run.font.size = Pt(10)
    
    def create_failure_list_tab(self):
        """Create failure list generation tab"""
        tab_frame = ttk.Frame(self.notebook)
        self.notebook.add(tab_frame, text="  Failure Lists  ")
        
        # Create scrollable frame
        canvas = tk.Canvas(tab_frame, bg=ModernUI.COLORS['background'])
        scrollbar = ttk.Scrollbar(tab_frame, orient="vertical", command=canvas.yview)
        scrollable_frame = ttk.Frame(canvas)
        
        scrollable_frame.bind(
            "<Configure>",
            lambda e: canvas.configure(scrollregion=canvas.bbox("all"))
        )
        
        canvas.create_window((0, 0), window=scrollable_frame, anchor="nw")
        canvas.configure(yscrollcommand=scrollbar.set)
        
        # Settings section
        settings_section = ttk.LabelFrame(scrollable_frame, text="Document Settings", 
                                        padding=ModernUI.PADDING['medium'])
        settings_section.pack(fill=tk.X, padx=ModernUI.PADDING['medium'], pady=ModernUI.PADDING['small'])
        
        # Orientation setting
        orientation_frame = ttk.Frame(settings_section)
        orientation_frame.pack(fill=tk.X, pady=ModernUI.PADDING['small'])
        
        ttk.Label(orientation_frame, text="Page Orientation:").pack(side=tk.LEFT, 
                                                                  padx=(0, ModernUI.PADDING['small']))
        
        ttk.Radiobutton(orientation_frame, text="Portrait", variable=self.orientation, 
                       value="Portrait").pack(side=tk.LEFT, padx=(0, ModernUI.PADDING['medium']))
        ttk.Radiobutton(orientation_frame, text="Landscape", variable=self.orientation, 
                       value="Landscape").pack(side=tk.LEFT)
        
        # Student selection section
        student_section = ttk.LabelFrame(scrollable_frame, text="Student Selection", 
                                       padding=ModernUI.PADDING['medium'])
        student_section.pack(fill=tk.BOTH, expand=True, padx=ModernUI.PADDING['medium'], 
                           pady=ModernUI.PADDING['small'])
        
        # Search frame
        search_frame = ttk.Frame(student_section)
        search_frame.pack(fill=tk.X, pady=(0, ModernUI.PADDING['small']))
        
        ttk.Label(search_frame, text="Search:").pack(side=tk.LEFT, 
                                                   padx=(0, ModernUI.PADDING['small']))
        
        self.search_var = tk.StringVar()
        search_entry = ttk.Entry(search_frame, textvariable=self.search_var, width=30)
        search_entry.pack(side=tk.LEFT, padx=(0, ModernUI.PADDING['medium']))
        
        ttk.Button(search_frame, text="Select All", 
                  command=lambda: self.toggle_all_students(True)).pack(side=tk.LEFT, 
                                                                      padx=ModernUI.PADDING['small'])
        ttk.Button(search_frame, text="Deselect All", 
                  command=lambda: self.toggle_all_students(False)).pack(side=tk.LEFT)
        
        # Student list frame
        self.student_list_frame = ttk.Frame(student_section)
        self.student_list_frame.pack(fill=tk.BOTH, expand=True, pady=ModernUI.PADDING['small'])
        
        # Initially show placeholder
        self.show_student_placeholder()
        
        # Actions section
        actions_section = ttk.Frame(scrollable_frame)
        actions_section.pack(fill=tk.X, padx=ModernUI.PADDING['medium'], pady=ModernUI.PADDING['medium'])
        
        ttk.Button(actions_section, text="Generate Failure List", 
                  command=lambda: self.generate_document("failure_list"),
                  style='Danger.TButton').pack(side=tk.RIGHT, padx=ModernUI.PADDING['small'])
        
        ttk.Button(actions_section, text="Load Student Data", 
                  command=self.load_failure_data,
                  style='Primary.TButton').pack(side=tk.RIGHT, padx=ModernUI.PADDING['small'])
        
        # Pack canvas and scrollbar
        canvas.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")
    
    def create_status_bar(self, parent):
        # Separator line
        separator = ttk.Separator(parent, orient='horizontal')
        separator.pack(fill=tk.X, side=tk.BOTTOM)
        
        status_frame = ttk.Frame(parent)
        status_frame.pack(fill=tk.X, side=tk.BOTTOM, padx=ModernUI.PADDING['large'], 
                        pady=ModernUI.PADDING['small'])
        
        # Status message
        self.status_label = ttk.Label(
            status_frame, 
            textvariable=self.status_var,
            font=ModernUI.FONTS['small'],
            foreground=ModernUI.COLORS['text_secondary']
        )
        self.status_label.pack(side=tk.LEFT, fill=tk.X, expand=True)
        
        # Exit button - text only style
        exit_button = ttk.Button(
            status_frame, 
            text="Exit", 
            command=self.root.quit,
            width=8
        )
        exit_button.pack(side=tk.RIGHT)
    
    def show_student_placeholder(self):
        for widget in self.student_list_frame.winfo_children():
            widget.destroy()
        
        placeholder_label = ttk.Label(
            self.student_list_frame,
            text="No student data loaded. Please select a file and click 'Load Student Data'.",
            foreground=ModernUI.COLORS['text_secondary']
        )
        placeholder_label.pack(expand=True, pady=50)
    
    def browse_excel_file(self):
        filepath = filedialog.askopenfilename(
            title="Select Excel File",
            filetypes=[("Excel files", "*.xlsx *.xls")]
        )
        if filepath:
            self.excel_path.set(filepath)
            self.status_var.set(f"Selected: {os.path.basename(filepath)}")

    
    def load_result_sheet_data(self):
        if not self.excel_path.get():
            messagebox.showerror("Error", "Please select an Excel file first")
            return
        
        self.status_var.set("Loading result sheet data...")
        
        # Use threading to prevent UI freeze
        threading.Thread(target=self._load_result_sheet_data_thread, daemon=True).start()
    
    def _load_result_sheet_data_thread(self):
        try:
            # Read the Excel file
            df = pd.read_excel(self.excel_path.get(), sheet_name='FinalOutput')
            failure_df = pd.read_excel(self.excel_path.get(), sheet_name='FailureList')

            # AUTO-DETECT CAMPUS from Registration Numbers
            df['Detected Campus'] = df['Regd No'].apply(extract_campus_from_regno)
            failure_df['Detected Campus'] = failure_df['Regd No'].apply(extract_campus_from_regno)
        
            # Log campus detection
            detected_campuses = df['Detected Campus'].dropna().unique()
            logging.info(f"Detected campuses in data: {detected_campuses}")
            
            # Auto-set campus if all students are from the same campus
            if len(detected_campuses) == 1:
                auto_campus = detected_campuses[0]
                self.root.after(0, lambda c=auto_campus: self.campus.set(c))
                logging.info(f"Auto-set campus to: {auto_campus}")

            # Store the data
            self.result_sheet_data = {'main': df, 'failures': failure_df}

            # Automatically detect and set semester from the data
            semester_column = None
            for col_name in ['Semester', 'semester', 'SEM', 'Sem']:
                if col_name in df.columns:
                    semester_column = col_name
                    break

            if semester_column:
                semester_value = df[semester_column].dropna().iloc[0] if not df[semester_column].dropna().empty else None
                if semester_value is not None:
                    semester_int = roman_to_int(semester_value)
                    if semester_int is not None:
                        semester_str = f"{semester_int:02d}"
                        self.root.after(0, lambda s=semester_str: self.semester.set(s))
                        print(f"[OK] Auto-detected Semester: {semester_value} -> {semester_str}")
                    else:
                        try:
                            semester_str = f"{int(semester_value):02d}"
                            self.root.after(0, lambda s=semester_str: self.semester.set(s))
                            print(f"[OK] Auto-detected Semester: {semester_str}")
                        except:
                            print(f"[WARNING] Could not parse semester value: {semester_value}")

            # Update UI from main thread
            self.root.after(0, lambda: self.status_var.set("Result sheet data loaded successfully"))

        except Exception as e:
            error_msg = str(e)
            self.root.after(0, lambda: messagebox.showerror("Error", f"Failed to load data: {error_msg}"))
            self.root.after(0, lambda: self.status_var.set("Failed to load result sheet data"))
    
    def load_cgpa_data(self):
    
        if not self.excel_path.get():
            messagebox.showerror("Error", "Please select an Excel file first")
            return
        
        self.status_var.set("Loading CGPA data...")
        
        # Use threading to prevent UI freeze
        threading.Thread(target=self._load_cgpa_data_thread, daemon=True).start()
    
    def _load_cgpa_data_thread(self):
        try:
            program_type = self.program_type_cgpa.get()
            
            # Read Excel file (both sheets from same file)
            academic_df = pd.read_excel(self.excel_path.get(), sheet_name=program_type)
            integral_df = pd.read_excel(self.excel_path.get(), sheet_name=f"{program_type}_INTEGRAL")
            
            # Store the data
            self.cgpa_data = {'academic': academic_df, 'integral': integral_df}
            
            # Update UI from main thread
            self.root.after(0, lambda: self.status_var.set("CGPA data loaded successfully"))
            
        except Exception as e:
            error_msg = str(e)
            self.root.after(0, lambda: messagebox.showerror("Error", f"Failed to load CGPA data: {error_msg}"))
            self.root.after(0, lambda: self.status_var.set("Failed to load CGPA data"))
    
    def load_failure_data(self):
        if not self.excel_path.get():
            messagebox.showerror("Error", "Please select an Excel file first")
            return
        
        self.status_var.set("Loading failure list data...")
        
        # Use threading to prevent UI freeze
        threading.Thread(target=self._load_failure_data_thread, daemon=True).start()
    
    def _load_failure_data_thread(self):
        """Background thread for loading failure data"""
        try:
            # Read the Excel file
            df = pd.read_excel(self.excel_path.get(), sheet_name="FailureList")
            
            # Get unique students
            # df_sorted = df.iloc[::-1]  # REMOVED REVERSAL to keep original order (top to bottom)
            unique_students = df.drop_duplicates(subset=['Regd No'], keep='first')
            
            # Store the data
            self.all_failure_data = df
            self.failure_data = unique_students
            
            # Update UI from main thread
            self.root.after(0, self._create_student_selection_ui)
            self.root.after(0, lambda: self.status_var.set("Failure list data loaded successfully"))
            
        except Exception as e:
            error_msg = str(e)
            self.root.after(0, lambda: messagebox.showerror("Error", f"Failed to load failure data: {error_msg}"))
            self.root.after(0, lambda: self.status_var.set("Failed to load failure data"))
    
    def _create_student_selection_ui(self):
        """Create student selection interface"""
        # Clear existing widgets
        for widget in self.student_list_frame.winfo_children():
            widget.destroy()
        
        # Create scrollable area
        canvas = tk.Canvas(self.student_list_frame, bg=ModernUI.COLORS['background'])
        scrollbar = ttk.Scrollbar(self.student_list_frame, orient="vertical", command=canvas.yview)
        scrollable_frame = ttk.Frame(canvas)
        
        scrollable_frame.bind(
            "<Configure>",
            lambda e: canvas.configure(scrollregion=canvas.bbox("all"))
        )
        
        canvas.create_window((0, 0), window=scrollable_frame, anchor="nw")
        canvas.configure(yscrollcommand=scrollbar.set)
        
        # Create checkboxes for students
        self.student_vars = {}
        
        for i, (_, student) in enumerate(self.failure_data.iterrows()):
            frame = ttk.Frame(scrollable_frame)
            frame.pack(fill=tk.X, pady=1)

            var = tk.BooleanVar(value=True)
            self.student_vars[student['Regd No']] = var

            checkbox = ttk.Checkbutton(frame, variable=var)
            checkbox.pack(side=tk.LEFT, padx=ModernUI.PADDING['small'])

            # Serial number
            ttk.Label(frame, text=f"{i+1}.", width=5).pack(side=tk.LEFT,
                                                          padx=ModernUI.PADDING['small'])

            # Registration number
            ttk.Label(frame, text=str(student['Regd No']), width=15).pack(side=tk.LEFT,
                                                                           padx=ModernUI.PADDING['small'])

            # Student name
            ttk.Label(frame, text=student['Name']).pack(side=tk.LEFT,
                                                                  padx=ModernUI.PADDING['small'])
        
        # Pack canvas and scrollbar
        canvas.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")
    
    def get_selected_students(self):
        if not hasattr(self, 'student_vars'):
            return []
        
        selected = []
        for reg_no, var in self.student_vars.items():
            if var.get():  # If checkbox is checked
                # Get the actual student data from the DataFrame
                # Use self.all_failure_data if available, otherwise fallback to self.failure_data
                source_data = getattr(self, 'all_failure_data', self.failure_data)
                student_rows = source_data[source_data['Regd No'] == reg_no]
                
                if not student_rows.empty:
                    for _, row in student_rows.iterrows():
                        selected.append(row)
        return selected
    
    def toggle_all_students(self, select_all):
        """Select or deselect all students"""
        if not hasattr(self, 'student_vars'):
            return
        
        for var in self.student_vars.values():
            var.set(select_all)
    
    def _add_result_sheet_data(self, doc):
        """Add result sheet data to document"""
        # Get the data
        df = self.result_sheet_data['main'].copy()
        
        # Filter by campus using DETECTED CAMPUS
        selected_campus = self.campus.get()
        if selected_campus != "All":
            # Use the detected campus column
            if 'Detected Campus' in df.columns:
                df = df[df['Detected Campus'] == selected_campus]
                
                if len(df) == 0:
                    print(f"[WARNING] No students found for {selected_campus} campus")
                else:
                    print(f"[OK] Filtered to {len(df)} students from {selected_campus} campus (auto-detected)")
            else:
                # Fallback to old method if detection failed
                campus_column = None
                for col_name in ['Campus', 'campus', 'CAMPUS']:
                    if col_name in df.columns:
                        campus_column = col_name
                        break
                
                if campus_column:
                    campus_mapping = {
                        'Prasanthi Nilayam': ['Prasanthi Nilayam', 'PN', 'Prasanthi', 'PRASANTHI NILAYAM', 'Prashanti Nilayam'],
                        'Brindavan': ['Brindavan', 'BN', 'BRINDAVAN'],
                        'Anantapur': ['Anantapur', 'ATP', 'ANANTAPUR'],
                        'Nandigiri': ['Nandigiri', 'Muddenahalli', 'MN', 'NANDIGIRI', 'MUDDENAHALLI']
                    }
                    
                    possible_names = campus_mapping.get(selected_campus, [selected_campus])
                    df = df[df[campus_column].isin(possible_names)]
                    
                    if len(df) == 0:
                        print(f"[WARNING] No students found for {selected_campus} campus")
                    else:
                        print(f"[OK] Filtered to {len(df)} students from {selected_campus} campus")

        
                else:
                    print(f"[WARNING] No campus column found in data. Showing all students.")
                    print(f"Available columns: {df.columns.tolist()}")


            # CHECK IF DATAFRAME IS EMPTY AFTER FILTERING
            if len(df) == 0:
                raise ValueError(f"No students found for {selected_campus} campus. Please check your data or select a different campus.")

            # Load programme mapping file
            try:
                programme_mapping_df = pd.read_excel(self.programme_mapping_file)
                programme_dict = dict(zip(
                    programme_mapping_df['Programme Code'],
                    programme_mapping_df['Programme Name']
                ))
            except Exception as e:
                logging.error(f"Failed to load programme mapping file: {e}")
                programme_dict = {}

            # Map Programme Code to Programme Name
            df['Programme Name'] = df['Program'].map(programme_dict)
            df['Programme Name'].fillna(df['Program'], inplace=True)

            # Calculate optimal widths for Regd.No. and Name columns
            # Get max length of registration numbers with default fallback
            max_regno_len = df['Regd No'].astype(str).str.len().max()
            max_name_len = df['Name'].astype(str).str.len().max()
            
            # HANDLE NaN VALUES - provide defaults if empty
            if pd.isna(max_regno_len) or max_regno_len == 0:
                max_regno_len = 15  # Default width for registration numbers
            if pd.isna(max_name_len) or max_name_len == 0:
                max_name_len = 30  # Default width for names

            # Calculate column widths based on content
            char_width_cm = 0.30

            # Regd.No. column: add padding for margins
            regno_width = max(Cm(max_regno_len * char_width_cm + 1.2), Cm(2.67))

            # Name column: calculate width to ensure no line wrapping
            name_width = Cm(max_name_len * char_width_cm + 2.0)


            # Load programme mapping file
            try:
                programme_mapping_df = pd.read_excel(self.programme_mapping_file)
                programme_dict = dict(zip(
                    programme_mapping_df['Programme Code'],
                    programme_mapping_df['Programme Name']
                ))
            except Exception as e:
                logging.error(f"Failed to load programme mapping file: {e}")
                programme_dict = {}

            # Map Programme Code to Programme Name
            df['Programme Name'] = df['Program'].map(programme_dict)
            df['Programme Name'].fillna(df['Program'], inplace=True)

            # Calculate optimal widths for Regd.No. and Name columns
            # Get max length of registration numbers
            max_regno_len = df['Regd No'].astype(str).str.len().max()
            # Get max length of names
            max_name_len = df['Name'].astype(str).str.len().max()

            # Calculate column widths based on content
            # Using Courier New 12pt: approximately 0.30cm per character (generous spacing)
            # This ensures sufficient width to prevent line wrapping
            char_width_cm = 0.30

            # Regd.No. column: add padding for margins
            regno_width = max(Cm(max_regno_len * char_width_cm + 1.2), Cm(2.67))

            # Name column: calculate width to ensure no line wrapping
            # Add extra padding (2.0cm total) to prevent wrapping with generous safety margin
            name_width = Cm(max_name_len * char_width_cm + 2.0)

            # Create table with 0 rows initially
            table = doc.add_table(rows=0, cols=5)
            table.style = 'Table Grid'

            # Set column widths with dynamic sizing for Regd.No. and Name
            # We need to add a dummy row to set widths or just set them on columns property?
            # Setting on columns property works for uniform tables usually.
            table.columns[0].width = Cm(0.8)   # S.No.
            table.columns[1].width = regno_width   # Regd.No. (dynamic)
            table.columns[2].width = name_width   # Name (dynamic)
            table.columns[3].width = Cm(1.59)   # GPA
            table.columns[4].width = Cm(1.75)   # Grade

            # 1. Top Separator Row
            top_sep_row = table.add_row()
            top_sep_row.height = Cm(0.4)
            top_sep_row.height_rule = WD_ROW_HEIGHT_RULE.EXACTLY
            top_sep_cell = top_sep_row.cells[0]
            top_sep_cell.merge(top_sep_row.cells[4])
            top_sep_para = top_sep_cell.paragraphs[0]
            top_sep_para.alignment = WD_ALIGN_PARAGRAPH.CENTER
            top_sep_para.paragraph_format.space_before = Pt(0)
            top_sep_para.paragraph_format.space_after = Pt(0)
            run = top_sep_para.add_run("-" * 180) # Matching dash count for full width
            run.font.name = 'Calibri'
            run.font.size = Pt(9)
            DocumentProcessor.set_repeat_table_header(top_sep_row)

            # 2. Header Row
            header_row = table.add_row()
            header_row.height = Cm(0.6)
            header_row.height_rule = WD_ROW_HEIGHT_RULE.EXACTLY
            headers = ["S.No.", "Regd.No.", "Name", "GPA", "Grade"]
            alignments = [WD_ALIGN_PARAGRAPH.CENTER, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT,
                        WD_ALIGN_PARAGRAPH.CENTER, WD_ALIGN_PARAGRAPH.CENTER]

            for i, header_text in enumerate(headers):
                cell = header_row.cells[i]
                cell.text = header_text
                cell.paragraphs[0].alignment = alignments[i]
                cell.paragraphs[0].runs[0].bold = True
                cell.paragraphs[0].runs[0].font.name = 'Courier New'
                cell.paragraphs[0].runs[0].font.size = Pt(12)
                cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            
            DocumentProcessor.set_repeat_table_header(header_row)
            
            # 3. Bottom Separator Row
            sep_row = table.add_row()
            sep_row.height = Cm(0.4)  
            sep_row.height_rule = WD_ROW_HEIGHT_RULE.EXACTLY

            sep_cell = sep_row.cells[0]
            sep_cell.merge(sep_row.cells[4])
            sep_para = sep_cell.paragraphs[0]
            sep_para.alignment = WD_ALIGN_PARAGRAPH.CENTER
            sep_para.paragraph_format.space_before = Pt(0)
            sep_para.paragraph_format.space_after = Pt(0)
            sep_para.paragraph_format.line_spacing = 1.0

            run = sep_para.add_run("-" * 180)
            run.font.name = 'Calibri'
            run.font.size = Pt(9)
            
            DocumentProcessor.set_repeat_table_header(sep_row)
            # Add data rows grouped by Programme Name
            s_no = 1

            for programme_name, programme_group in df.groupby('Programme Name'):
                # Add empty row before programme name
                empty_row = table.add_row()
                empty_row.height = Cm(0.4)
                empty_row.height_rule = WD_ROW_HEIGHT_RULE.EXACTLY
                empty_cell = empty_row.cells[0]
                empty_cell.merge(empty_row.cells[4])
                empty_para = empty_cell.paragraphs[0]
                empty_para.paragraph_format.space_before = Pt(0)
                empty_para.paragraph_format.space_after = Pt(0)
                empty_para.paragraph_format.line_spacing = 1.0

                # Add programme header row
                course_row = table.add_row()
                course_cell = course_row.cells[0]
                course_cell.merge(course_row.cells[4])
                course_para = course_cell.paragraphs[0]
                course_para.alignment = WD_ALIGN_PARAGRAPH.CENTER
                course_para.paragraph_format.space_before = Pt(0)
                course_para.paragraph_format.space_after = Pt(0)
                run = course_para.add_run(str(programme_name))
                run.bold = True
                run.font.name = 'Courier New'
                run.font.size = Pt(12)
                
                # Add asterisk separator row
                asterisk_row = table.add_row()
                asterisk_cell = asterisk_row.cells[0]
                asterisk_cell.merge(asterisk_row.cells[4])
                asterisk_para = asterisk_cell.paragraphs[0]
                asterisk_para.alignment = WD_ALIGN_PARAGRAPH.CENTER
                asterisk_para.paragraph_format.space_before = Pt(0)
                asterisk_para.paragraph_format.space_after = Pt(0)
                run = asterisk_para.add_run("*" * len(str(programme_name)))
                run.font.name = 'Courier New'
                run.font.size = Pt(12)
                
                # Add student rows
                for _, student in programme_group.iterrows():
                    student_row = table.add_row()
                    student_row.height = Cm(1.1)  # Set row height
                    student_row.height_rule = WD_ROW_HEIGHT_RULE.EXACTLY
                    cells = student_row.cells

                    # S.No. (Center aligned)
                    cells[0].text = f"{s_no}."
                    cells[0].paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
                    cells[0].paragraphs[0].runs[0].bold = True
                    cells[0].paragraphs[0].runs[0].font.name = 'Courier New'
                    cells[0].paragraphs[0].runs[0].font.size = Pt(12)
                    cells[0].vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER

                    # Regd.No. (Left aligned)
                    reg_no = str(student.get('Regd No', '') if hasattr(student, 'get') else student['Regd No'] if 'Regd No' in student.index else '')
                    cells[1].text = reg_no
                    cells[1].paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.LEFT
                    cells[1].paragraphs[0].runs[0].bold = True
                    cells[1].paragraphs[0].runs[0].font.name = 'Courier New'
                    cells[1].paragraphs[0].runs[0].font.size = Pt(12)
                    cells[1].vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER

                    # Name (Left aligned)
                    name = str(student.get('Name', '') if hasattr(student, 'get') else student['Name'] if 'Name' in student.index else '')
                    cells[2].text = name
                    cells[2].paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.LEFT
                    cells[2].paragraphs[0].runs[0].bold = True
                    cells[2].paragraphs[0].runs[0].font.name = 'Courier New'
                    cells[2].paragraphs[0].runs[0].font.size = Pt(12)
                    cells[2].vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER

                    # Get failure data to check if student has failed
                    failure_df = self.result_sheet_data.get('failures')
                    has_failed = False
                    failed_papers = pd.DataFrame()
                    
                    if failure_df is not None:
                        # Check if student exists in FailureList
                        # Convert both to string and strip to ensure proper matching
                        reg_no_str = str(reg_no).strip()
                        failed_papers = failure_df[failure_df['Regd No'].astype(str).str.strip() == reg_no_str]
                        has_failed = not failed_papers.empty
                    
                    # Check if student has failed based on FailureList
                    if has_failed:
                        # Merge GPA and Grade cells
                        merged_cell = cells[3].merge(cells[4])
                        p = merged_cell.paragraphs[0]
                        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                        run = p.add_run("**Fails**")
                        run.bold = True
                        run.font.name = 'Courier New'
                        run.font.size = Pt(12)
                        merged_cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
                        
                        # Add a row for each failed paper
                        for _, paper in failed_papers.iterrows():
                            paper_row = table.add_row()
                            paper_row.height = Cm(1.3)
                            paper_row.height_rule = WD_ROW_HEIGHT_RULE.EXACTLY
                            paper_cells = paper_row.cells
                            
                            # S.No. column - leave empty
                            paper_cells[0].text = ""
                            
                            # Regd.No. column - leave empty
                            paper_cells[1].text = ""
                            
                            # Name column - Paper Code and Paper Title combined
                            paper_code = str(paper.get('Paper Code', ''))
                            paper_title = str(paper.get('Paper Title', ''))
                            combined_text = f"  {paper_code} - {paper_title}"  # Indent slightly
                            paper_cells[2].text = combined_text
                            paper_cells[2].paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.LEFT
                            paper_cells[2].paragraphs[0].runs[0].font.name = 'Courier New'
                            paper_cells[2].paragraphs[0].runs[0].font.size = Pt(11)
                            paper_cells[2].paragraphs[0].runs[0].bold = True
                            paper_cells[2].vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
                            
                            # GPA and Grade columns - leave empty
                            paper_cells[3].text = ""
                            paper_cells[4].text = ""
                    else:
                        # GPA (Center aligned)
                        gpa = ''
                        for col in ['Published GPA','GPA', 'SGPA', 'CGPA', 'Points', 'Grade Point']:
                            val = student.get(col, '') if hasattr(student, 'get') else student[col] if col in student.index else ''
                            if val and str(val).strip():
                                gpa = str(val)
                                break
                        
                        cells[3].text = gpa
                        cells[3].paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
                        cells[3].paragraphs[0].runs[0].bold = True
                        cells[3].paragraphs[0].runs[0].font.name = 'Courier New'
                        cells[3].paragraphs[0].runs[0].font.size = Pt(12)
                        cells[3].vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
                        
                        # Grade (Center aligned)
                        grade = ''
                        for col in ['Grade', 'LG', 'LetterGrade', 'Alpha Grade', 'Result']:
                            val = student.get(col, '') if hasattr(student, 'get') else student[col] if col in student.index else ''
                            if val and str(val).strip():
                                grade = str(val)
                                break
                        
                        cells[4].text = grade
                        cells[4].paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
                        cells[4].paragraphs[0].runs[0].bold = True
                        cells[4].paragraphs[0].runs[0].font.name = 'Courier New'
                        cells[4].paragraphs[0].runs[0].font.size = Pt(12)
                        cells[4].vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER

                    s_no += 1

            # Add bottom separator row
            bottom_sep_row = table.add_row()
            bottom_sep_row.height = Cm(0.4)
            bottom_sep_row.height_rule = WD_ROW_HEIGHT_RULE.EXACTLY
            bottom_sep_cell = bottom_sep_row.cells[0]
            bottom_sep_cell.merge(bottom_sep_row.cells[4])
            bottom_sep_para = bottom_sep_cell.paragraphs[0]
            bottom_sep_para.alignment = WD_ALIGN_PARAGRAPH.CENTER
            bottom_sep_para.paragraph_format.space_before = Pt(0)
            bottom_sep_para.paragraph_format.space_after = Pt(0)
            run = bottom_sep_para.add_run("-" * 180)
            run.font.name = 'Calibri'
            run.font.size = Pt(9)

            # Remove table borders
            DocumentProcessor.remove_table_borders(table)
    
    def generate_cgpa_sheet(self):
        """Generate CGPA comparison sheet"""
        if not hasattr(self, 'cgpa_data'):
            messagebox.showerror("Error", "Please load CGPA data first")
            return
        
        # Show progress dialog
        progress = ProgressDialog(self.root, "Generating Gracing List", "Creating document...")
        progress.show()
        
        # Use threading to prevent UI freeze
        threading.Thread(target=self._generate_cgpa_sheet_thread, 
                        args=(progress,), daemon=True).start()
    
    def _generate_cgpa_sheet_thread(self, progress):
        """Background thread for Gracing List generation"""
        try:
            progress.update_progress(10, "Setting up document...")
            
            # Create document
            doc = Document()
            DocumentProcessor.set_document_defaults(doc)
            DocumentProcessor.configure_section(doc)
            DocumentProcessor.add_page_numbers(doc)
            
            progress.update_progress(30, "Adding header...")
            
            # Add header
            self._add_cgpa_header(doc)
            
            progress.update_progress(60, "Processing CGPA data...")
            
            # Add CGPA comparison data
            self._add_cgpa_data(doc)
            
            progress.update_progress(90, "Finalizing document...")
            
            # Save document
            self.root.after(0, lambda: self._save_document(doc, "CGPA_Sheet", progress))
            
        except Exception as e:
            error_msg = str(e)
            self.root.after(0, lambda: self._handle_generation_error(error_msg, progress))
    
    def _add_cgpa_header(self, doc):
        """Add header for Gracing List"""
        # University header
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = p.add_run("Sri Sathya Sai Institute of Higher Learning")
        run.bold = True
        run.font.name = 'Courier New'
        run.font.size = Pt(12)
        
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = p.add_run("(Deemed to be University)")
        run.bold = True
        run.font.name = 'Courier New'
        run.font.size = Pt(12)
        
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = p.add_run("Vidyagiri, Prasanthi Nilayam")
        run.bold = True
        run.font.name = 'Courier New'
        run.font.size = Pt(12)
        
        # Title
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = p.add_run("\nRESULT SHEET")
        run.bold = True
        run.font.name = 'Courier New'
        run.font.size = Pt(12)
        
        # Examination details
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = p.add_run(f"END SEMESTER EXAMINATIONS - April 2025")
        run.bold = True
        run.font.name = 'Courier New'
        run.font.size = Pt(12)
        
        program_title = "UNDERGRADUATE PROGRAMMES" if self.program_type_cgpa.get() == "UG" else "POSTGRADUATE PROGRAMMES"
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = p.add_run(f"\n{program_title}")
        run.bold = True
        run.font.name = 'Courier New'
        run.font.size = Pt(12)
    
    def _add_cgpa_data(self, doc):
        """Add CGPA comparison data"""
        academic_df = self.cgpa_data['academic']
        integral_df = self.cgpa_data['integral']
        
        # Create table with headers
        table = doc.add_table(rows=3, cols=6)
        table.style = 'Table Grid'
        
        # First row - ACADEMIC/INTEGRAL headers
        first_row = table.rows[0]
        first_row.cells[0].merge(first_row.cells[1])  # Empty space
        
        # ACADEMIC header
        academic_cell = first_row.cells[2]
        academic_cell.merge(first_row.cells[3])
        academic_cell.text = "ACADEMIC"
        academic_cell.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
        academic_cell.paragraphs[0].runs[0].bold = True
        
        # INTEGRAL header
        integral_cell = first_row.cells[4]
        integral_cell.merge(first_row.cells[5])
        integral_cell.text = "INTEGRAL"
        integral_cell.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
        integral_cell.paragraphs[0].runs[0].bold = True
        
        # Second row - Column headers
        second_row = table.rows[1]
        headers = ["S.No.", "Regd.No./Name", "CGPA", "GRADE", "CGPA", "GRADE"]
        for i, header in enumerate(headers):
            second_row.cells[i].text = header
            second_row.cells[i].paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
            second_row.cells[i].paragraphs[0].runs[0].bold = True
        
        # Third row - Separator
        third_row = table.rows[2]
        separator_cell = third_row.cells[0]
        separator_cell.merge(third_row.cells[5])
        separator_cell.text = "-" * 80
        separator_cell.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
        
        # Group by course and add data
        courses = academic_df['COURSE'].unique()
        s_no = 1
        
        for course in courses:
            # Add course header
            course_row = table.add_row()
            course_cell = course_row.cells[0]
            course_cell.merge(course_row.cells[5])
            course_cell.text = course
            course_cell.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
            course_cell.paragraphs[0].runs[0].bold = True
            
            # Add course separator
            separator_row = table.add_row()
            separator_cell = separator_row.cells[0]
            separator_cell.merge(separator_row.cells[5])
            separator_cell.text = "*" * len(course)
            separator_cell.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
            
            # Filter students by course
            course_students = academic_df[academic_df['COURSE'] == course]
            
            for _, student in course_students.iterrows():
                student_row = table.add_row()
                cells = student_row.cells
                
                # S.No.
                cells[0].text = str(s_no)
                cells[0].paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
                cells[0].paragraphs[0].runs[0].bold = True
                
                # Regd.No./Name
                reg_id = student['ROLLNO']
                name = student['NAME']
                cells[1].text = f"{reg_id}\n{name}"
                cells[1].paragraphs[0].runs[0].bold = True
                
                # Academic CGPA and Grade
                cells[2].text = str(student.get('CGPA', 'N/A'))
                cells[2].paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
                cells[2].paragraphs[0].runs[0].bold = True
                
                cells[3].text = str(student.get('LG', 'N/A'))
                cells[3].paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
                cells[3].paragraphs[0].runs[0].bold = True
                
                # Find matching integral data
                integral_match = integral_df[
                    (integral_df['ROLLNO' if self.program_type_cgpa.get() == "UG" else 'REGD.NO.'] == reg_id) & 
                    (integral_df['NAME'] == name)
                ]
                
                if not integral_match.empty:
                    integral_row = integral_match.iloc[0]
                    int_cgpa = integral_row.get('CGPA', 'N/A')
                    int_grade = integral_row.get('CGPA-LG', 'N/A')
                else:
                    int_cgpa = 'N/A'
                    int_grade = 'N/A'
                
                # Integral CGPA and Grade
                cells[4].text = str(int_cgpa)
                cells[4].paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
                cells[4].paragraphs[0].runs[0].bold = True
                
                cells[5].text = str(int_grade)
                cells[5].paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
                cells[5].paragraphs[0].runs[0].bold = True
                
                s_no += 1
        
        # Remove table borders
        DocumentProcessor.remove_table_borders(table)
    
    def generate_failure_list(self):
        """Generate failure list document"""
        if not hasattr(self, 'failure_data'):
            messagebox.showerror("Error", "Please load failure list data first")
            return
        
        selected_students = self.get_selected_students()
        if not selected_students:
            messagebox.showwarning("Warning", "Please select at least one student")
            return
        
        # Show progress dialog
        progress = ProgressDialog(self.root, "Generating Failure List", "Creating document...")
        progress.show()
        
        # Use threading to prevent UI freeze
        threading.Thread(target=self._generate_failure_list_thread, 
                        args=(selected_students, progress), daemon=True).start()
    
    def _generate_failure_list_thread(self, selected_students, progress):
        """Background thread for failure list generation"""
        try:
            progress.update_progress(10, "Setting up document...")

            # Create document
            doc = Document()
            DocumentProcessor.set_document_defaults(doc)
            # Failure list always uses landscape orientation
            DocumentProcessor.configure_section(doc, "Landscape")

            progress.update_progress(20, "Adding header...")

            # Add header
            self._add_failure_list_header(doc)

            progress.update_progress(50, "Processing failure data...")

            # Add failure list data
            self._add_failure_list_data(doc, selected_students)

            progress.update_progress(80, "Adding footer tables...")

            # Add footer tables
            self._add_failure_list_footer(doc, selected_students)

            progress.update_progress(90, "Finalizing document...")

            # Save document
            self.root.after(0, lambda: self._save_document(doc, "Failure_List", progress))

        except Exception as e:
            error_msg = str(e)
            self.root.after(0, lambda: self._handle_generation_error(error_msg, progress))
    
    def _add_failure_list_header(self, doc):
    
        # University header
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_after = Pt(0)
        run = p.add_run("Sri Sathya Sai Institute of Higher Learning")
        run.bold = True
        run.font.name = 'Courier New'
        run.font.size = Pt(12)

        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_after = Pt(0)
        run = p.add_run("(Deemed to be University)")
        run.bold = True
        run.font.name = 'Courier New'
        run.font.size = Pt(12)

        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_after = Pt(6)
        run = p.add_run("Vidyagiri, Prasanthi Nilayam - 515 134")
        run.bold = True
        run.font.name = 'Courier New'
        run.font.size = Pt(12)

        # Empty line
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(0)

        # Title
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_after = Pt(6)
        run = p.add_run("List of Failures - End Semester Examinations")
        run.bold = True
        run.font.name = 'Courier New'
        run.font.size = Pt(12)

        # Empty line
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(0)

        # Program name (if provided)
        if self.program_name.get():
            p = doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            p.paragraph_format.space_after = Pt(6)
            run = p.add_run(self.program_name.get())
            run.bold = True
            run.font.name = 'Courier New'
            run.font.size = Pt(12)

            # Empty line after program name
            p = doc.add_paragraph()
            p.paragraph_format.space_after = Pt(0)

        # Batch, Programme, and Semester on one line
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(0)
        
        tab_stops = p.paragraph_format.tab_stops
        tab_stops.add_tab_stop(Inches(5.0), WD_TAB_ALIGNMENT.CENTER)
        tab_stops.add_tab_stop(Inches(10.0), WD_TAB_ALIGNMENT.RIGHT)

        # Batch on the left
        run = p.add_run("Batch : ")
        run.bold = True
        run.font.name = 'Courier New'
        run.font.size = Pt(12)

        run = p.add_run(f"{self.batch.get()}")
        run.bold = True
        run.font.name = 'Courier New'
        run.font.size = Pt(12)

        # Tab to center
        run = p.add_run("\t")

        # Programme in center
        run = p.add_run(f"{self.program_type.get()} PROGRAMME")
        run.bold = True
        run.font.name = 'Courier New'
        run.font.size = Pt(12)

        # Tab to right
        run = p.add_run("\t")

        # Semester on the right
        run = p.add_run(f"Semester : {self.semester.get()}")
        run.bold = True
        run.font.name = 'Courier New'
        run.font.size = Pt(12)

        # Empty line
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(0)

        # Campus and Exam Month on one line
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(6)
        
        tab_stops = p.paragraph_format.tab_stops
        tab_stops.add_tab_stop(Inches(10.0), WD_TAB_ALIGNMENT.RIGHT)
        
        run = p.add_run(f"{self.campus.get()} Campus")
        run.bold = True
        run.font.name = 'Courier New'
        run.font.size = Pt(12)
        
        run = p.add_run("\t")
        
        run = p.add_run(f"{self.examination_month.get()} Examinations")
        run.bold = True
        run.font.name = 'Courier New'
        run.font.size = Pt(12)

        # Separator line
        DocumentProcessor.add_separator_line(doc, space_before=6, space_after=6)

    def _add_failure_list_data(self, doc, selected_students):
        max_name_len = 0
        max_paper_code_len = 0
        max_paper_desc_len = 0
        for student in selected_students:
            name_len = len(str(student.get('Name', '')))
            paper_code_len = len(str(student.get('Paper Code', '')))
            paper_title_len = len(str(student.get('Paper Title', '')))
            if name_len > max_name_len:
                max_name_len = name_len
            if paper_code_len > max_paper_code_len:
                max_paper_code_len = paper_code_len
            if paper_title_len > max_paper_desc_len:
                max_paper_desc_len = paper_title_len
        
        # Calculate column widths with safety checks for NaN
        char_width_cm = 0.18
        
        # Ensure max lengths are valid numbers (not NaN)
        max_name_len = max_name_len if pd.notna(max_name_len) and max_name_len > 0 else 20
        max_paper_code_len = max_paper_code_len if pd.notna(max_paper_code_len) and max_paper_code_len > 0 else 10
        max_paper_desc_len = max_paper_desc_len if pd.notna(max_paper_desc_len) and max_paper_desc_len > 0 else 30
        
        name_width = max(max_name_len * char_width_cm + 1.5, 3.8)
        paper_code_width = max(max_paper_code_len * char_width_cm + 1.2, 2.3)
        paper_desc_width = max(max_paper_desc_len * char_width_cm + 1.3, 7.0)
        
        # Ensure calculated widths are valid
        name_width = name_width if pd.notna(name_width) else 3.8
        paper_code_width = paper_code_width if pd.notna(paper_code_width) else 2.3
        paper_desc_width = paper_desc_width if pd.notna(paper_desc_width) else 7.0
        
        # Scale down if needed
        fixed_widths = 0.8 + 2.5 + 1.8 + 1.8 + 2.1
        variable_widths = name_width + paper_code_width + paper_desc_width
        total_width = fixed_widths + variable_widths
        max_total_width = 26.0
        
        if total_width > max_total_width:
            scale_factor = (max_total_width - fixed_widths) / variable_widths
            name_width = name_width * scale_factor
            paper_code_width = paper_code_width * scale_factor
            paper_desc_width = paper_desc_width * scale_factor
        
        # Column widths for 8 columns
        col_widths_cm = [0.95, 3.5, 5.6, 4.5, 7.97, 1.52, 1.75, 2.38]
        
        # Create header table
        header_table = doc.add_table(rows=1, cols=8)
        header_table.style = 'Table Grid'
        
        # Set column widths
        for i, width in enumerate(col_widths_cm):
            header_table.columns[i].width = Cm(width)
        
        # Set header row height
        header_row = header_table.rows[0]
        header_row.height = Cm(1.65)
        header_row.height_rule = WD_ROW_HEIGHT_RULE.EXACTLY
        
        # Header labels
        headers = ["Sl.\nNo.", "Roll No.", "Name", "Paper Code", "Paper Description", 
                "CIE\nMarks", "ESE\nMark\ns", "Combine\nd Marks"]
        
        for i, text in enumerate(headers):
            cell = header_row.cells[i]
            p = cell.paragraphs[0]
            
            if i == 2 or i == 4:
                p.alignment = WD_ALIGN_PARAGRAPH.LEFT
            else:
                p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            
            run = p.add_run(text)
            run.bold = True
            run.font.name = "Courier New"
            run.font.size = Pt(12)
            
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            
            tc = cell._tc
            tcPr = tc.get_or_add_tcPr()
            
            textNoWrap = OxmlElement('w:noWrap')
            textNoWrap.set(qn('w:val'), "true")
            tcPr.append(textNoWrap)
            
            cell_width = OxmlElement('w:tcW')
            cell_width.set(qn('w:w'), str(int(col_widths_cm[i] * 567)))
            cell_width.set(qn('w:type'), 'dxa')
            tcPr.append(cell_width)
            
            tcMar = OxmlElement('w:tcMar')
            for margin in ['top', 'right', 'bottom', 'left']:
                node = OxmlElement(f'w:{margin}')
                node.set(qn('w:w'), '0')
                node.set(qn('w:type'), 'dxa')
                tcMar.append(node)
            tcPr.append(tcMar)
        
        # Remove table borders
        self.remove_table_borders(header_table)
    
        # Add spacing between header and data table
        # spacing_para = doc.add_paragraph()
        # spacing_para.paragraph_format.space_after = Pt(6)

        # Add separator line after header
        DocumentProcessor.add_separator_line(doc, space_before=0, space_after=6)
        
        # Create data table
        data_table = doc.add_table(rows=len(selected_students), cols=8)
        data_table.style = 'Table Grid'
        
        # Set column widths
        for i, width in enumerate(col_widths_cm):
            data_table.columns[i].width = Cm(width)
        
        # Set uniform row height
        for row in data_table.rows:
            row.height = Cm(1.65)
            row.height_rule = WD_ROW_HEIGHT_RULE.EXACTLY
        
        # Fill data rows
        for idx, student in enumerate(selected_students):
            table_row = data_table.rows[idx]
            
            paper_code = str(student.get('Paper Code', '')).strip()
            paper_title = str(student.get('Paper Title', '')).strip()
            cie_marks = student.get('CIE Marks', student.get('CIE %', ''))
            ese_marks = student.get('ESE Marks', student.get('ESE %', ''))
            combined_marks = student.get('Combined Marks', student.get('COMB %', ''))
            
            vals = [
                f"{idx+1}.",
                str(student.get('Regd No', '')),
                str(student.get('Name', '')),
                paper_code if paper_code else '--',
                paper_title if paper_title else '--',
                str(cie_marks) if pd.notna(cie_marks) and str(cie_marks).strip() else '--',
                str(ese_marks) if pd.notna(ese_marks) and str(ese_marks).strip() else '--',
                str(combined_marks) if pd.notna(combined_marks) and str(combined_marks).strip() else '--'
            ]
            
            for col_index, val in enumerate(vals):
                cell = table_row.cells[col_index]
                p = cell.paragraphs[0]
                
                if col_index == 2 or col_index == 4:
                    p.alignment = WD_ALIGN_PARAGRAPH.LEFT
                else:
                    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                
                p.paragraph_format.keep_together = True
                p.paragraph_format.widow_control = True
                
                tcPr = cell._tc.get_or_add_tcPr()
                
                existing_nowrap = tcPr.xpath('./w:noWrap')
                for nowrap in existing_nowrap:
                    tcPr.remove(nowrap)
                
                textNoWrap = OxmlElement('w:noWrap')
                textNoWrap.set(qn('w:val'), "true")
                tcPr.append(textNoWrap)
                
                cell_width = OxmlElement('w:tcW')
                cell_width.set(qn('w:w'), str(int(col_widths_cm[col_index] * 567)))
                cell_width.set(qn('w:type'), 'dxa')
                
                existing_width = tcPr.xpath('./w:tcW')
                for width_elem in existing_width:
                    tcPr.remove(width_elem)
                tcPr.append(cell_width)
                
                run = p.add_run(str(val))
                run.bold = True
                run.font.name = "Courier New"
                run.font.size = Pt(12)
                
                cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
                
                tc = cell._tc
                tcPr = tc.get_or_add_tcPr()
                tcMar = OxmlElement('w:tcMar')
                for margin in ['top', 'right', 'bottom', 'left']:
                    node = OxmlElement(f'w:{margin}')
                    node.set(qn('w:w'), '0')
                    node.set(qn('w:type'), 'dxa')
                    tcMar.append(node)
                tcPr.append(tcMar)
        
        # Remove borders from data table
        self.remove_table_borders(data_table)

        # Add separator line after data table
        DocumentProcessor.add_separator_line(doc, space_before=6, space_after=6)
    def remove_table_borders(self, table):
        """Remove all borders from a table"""
        tbl = table._tbl
        tblPr = tbl.xpath('./w:tblPr')
        if tblPr:
            tblPr = tblPr[0]
        else:
            tblPr = OxmlElement('w:tblPr')
            tbl.insert(0, tblPr)
        
        # Create borders element with nil values
        tblBorders = OxmlElement('w:tblBorders')
        
        for border in ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']:
            borderElem = OxmlElement(f'w:{border}')
            borderElem.set(qn('w:val'), 'nil')
            tblBorders.append(borderElem)
        
        # Remove existing borders if any
        existing_borders = tblPr.find(qn('w:tblBorders'))
        if existing_borders is not None:
            tblPr.remove(existing_borders)
        
        # Add new borders with nil values
        tblPr.append(tblBorders)
        
        # Also set cell borders to nil
        for row in table.rows:
            for cell in row.cells:
                tc = cell._tc
                tcPr = tc.get_or_add_tcPr()
                tcBorders = OxmlElement('w:tcBorders')
                
                for border in ['top', 'left', 'bottom', 'right']:
                    borderElem = OxmlElement(f'w:{border}')
                    borderElem.set(qn('w:val'), 'nil')
                    tcBorders.append(borderElem)
                
                # Remove existing borders if any
                existing_borders = tcPr.find(qn('w:tcBorders'))
                if existing_borders is not None:
                    tcPr.remove(existing_borders)
                
                # Add new borders with nil values
                tcPr.append(tcBorders)


    def add_separator_line(self, doc, space_before=6, space_after=0):
        """Add separator line (dashed line)"""
        separator = doc.add_paragraph()
        separator.alignment = WD_ALIGN_PARAGRAPH.CENTER
        separator.paragraph_format.space_before = Pt(space_before)
        separator.paragraph_format.space_after = Pt(space_after)
        
        # For landscape, available width is approximately 26 cm
        dash_count = 270  # Increased for full width
        separator_run = separator.add_run('‐' * dash_count)
        separator_run.font.name = "Calibri"
        separator_run.font.size = Pt(9)
        separator_run.font.bold = False
        
        # Prevent line wrapping
        paragraph_format = separator.paragraph_format
        paragraph_format.keep_together = True
        paragraph_format.keep_with_next = True
        paragraph_format.widow_control = True
        
        return separator

    def _add_failure_list_footer(self, doc, selected_students):
        """Add footer tables for failure list"""

        # Add spacing before footer tables
        doc.add_paragraph()
        doc.add_paragraph()

        # Table 1: Paper Details
        # Extract unique paper codes with professor details
        unique_papers = {}
        for student in selected_students:
            paper_code = str(student.get('Paper Code', '')).strip()
            if paper_code and paper_code != '--':
                unique_papers[paper_code] = {
                    'code': paper_code,
                    'taught_by': student.get('Paper Taught', ''),
                    'qp_setter': student.get('QP Setter', ''),
                    'examiner': student.get('Examiner', '')
                }

        # Create Paper Details table
        if unique_papers:
            num_papers = len(unique_papers)
            paper_table = doc.add_table(rows=num_papers + 1, cols=4)
            paper_table.style = 'Table Grid'
            
            # Set table properties for right alignment
            tbl = paper_table._tbl
            tblPr = tbl.tblPr
            if tblPr is None:
                tblPr = OxmlElement('w:tblPr')
                tbl.insert(0, tblPr)
            
            # Set table width
            tblW = OxmlElement('w:tblW')
            tblW.set(qn('w:w'), '6700')
            tblW.set(qn('w:type'), 'dxa')
            tblPr.append(tblW)
            
            # Set right alignment
            jc = OxmlElement('w:jc')
            jc.set(qn('w:val'), 'right')
            tblPr.append(jc)

            # Set column widths for paper table
            paper_table.columns[0].width = Cm(3.02)   # Paper Code
            paper_table.columns[1].width = Cm(4.92)   # Paper Taught
            paper_table.columns[2].width = Cm(4.92)   # QP Setter
            paper_table.columns[3].width = Cm(4.92)   # Examiner

            # Header row
            header_cells = paper_table.rows[0].cells
            headers = ["Paper Code", "Paper Taught", "QP Setter", "Examiner"]

            for i, header in enumerate(headers):
                header_cells[i].text = header
                header_cells[i].paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
                header_cells[i].paragraphs[0].runs[0].bold = True
                header_cells[i].paragraphs[0].runs[0].font.name = 'Courier New'
                header_cells[i].paragraphs[0].runs[0].font.size = Pt(10)
                header_cells[i].vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER

            # Data rows
            for idx, paper_code in enumerate(sorted(unique_papers.keys())):
                row = paper_table.rows[idx + 1]
                row.height = Cm(0.89)
                row.height_rule = WD_ROW_HEIGHT_RULE.EXACTLY
                cells = row.cells
                paper_info = unique_papers[paper_code]

                # Paper Code
                cells[0].text = paper_info['code']
                cells[0].paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
                cells[0].paragraphs[0].runs[0].font.name = 'Courier New'
                cells[0].paragraphs[0].runs[0].font.size = Pt(10)
                cells[0].vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER

                # Paper Taught - with last name underlined
                taught_by = str(paper_info.get('taught_by', ''))
                p1 = cells[1].paragraphs[0]
                p1.alignment = WD_ALIGN_PARAGRAPH.CENTER
                name_parts = taught_by.split()
                if len(name_parts) > 1:
                    run1 = p1.add_run(' '.join(name_parts[:-1]) + ' ')
                    run1.font.name = 'Courier New'
                    run1.font.size = Pt(10)
                    run2 = p1.add_run(name_parts[-1])
                    run2.font.name = 'Courier New'
                    run2.font.size = Pt(10)
                    run2.font.underline = True
                else:
                    run = p1.add_run(taught_by)
                    run.font.name = 'Courier New'
                    run.font.size = Pt(10)
                    #run.font.underline = True
                cells[1].vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER

                # QP Setter - with last name underlined
                qp_setter = str(paper_info.get('qp_setter', ''))
                p2 = cells[2].paragraphs[0]
                p2.alignment = WD_ALIGN_PARAGRAPH.CENTER
                name_parts = qp_setter.split()
                if len(name_parts) > 1:
                    run1 = p2.add_run(' '.join(name_parts[:-1]) + ' ')
                    run1.font.name = 'Courier New'
                    run1.font.size = Pt(10)
                    run2 = p2.add_run(name_parts[-1])
                    run2.font.name = 'Courier New'
                    run2.font.size = Pt(10)
                    run2.font.underline = True
                else:
                    run = p2.add_run(qp_setter)
                    run.font.name = 'Courier New'
                    run.font.size = Pt(10)
                    #run.font.underline = True
                cells[2].vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER

                # Examiner - with last name underlined
                examiner = str(paper_info.get('examiner', ''))
                p3 = cells[3].paragraphs[0]
                p3.alignment = WD_ALIGN_PARAGRAPH.CENTER
                name_parts = examiner.split()
                if len(name_parts) > 1:
                    run1 = p3.add_run(' '.join(name_parts[:-1]) + ' ')
                    run1.font.name = 'Courier New'
                    run1.font.size = Pt(10)
                    run2 = p3.add_run(name_parts[-1])
                    run2.font.name = 'Courier New'
                    run2.font.size = Pt(10)
                    run2.font.underline = True
                else:
                    run = p3.add_run(examiner)
                    run.font.name = 'Courier New'
                    run.font.size = Pt(10)
                    #run.font.underline = True
                cells[3].vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER

        # Add spacing between tables
        doc.add_paragraph()

        # Table 2: Previous University Information
        # Filter unique students for this table
        unique_students_footer = []
        seen_reg_nos = set()
        for student in selected_students:
            reg_no = student.get('Regd No')
            if reg_no not in seen_reg_nos:
                seen_reg_nos.add(reg_no)
                unique_students_footer.append(student)

        num_students = len(unique_students_footer)
        uni_table = doc.add_table(rows=num_students + 1, cols=4)
        uni_table.style = 'Table Grid'
        
        # Set table properties for right alignment
        tbl = uni_table._tbl
        tblPr = tbl.tblPr
        if tblPr is None:
            tblPr = OxmlElement('w:tblPr')
            tbl.insert(0, tblPr)
        
        # Set table width
        tblW = OxmlElement('w:tblW')
        tblW.set(qn('w:w'), '6064')
        tblW.set(qn('w:type'), 'dxa')
        tblPr.append(tblW)
        
        # Set right alignment
        jc = OxmlElement('w:jc')
        jc.set(qn('w:val'), 'right')
        tblPr.append(jc)

        # Set column widths for university table
        uni_table.columns[0].width = Cm(2.22)   # Sl. No.
        uni_table.columns[1].width = Cm(3.18)   # Regd. No.
        uni_table.columns[2].width = Cm(6.82)   # Previous University
        uni_table.columns[3].width = Cm(3.82)   # Previous CGPA

        # Header row
        header_cells = uni_table.rows[0].cells
        headers = ["Sl. No.", "Regd. No.", "Previous University", "Previous CGPA"]

        for i, header in enumerate(headers):
            header_cells[i].text = header
            header_cells[i].paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
            header_cells[i].paragraphs[0].runs[0].bold = True
            header_cells[i].paragraphs[0].runs[0].font.name = 'Courier New'
            header_cells[i].paragraphs[0].runs[0].font.size = Pt(10)
            header_cells[i].vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER

        # Data rows
        for idx, student in enumerate(unique_students_footer):
            row = uni_table.rows[idx + 1]
            row.height = Cm(0.89)
            row.height_rule = WD_ROW_HEIGHT_RULE.EXACTLY
            cells = row.cells

            # Sl. No.
            cells[0].text = f"{idx + 1}."
            cells[0].paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
            cells[0].paragraphs[0].runs[0].font.name = 'Courier New'
            cells[0].paragraphs[0].runs[0].font.size = Pt(10)
            cells[0].vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER

            # Regd. No.
            regd_no = str(student.get('Regd No', ''))
            cells[1].text = regd_no
            cells[1].paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
            cells[1].paragraphs[0].runs[0].font.name = 'Courier New'
            cells[1].paragraphs[0].runs[0].font.size = Pt(10)
            cells[1].vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER

            # Previous University
            prev_uni = str(student.get('Previous University', '')) if pd.notna(student.get('Previous University')) else ""
            cells[2].text = prev_uni
            cells[2].paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.LEFT
            cells[2].paragraphs[0].runs[0].font.name = 'Courier New'
            cells[2].paragraphs[0].runs[0].font.size = Pt(10)
            cells[2].vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER

            # Previous CGPA
            prev_cgpa = str(student.get('Previous CGPA', '')) if pd.notna(student.get('Previous CGPA')) else ""
            cells[3].text = prev_cgpa
            cells[3].paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
            cells[3].paragraphs[0].runs[0].font.name = 'Courier New'
            cells[3].paragraphs[0].runs[0].font.size = Pt(10)
            cells[3].vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER

    def _save_document(self, doc, doc_type, progress):
        """Save the generated document"""
        try:
            # Get input file path and extract directory and filename
            input_file_path = self.excel_path.get()
            if not input_file_path:
                raise ValueError("No input file selected")
            
            # Extract directory and base filename
            input_dir = os.path.dirname(input_file_path)
            input_filename = os.path.basename(input_file_path)
            base_filename = os.path.splitext(input_filename)[0]  # Remove extension
            
            # Define folder name based on document type
            folder_mapping = {
                "Result_Sheet": "1. Result Sheet",
                "Gracing_List": "2. Gracing List",
                "Failure_List": "3. Failure List",
                "CGPA_Sheet": "4. CGPA Sheet"
            }
            
            folder_name = folder_mapping.get(doc_type, doc_type)
            output_folder = os.path.join(input_dir, folder_name)
            
            # Create the folder if it doesn't exist
            progress.update_progress(92, f"Creating folder: {folder_name}...")
            os.makedirs(output_folder, exist_ok=True)
            
            # Generate output filename (same as input but with .docx extension)
            output_filename = f"{base_filename}.docx"
            save_path = os.path.join(output_folder, output_filename)
            
            progress.update_progress(95, "Saving document...")
            doc.save(save_path)
            
            progress.update_progress(100, "Document saved successfully!")
            time.sleep(0.5)
            progress.close()
            
            self.status_var.set(f"Document saved: {output_filename}")
            
            # Show success message with full path
            if messagebox.askyesno("Success", 
                                f"Document saved successfully!\n\nLocation: {output_folder}\nFilename: {output_filename}\n\nWould you like to open it now?"):
                try:
                    os.startfile(save_path)
                except Exception as e:
                    messagebox.showinfo("Info", f"Document saved but could not be opened automatically.\n\nPath: {save_path}")
                    
        except Exception as e:
            progress.close()
            messagebox.showerror("Error", f"Failed to save document: {str(e)}")
            self.status_var.set("Failed to save document")
    
    def _handle_generation_error(self, error_msg, progress):
        """Handle document generation errors"""
        progress.close()
        messagebox.showerror("Error", f"An error occurred while generating the document: {error_msg}")
        self.status_var.set("Document generation failed")


if __name__ == "__main__":
    root = tk.Tk()
    app = AcademicDocumentGenerator(root)
    root.mainloop()