# -*- coding: utf-8 -*-
"""
Corporate documentation generator for the Martinrea AP Automation -
Ingestion Epic (ING-01..06).

Produces: Ingestion_Epic_Documentation.pdf
Engine   : ReportLab (pure-vector; cover page, TOC w/ bookmarks,
           flowcharts, styled tables, running header/footer).
"""
import math
from datetime import date

from reportlab.lib import colors
from reportlab.lib.colors import HexColor, white, black
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_JUSTIFY
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm, mm
from reportlab.platypus import (
    BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table, TableStyle,
    PageBreak, NextPageTemplate, KeepTogether, ListFlowable, ListItem,
    Preformatted, Flowable,
)
from reportlab.platypus.tableofcontents import TableOfContents
from reportlab.graphics.shapes import Drawing, Rect, String, Polygon, Line

# --------------------------------------------------------------------------
# Brand palette
# --------------------------------------------------------------------------
NAVY    = HexColor("#14304F")   # primary
NAVY2   = HexColor("#1F4E79")   # secondary
RED     = HexColor("#C8102E")   # Martinrea accent
STEEL   = HexColor("#4B6584")
LIGHT   = HexColor("#EEF2F7")   # zebra row
LIGHT2  = HexColor("#F7F9FB")
LINE    = HexColor("#C9D4DF")
GREEN   = HexColor("#1E8449")
AMBER   = HexColor("#B9770E")
INK     = HexColor("#22303C")
MUTED   = HexColor("#5B6B79")

PAGE_W, PAGE_H = A4
LM = RM = 1.9 * cm
TM = 2.3 * cm
BM = 2.0 * cm
CONTENT_W = PAGE_W - LM - RM

DOC_TITLE = "Ingestion Epic - Technical Documentation"
DOC_SUB   = "Martinrea AP Automation Platform - Phase 1 (Foundation & Paperless)"
VERSION   = "1.0"
TODAY     = date(2026, 6, 15).strftime("%d %B %Y")

# ==========================================================================
# Flowchart primitives (ReportLab graphics; origin bottom-left)
# ==========================================================================
def _wrap(text, max_chars):
    words = text.split()
    lines, cur = [], ""
    for w in words:
        if not cur:
            cur = w
        elif len(cur) + 1 + len(w) <= max_chars:
            cur += " " + w
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def box(d, x, y, w, h, text, fill=NAVY, stroke=NAVY, fc=white,
        fs=8.3, bold=True, radius=5, max_chars=None):
    d.add(Rect(x, y, w, h, rx=radius, ry=radius,
               fillColor=fill, strokeColor=stroke, strokeWidth=1))
    if max_chars is None:
        max_chars = max(6, int(w / (fs * 0.52)))
    lines = text if isinstance(text, list) else _wrap(text, max_chars)
    fn = "Helvetica-Bold" if bold else "Helvetica"
    lh = fs + 2.0
    ty = y + h / 2 + (len(lines) * lh) / 2 - fs + 1
    for ln in lines:
        d.add(String(x + w / 2, ty, ln, textAnchor="middle",
                     fontName=fn, fontSize=fs, fillColor=fc))
        ty -= lh


def diamond(d, cx, cy, w, h, text, fill=HexColor("#FCE9D6"),
            stroke=AMBER, fc=INK, fs=7.8, max_chars=None):
    d.add(Polygon([cx, cy + h / 2, cx + w / 2, cy, cx, cy - h / 2, cx - w / 2, cy],
                  fillColor=fill, strokeColor=stroke, strokeWidth=1.1))
    if max_chars is None:
        max_chars = max(6, int(w / (fs * 0.6)))
    lines = text if isinstance(text, list) else _wrap(text, max_chars)
    lh = fs + 1.6
    ty = cy + (len(lines) * lh) / 2 - fs + 1
    for ln in lines:
        d.add(String(cx, ty, ln, textAnchor="middle",
                     fontName="Helvetica-Bold", fontSize=fs, fillColor=fc))
        ty -= lh


def arrow(d, x1, y1, x2, y2, color=STEEL, w=1.3, label=None,
          lcolor=MUTED, lanchor="start", ldx=4, ldy=2, dash=False):
    ln = Line(x1, y1, x2, y2, strokeColor=color, strokeWidth=w)
    if dash:
        ln.strokeDashArray = [3, 2]
    d.add(ln)
    ang = math.atan2(y2 - y1, x2 - x1)
    s = 6.5
    a1, a2 = ang + math.radians(152), ang - math.radians(152)
    d.add(Polygon([x2, y2,
                   x2 + s * math.cos(a1), y2 + s * math.sin(a1),
                   x2 + s * math.cos(a2), y2 + s * math.sin(a2)],
                  fillColor=color, strokeColor=color))
    if label:
        mx, my = (x1 + x2) / 2, (y1 + y2) / 2
        d.add(String(mx + ldx, my + ldy, label, fontName="Helvetica-Bold",
                     fontSize=7, fillColor=lcolor, textAnchor=lanchor))


def caption_for(name):
    return name


# ==========================================================================
# Diagram A - Three-channel architecture (ports & adapters)
# ==========================================================================
def diagram_architecture():
    W, H = 470, 486
    d = Drawing(W, H)
    src_y, ch_y = 438, 356
    src_w, src_h, ch_h = 138, 38, 44
    centers = [71, 235, 399]
    sources = ["Vendor e-mail\n(M365 Graph / Gmail IMAP)",
               "Partner / plant SFTP\nfile drop",
               "AP Clerk\nweb portal upload"]
    channels = ["EmailIngestionService\n(@nestjs/schedule cron)",
                "SftpIngestionService\n(@nestjs/schedule cron)",
                "PortalIngestionController\n(REST + Multer + JWT)"]
    tags = ["ING-02", "ING-03", "ING-04"]
    for cx, s, c, tg in zip(centers, sources, channels, tags):
        box(d, cx - src_w / 2, src_y, src_w, src_h, s.split("\n"),
            fill=LIGHT, stroke=STEEL, fc=INK, fs=7.6, bold=False)
        box(d, cx - src_w / 2, ch_y, src_w, ch_h, c.split("\n"),
            fill=NAVY2, stroke=NAVY, fs=7.7)
        d.add(String(cx + src_w / 2 - 2, ch_y + ch_h + 3, tg,
                     fontName="Helvetica-Bold", fontSize=6.6,
                     fillColor=RED, textAnchor="end"))
        arrow(d, cx, src_y, cx, ch_y + ch_h)

    # Pre-processing funnel node
    pp_y, pp_w = 270, 300
    box(d, 235 - pp_w / 2, pp_y, pp_w, 46,
        ["PreProcessingService.validateAndHandoff()",
         "validate -> SHA-256 hash -> stamp metadata -> dispatch"],
        fill=RED, stroke=RED, fs=8.4)
    d.add(String(235 + pp_w / 2 - 2, pp_y + 46 + 3, "ING-01 / ING-05",
                 fontName="Helvetica-Bold", fontSize=6.6,
                 fillColor=RED, textAnchor="end"))
    for cx in centers:
        arrow(d, cx, ch_y, 235, pp_y + 46)

    # Blob client
    bl_y, bl_w = 196, 250
    box(d, 235 - bl_w / 2, bl_y, bl_w, 40,
        ["BlobUploadClient (contract)",
         "local FS  |  backend HTTP API  |  OCI PAR"],
        fill=NAVY, stroke=NAVY, fs=8.0)
    arrow(d, 235, pp_y, 235, bl_y + 40)

    # Outputs
    raw_cx, q_cx = 125, 350
    box(d, raw_cx - 95, 120, 190, 38,
        ["Accepted -> raw store", "(net-new documents)"],
        fill=HexColor("#E7F4EC"), stroke=GREEN, fc=HexColor("#13532F"), fs=7.8)
    box(d, q_cx - 90, 120, 180, 38,
        ["Rejected -> quarantine", "(audit trail, reason code)"],
        fill=HexColor("#FBE9E7"), stroke=RED, fc=HexColor("#7A1420"), fs=7.8)
    arrow(d, 200, bl_y, raw_cx + 40, 158, color=GREEN, label="accepted", lcolor=GREEN, ldx=-58, ldy=4)
    arrow(d, 270, bl_y, q_cx - 20, 158, color=RED, label="rejected", lcolor=RED, ldx=4, ldy=4)

    # Downstream
    box(d, raw_cx - 105, 36, 210, 40,
        ["Data & Repository Epic (Roshni)",
         "Azure Blob + PostgreSQL -> OCR queue (Abhay)"],
        fill=STEEL, stroke=NAVY, fs=7.4)
    box(d, q_cx - 90, 36, 180, 40,
        ["Ops / QA review", "(rejected-document inspection)"],
        fill=LIGHT, stroke=STEEL, fc=INK, fs=7.6, bold=False)
    arrow(d, raw_cx, 120, raw_cx, 76, color=GREEN)
    arrow(d, q_cx, 120, q_cx, 76, color=RED, dash=True)

    box(d, 8, 6, 260, 18,
        ["Dashed = audit path   |   Solid = primary funnel"],
        fill=white, stroke=white, fc=MUTED, fs=6.8, bold=False)
    return d


# ==========================================================================
# Diagram B - Pre-processing validation funnel
# ==========================================================================
def diagram_funnel():
    W, H = 470, 560
    d = Drawing(W, H)
    mcx, rcx = 150, 372         # main column / reject column centres
    rw = 188

    box(d, mcx - 105, 520, 210, 32,
        ["StagedDocument: buffer + source metadata"],
        fill=NAVY2, stroke=NAVY, fs=8.0)

    def reject(y, txt, code):
        box(d, rcx - rw / 2, y, rw, 38, _wrap(txt, 34),
            fill=HexColor("#FBE9E7"), stroke=RED, fc=HexColor("#7A1420"),
            fs=7.3, bold=True)
        d.add(String(rcx, y - 9, code, textAnchor="middle",
                     fontName="Helvetica-Bold", fontSize=6.8, fillColor=RED))

    # Decision 1
    diamond(d, mcx, 478, 150, 50, "Empty buffer?")
    arrow(d, mcx, 520, mcx, 503)
    reject(459, "EmptyFileError -> quarantine", "HTTP 400  EMPTY_FILE")
    arrow(d, mcx + 75, 478, rcx - rw / 2, 478, color=RED, label="yes", lcolor=RED, ldx=6, ldy=4)

    # Decision 2
    diamond(d, mcx, 405, 160, 52, "Size > MAX_FILE_BYTES (10 MiB)?")
    arrow(d, mcx, 453, mcx, 431, label="no", ldx=5)
    reject(386, "FileTooLargeError -> quarantine", "HTTP 413  FILE_TOO_LARGE")
    arrow(d, mcx + 80, 405, rcx - rw / 2, 405, color=RED, label="yes", lcolor=RED, ldx=6, ldy=4)

    # Decision 3
    diamond(d, mcx, 330, 168, 54,
            "MIME in allow-list? (magic-byte sniff, not extension)")
    arrow(d, mcx, 379, mcx, 357, label="no", ldx=5)
    reject(311, "InvalidFileTypeError -> quarantine", "HTTP 415  INVALID_TYPE")
    arrow(d, mcx + 84, 330, rcx - rw / 2, 330, color=RED, label="yes", lcolor=RED, ldx=6, ldy=4)

    # Hash + metadata + upload
    box(d, mcx - 105, 262, 210, 32, ["Compute SHA-256 content hash"],
        fill=NAVY, stroke=NAVY, fs=8.0)
    arrow(d, mcx, 303, mcx, 294, label="no", ldx=5)
    box(d, mcx - 105, 214, 210, 32, ["Stamp IngestionMetadata"],
        fill=NAVY, stroke=NAVY, fs=8.0)
    arrow(d, mcx, 262, mcx, 246)
    box(d, mcx - 105, 166, 210, 32, ["BlobUploadClient.upload(document)"],
        fill=NAVY, stroke=NAVY, fs=8.0)
    arrow(d, mcx, 214, mcx, 198)

    # Duplicate decision
    diamond(d, mcx, 110, 150, 52, "isDuplicate?")
    arrow(d, mcx, 166, mcx, 136)
    box(d, rcx - rw / 2, 92, rw, 38,
        ["Ack source, skip OCR", "(idempotent no-op)"],
        fill=HexColor("#FEF6E7"), stroke=AMBER, fc=HexColor("#6B4A06"), fs=7.4)
    arrow(d, mcx + 75, 110, rcx - rw / 2, 110, color=AMBER, label="yes", lcolor=AMBER, ldx=6, ldy=4)

    box(d, mcx - 110, 36, 220, 40,
        ["Persist + trigger OCR queue", "(net-new document -> Abhay)"],
        fill=HexColor("#E7F4EC"), stroke=GREEN, fc=HexColor("#13532F"), fs=7.8)
    arrow(d, mcx, 84, mcx, 76, color=GREEN, label="no", lcolor=GREEN, ldx=5)
    return d


# ==========================================================================
# Diagram C - Email channel (ING-02)
# ==========================================================================
def diagram_email():
    W, H = 470, 360
    d = Drawing(W, H)
    cx = 150
    box(d, cx - 110, 318, 220, 32, ["Cron tick - EMAIL_POLL_CRON (every 2 min)"],
        fill=NAVY2, stroke=NAVY, fs=7.8)
    box(d, cx - 110, 268, 220, 34, ["fetchUnreadWithAttachments(mailbox)"],
        fill=NAVY, stroke=NAVY, fs=7.8)
    arrow(d, cx, 318, cx, 302)
    diamond(d, cx, 222, 150, 50, "Message has attachments?")
    arrow(d, cx, 268, cx, 247)
    box(d, 322 - 70, 205, 160, 34, ["Move -> AP-No-Attachment", "(human review)"],
        fill=LIGHT, stroke=STEEL, fc=INK, fs=7.3, bold=False)
    arrow(d, cx + 75, 222, 322 - 70, 222, color=STEEL, label="no", ldx=6, ldy=4)
    box(d, cx - 115, 150, 230, 34,
        ["For each attachment:", "PreProcessingService.validateAndHandoff()"],
        fill=RED, stroke=RED, fs=7.6)
    arrow(d, cx, 197, cx, 184, label="yes", ldx=5)
    diamond(d, cx, 96, 156, 52, "At least one attachment ingested?")
    arrow(d, cx, 150, cx, 122)
    box(d, 322 - 72, 80, 164, 34, ["Mark read -> AP-Processed"],
        fill=HexColor("#E7F4EC"), stroke=GREEN, fc=HexColor("#13532F"), fs=7.6)
    arrow(d, cx + 78, 96, 322 - 72, 96, color=GREEN, label="yes", lcolor=GREEN, ldx=6, ldy=4)
    box(d, cx - 82, 26, 164, 34, ["Move -> AP-Failed", "(all rejected)"],
        fill=HexColor("#FBE9E7"), stroke=RED, fc=HexColor("#7A1420"), fs=7.4)
    arrow(d, cx, 70, cx, 60, color=RED, label="no", lcolor=RED, ldx=5)
    d.add(String(466, 8, "Folder moves retry 3x with exponential back-off",
                 fontName="Helvetica-Oblique", fontSize=6.8,
                 fillColor=MUTED, textAnchor="end"))
    return d


# ==========================================================================
# Diagram D - SFTP channel (ING-03)
# ==========================================================================
def diagram_sftp():
    W, H = 470, 466
    d = Drawing(W, H)
    cx = 150
    box(d, cx - 110, 424, 220, 30, ["Cron tick - SFTP_POLL_CRON (every 2 min)"],
        fill=NAVY2, stroke=NAVY, fs=7.7)
    box(d, cx - 110, 380, 220, 30, ["connect() - fresh session per poll"],
        fill=NAVY, stroke=NAVY, fs=7.7)
    arrow(d, cx, 424, cx, 410)
    box(d, cx - 110, 336, 220, 30, ["list(remotePath) for each plant folder"],
        fill=NAVY, stroke=NAVY, fs=7.7)
    arrow(d, cx, 380, cx, 366)

    diamond(d, cx, 292, 150, 48, "Modified < grace (30s)?")
    arrow(d, cx, 336, cx, 316)
    box(d, 330 - 66, 277, 158, 30, ["Skip - still being written"],
        fill=LIGHT, stroke=STEEL, fc=INK, fs=7.2, bold=False)
    arrow(d, cx + 75, 292, 330 - 66, 292, color=STEEL, label="yes", ldx=6, ldy=4)

    diamond(d, cx, 224, 156, 48, "Size > hard ceiling (50 MiB)?")
    arrow(d, cx, 268, cx, 248, label="no", ldx=5)
    box(d, 330 - 66, 209, 158, 30, ["Skip - bandwidth guard", "(left on server)"],
        fill=LIGHT, stroke=STEEL, fc=INK, fs=7.0, bold=False)
    arrow(d, cx + 78, 224, 330 - 66, 224, color=STEEL, label="yes", ldx=6, ldy=4)

    box(d, cx - 105, 158, 210, 30, ["get() download -> validateAndHandoff()"],
        fill=RED, stroke=RED, fs=7.6)
    arrow(d, cx, 200, cx, 188, label="no", ldx=5)

    # three outcomes
    oy = 92
    box(d, 18, oy, 138, 46, ["Success", "-> delete from SFTP"],
        fill=HexColor("#E7F4EC"), stroke=GREEN, fc=HexColor("#13532F"), fs=7.3)
    box(d, 166, oy, 138, 46, ["Permanent reject", "(quarantined) -> delete"],
        fill=HexColor("#FBE9E7"), stroke=RED, fc=HexColor("#7A1420"), fs=7.3)
    box(d, 314, oy, 138, 46, ["Transient error", "-> leave for next poll"],
        fill=HexColor("#FEF6E7"), stroke=AMBER, fc=HexColor("#6B4A06"), fs=7.3)
    arrow(d, cx, 158, 87, oy + 46, color=GREEN)
    arrow(d, cx, 158, 235, oy + 46, color=RED)
    arrow(d, cx, 158, 383, oy + 46, color=AMBER)

    box(d, cx - 90, 22, 180, 30, ["disconnect() at end of poll"],
        fill=NAVY, stroke=NAVY, fs=7.6)
    arrow(d, 87, oy, 120, 52, color=STEEL, dash=True)
    arrow(d, 235, oy, 160, 52, color=STEEL, dash=True)
    arrow(d, 383, oy, 200, 52, color=STEEL, dash=True)
    return d


# ==========================================================================
# Styles
# ==========================================================================
styles = getSampleStyleSheet()


def S(name, **kw):
    base = kw.pop("parent", styles["Normal"])
    st = ParagraphStyle(name, parent=base, **kw)
    styles.add(st)
    return st


S("Body", fontName="Helvetica", fontSize=9.6, leading=14.2,
  textColor=INK, alignment=TA_JUSTIFY, spaceAfter=7)
S("BodyL", parent=styles["Body"], alignment=TA_LEFT)
S("Lead", fontName="Helvetica", fontSize=10.5, leading=15.5,
  textColor=NAVY, alignment=TA_LEFT, spaceAfter=8)
S("H1", fontName="Helvetica-Bold", fontSize=16, leading=20,
  textColor=NAVY, spaceBefore=6, spaceAfter=10)
S("H2", fontName="Helvetica-Bold", fontSize=12.2, leading=16,
  textColor=NAVY2, spaceBefore=12, spaceAfter=6)
S("H3", fontName="Helvetica-Bold", fontSize=10.4, leading=14,
  textColor=RED, spaceBefore=8, spaceAfter=3)
S("Bull", fontName="Helvetica", fontSize=9.5, leading=13.6,
  textColor=INK, alignment=TA_LEFT)
S("Cell", fontName="Helvetica", fontSize=8.4, leading=11.2, textColor=INK)
S("CellB", parent=styles["Cell"], fontName="Helvetica-Bold")
S("CellH", parent=styles["Cell"], fontName="Helvetica-Bold",
  textColor=white, fontSize=8.6)
S("CellMono", fontName="Courier", fontSize=8.0, leading=10.8, textColor=INK)
S("Cap", fontName="Helvetica-Oblique", fontSize=8.3, leading=11,
  textColor=MUTED, alignment=TA_CENTER, spaceBefore=4, spaceAfter=10)
S("Codeblk", fontName="Courier", fontSize=8.1, leading=11.4, textColor=HexColor("#1B2B36"))
S("TOC1", fontName="Helvetica-Bold", fontSize=10, leading=18, textColor=NAVY)
S("TOC2", fontName="Helvetica", fontSize=9.2, leading=15, textColor=INK, leftIndent=16)
S("Small", fontName="Helvetica", fontSize=8, leading=10.5, textColor=MUTED)


def P(t, s="Body"):
    return Paragraph(t, styles[s])


def bullets(items, style="Bull", gap=3):
    li = [ListItem(Paragraph(t, styles[style]), leftIndent=14, value="\u2022")
          for t in items]
    return ListFlowable(li, bulletType="bullet", start="\u2022",
                        bulletColor=RED, bulletFontSize=8, spaceBefore=2,
                        spaceAfter=6, leftIndent=6)


# ==========================================================================
# Table helper
# ==========================================================================
def make_table(header, rows, col_w, body_style="Cell", header_bg=NAVY,
               zebra=True, font_align=None, header_align=None):
    data = [[Paragraph(h, styles["CellH"]) for h in header]]
    for r in rows:
        cells = []
        for c in r:
            if isinstance(c, Flowable):
                cells.append(c)
            else:
                cells.append(Paragraph(str(c), styles[body_style]))
        data.append(cells)
    t = Table(data, colWidths=col_w, repeatRows=1)
    ts = [
        ("BACKGROUND", (0, 0), (-1, 0), header_bg),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LINEBELOW", (0, 0), (-1, 0), 0.8, NAVY),
        ("GRID", (0, 0), (-1, -1), 0.4, LINE),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1),
         [white, LIGHT] if zebra else [white]),
    ]
    t.setStyle(TableStyle(ts))
    return t


def callout(title, body_items, accent=RED, bg=HexColor("#FBEEF0")):
    inner = [Paragraph("<b>%s</b>" % title,
                       ParagraphStyle("ct", parent=styles["Cell"],
                                      textColor=accent, fontSize=9))]
    for b in body_items:
        inner.append(Paragraph(b, styles["Cell"]))
    box_tbl = Table([[i] for i in inner], colWidths=[CONTENT_W - 12])
    box_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), bg),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LINEBEFORE", (0, 0), (0, -1), 3, accent),
        ("BOX", (0, 0), (-1, -1), 0.4, LINE),
    ]))
    return box_tbl


def code_block(text):
    pre = Preformatted(text, styles["Codeblk"])
    tbl = Table([[pre]], colWidths=[CONTENT_W])
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), HexColor("#F2F5F8")),
        ("BOX", (0, 0), (-1, -1), 0.5, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return tbl


# ==========================================================================
# Document template - cover, header/footer, TOC bookmarks
# ==========================================================================
class IngestionDoc(BaseDocTemplate):
    def __init__(self, filename, **kw):
        super().__init__(filename, **kw)
        self._h1 = 0
        self._h2 = 0
        body = Frame(LM, BM, CONTENT_W, PAGE_H - TM - BM, id="body")
        cover = Frame(LM, BM, CONTENT_W, PAGE_H - TM - BM, id="cover")
        self.addPageTemplates([
            PageTemplate(id="cover", frames=[cover], onPage=draw_cover),
            PageTemplate(id="body", frames=[body], onPage=draw_chrome),
        ])

    def beforeDocument(self):
        # Reset per build pass so bookmark keys are deterministic across the
        # multiBuild passes (otherwise the TOC never converges).
        self._h1 = 0
        self._h2 = 0

    def afterFlowable(self, flowable):
        if not isinstance(flowable, Paragraph):
            return
        sn = flowable.style.name
        txt = flowable.getPlainText()
        if sn == "H1":
            self._h1 += 1
            key = "h1-%d" % self._h1
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(txt, key, level=0, closed=False)
            self.notify("TOCEntry", (0, txt, self.page, key))
        elif sn == "H2":
            self._h2 += 1
            key = "h2-%d" % self._h2
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(txt, key, level=1, closed=True)
            self.notify("TOCEntry", (1, txt, self.page, key))


def draw_cover(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(NAVY)
    canvas.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    canvas.setFillColor(NAVY2)
    canvas.rect(0, PAGE_H - 4.4 * cm, PAGE_W, 4.4 * cm, fill=1, stroke=0)
    canvas.setFillColor(RED)
    canvas.rect(0, PAGE_H - 4.55 * cm, PAGE_W, 0.16 * cm, fill=1, stroke=0)

    canvas.setFillColor(white)
    canvas.setFont("Helvetica-Bold", 11)
    canvas.drawString(LM, PAGE_H - 1.7 * cm, "MARTINREA  INTERNATIONAL")
    canvas.setFont("Helvetica", 9.5)
    canvas.setFillColor(HexColor("#CBD8E6"))
    canvas.drawString(LM, PAGE_H - 2.25 * cm, "Finance - Accounts Payable Automation Platform")
    canvas.setFont("Helvetica", 8.5)
    canvas.drawRightString(PAGE_W - RM, PAGE_H - 1.7 * cm, "Delivered by Netlink Software Group America")
    canvas.drawRightString(PAGE_W - RM, PAGE_H - 2.2 * cm, "Phase 1 - Foundation & Paperless")

    # Title block
    canvas.setFillColor(white)
    canvas.setFont("Helvetica-Bold", 30)
    canvas.drawString(LM, PAGE_H - 8.2 * cm, "Ingestion Epic")
    canvas.setFont("Helvetica-Bold", 17)
    canvas.setFillColor(HexColor("#9Fc0e0"))
    canvas.drawString(LM, PAGE_H - 9.4 * cm, "Technical & Process Documentation")
    canvas.setFillColor(RED)
    canvas.rect(LM, PAGE_H - 9.9 * cm, 5.8 * cm, 0.10 * cm, fill=1, stroke=0)

    canvas.setFillColor(HexColor("#D8E2EE"))
    canvas.setFont("Helvetica", 11)
    subtitle = [
        "Three-channel document ingestion - Email (MS Graph), SFTP and Web Portal -",
        "into one validated, deduplicated funnel that feeds the downstream OCR pipeline.",
        "Covers user stories ING-01 through ING-06.",
    ]
    ty = PAGE_H - 11.3 * cm
    for line in subtitle:
        canvas.drawString(LM, ty, line)
        ty -= 0.62 * cm

    # Meta card
    cy = 6.6 * cm
    canvas.setFillColor(HexColor("#1B3D63"))
    canvas.roundRect(LM, cy - 1.0 * cm, CONTENT_W, 3.4 * cm, 8, fill=1, stroke=0)
    meta = [
        ("Document", "Ingestion Epic - Technical Documentation"),
        ("Track / Owner", "Ingestion Epic  -  Ayush (Full-Stack Developer)"),
        ("Version", "%s   (Demo-phase build)" % VERSION),
        ("Date", TODAY),
        ("Classification", "Internal - Project Stakeholders"),
        ("Status", "Released for review"),
    ]
    canvas.setFont("Helvetica", 9.5)
    mx = LM + 0.6 * cm
    myy = cy + 1.9 * cm
    for k, v in meta:
        canvas.setFillColor(HexColor("#8FB4D8"))
        canvas.drawString(mx, myy, k)
        canvas.setFillColor(white)
        canvas.setFont("Helvetica-Bold", 9.5)
        canvas.drawString(mx + 3.3 * cm, myy, v)
        canvas.setFont("Helvetica", 9.5)
        myy -= 0.52 * cm

    canvas.setFillColor(HexColor("#7E97AE"))
    canvas.setFont("Helvetica-Oblique", 7.6)
    canvas.drawString(LM, 1.4 * cm,
                      "Confidential - prepared for internal Martinrea / Netlink project stakeholders. "
                      "Reflects the demo-phase build of the ingestion service.")
    canvas.restoreState()


def draw_chrome(canvas, doc):
    canvas.saveState()
    # Header
    canvas.setFillColor(NAVY)
    canvas.setFont("Helvetica-Bold", 8.4)
    canvas.drawString(LM, PAGE_H - 1.35 * cm, "MARTINREA AP AUTOMATION")
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 8.2)
    canvas.drawRightString(PAGE_W - RM, PAGE_H - 1.35 * cm, "Ingestion Epic - Technical Documentation")
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.6)
    canvas.line(LM, PAGE_H - 1.55 * cm, PAGE_W - RM, PAGE_H - 1.55 * cm)
    # Footer
    canvas.setStrokeColor(LINE)
    canvas.line(LM, BM - 0.45 * cm, PAGE_W - RM, BM - 0.45 * cm)
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 8)
    canvas.drawString(LM, BM - 0.85 * cm, "v%s  -  %s" % (VERSION, TODAY))
    canvas.drawCentredString(PAGE_W / 2, BM - 0.85 * cm, "Internal - Project Stakeholders")
    canvas.drawRightString(PAGE_W - RM, BM - 0.85 * cm, "Page %d" % doc.page)
    canvas.setFillColor(RED)
    canvas.rect(LM, BM - 0.5 * cm, 1.4 * cm, 0.05 * cm, fill=1, stroke=0)
    canvas.restoreState()


def fig(drawing, caption):
    """Center a Drawing in the content frame and add a caption."""
    scale = min(1.0, CONTENT_W / drawing.width)
    drawing.width *= scale
    drawing.height *= scale
    drawing.scale(scale, scale)
    drawing.hAlign = "CENTER"
    return [Spacer(1, 4), drawing, P(caption, "Cap")]


# ==========================================================================
# Build the story
# ==========================================================================
story = []
add = story.append
ext = story.extend


def H1(t):
    ext([Spacer(1, 2), P(t, "H1")])


def H2(t):
    add(P(t, "H2"))


def H3(t):
    add(P(t, "H3"))


# ---- Cover + TOC ----------------------------------------------------------
add(NextPageTemplate("body"))
add(PageBreak())

toc = TableOfContents()
toc.levelStyles = [styles["TOC1"], styles["TOC2"]]
add(P("Table of Contents", "H1"))
add(Spacer(1, 4))
add(toc)
add(PageBreak())

# ---- 1. Executive Summary -------------------------------------------------
H1("1.  Executive Summary")
add(P(
    "The <b>Ingestion Epic</b> is the entry point of the Martinrea Accounts Payable (AP) "
    "Automation Platform. Its mandate is to collect supplier invoices from every channel the "
    "business uses today - vendor e-mail, partner / plant SFTP drops, and direct web-portal "
    "uploads - and funnel them through a single, strictly validated, deduplicated pre-processing "
    "stage before handing each accepted document to the Data &amp; Repository service for storage "
    "and onward OCR extraction.", "Body"))
add(P(
    "The service is built in <b>NestJS (TypeScript)</b> using a clean ports-and-adapters design: "
    "the three channel services and the validation pipeline contain all business logic and depend "
    "only on small interfaces, while interchangeable adapters provide the concrete transports "
    "(filesystem for local/demo, Microsoft Graph / IMAP for e-mail, <i>ssh2-sftp-client</i> for SFTP, "
    "and an HTTP / OCI back-end for storage). A single environment switch, <font face='Courier'>INGESTION_PROFILE</font>, "
    "flips the whole system between a zero-infrastructure <b>local</b> mode and a credentialed "
    "<b>prod</b> mode.", "Body"))
add(callout("At a glance", [
    "<b>Channels:</b> Email (ING-02) &bull; SFTP (ING-03) &bull; Web Portal (ING-04), all converging on one pre-processing funnel (ING-01 / ING-05).",
    "<b>Guarantees:</b> magic-byte type validation, 10&nbsp;MiB size cap, SHA-256 content de-duplication, full quarantine audit trail, and idempotent re-delivery.",
    "<b>Quality gate:</b> end-to-end suite across all three channels (ING-06) runs in CI with enforced coverage thresholds.",
]))
add(P(
    "This document records the technology stack, the architecture, the end-to-end process for each "
    "channel (with flowcharts), the data and API contracts, security model, configuration, "
    "resilience behaviour, testing strategy and deployment approach - everything a reviewer, "
    "operator or future maintainer needs to understand and run the ingestion service.", "Body"))

# ---- 2. Purpose & Scope ---------------------------------------------------
H1("2.  Purpose &amp; Scope")
H2("2.1  Objective")
add(P(
    "Automate the collection of invoices from external sources into a centralized staging area for "
    "downstream OCR processing, eliminating paper-based and manual e-mail handling. Every document "
    "that enters the platform does so through this epic, which makes its validation rules the first "
    "line of data-quality defence for the entire AP system.", "Body"))
H2("2.2  In scope")
add(bullets([
    "A scalable NestJS ingestion back-end with a shared pre-processing &amp; format-validation service.",
    "Automated e-mail ingestion from designated AP mailboxes via Microsoft Graph (production) or IMAP (demo).",
    "Automated SFTP polling of per-plant incoming folders with safe download / delete semantics.",
    "A secured REST portal-upload endpoint for AP clerks (multipart/form-data).",
    "Hand-off of validated documents - with stamped metadata - to the Data &amp; Repository (Blob) service.",
    "Quarantine of every rejected document with a machine-readable reason code for audit.",
    "A health endpoint and an automated end-to-end test suite executed as a CI merge gate.",
]))
H2("2.3  Out of scope (owned by adjacent epics)")
add(bullets([
    "OCR / data extraction and confidence scoring - <b>AI &amp; OCR Epic</b> (Abhay).",
    "Document persistence in Azure Blob, the PostgreSQL schema and the OCR queue trigger - <b>Data &amp; Repository Epic</b> (Roshni).",
    "Identity provider, role definitions and the approval workflow / state machine - <b>Workflow &amp; Approvals Epic</b> (Mohd Aman).",
    "Epicor CMS master-data sync and CFDI / SAT validation - <b>External Integrations Epic</b> (Manav &amp; Eswar).",
]))

# ---- 3. Position in the platform -----------------------------------------
H1("3.  Position in the Platform")
add(P(
    "Ingestion is the upstream-most track. It produces the <font face='Courier'>RECEIVED</font> state "
    "for every invoice and hands off to Roshni's data layer, which in turn triggers OCR. The table "
    "below summarises the immediate integration boundaries.", "Body"))
add(make_table(
    ["Direction", "Counterpart", "Interface / contract"],
    [
        ["Downstream", "Data &amp; Repository (Roshni)",
         "<font face='Courier'>BlobUploadClient.upload()</font> / <font face='Courier'>.quarantine()</font> - de-dup by content hash; triggers OCR queue on insert."],
        ["Downstream", "AI &amp; OCR (Abhay)",
         "Consumes the queue Roshni publishes; ingestion forwards CFDI XML as well as PDFs/images."],
        ["Auth", "Workflow &amp; Approvals (Mohd Aman)",
         "Keycloak realm, role names and JWT claim path consumed by the portal auth guard."],
        ["Metadata", "External Integrations (Manav)",
         "Plant-code stamping on SFTP files supports Epicor attribution."],
        ["Upstream", "Frontend portal (Dhwaj)",
         "Calls <font face='Courier'>POST /api/ingestion/upload</font>; receives a documentId + staging status."],
    ],
    [2.6 * cm, 4.6 * cm, CONTENT_W - 7.2 * cm]))

# ---- 4. Requirements covered ---------------------------------------------
H1("4.  Requirements Covered (User Stories)")
add(P("The epic delivers six user stories. Each is implemented and exercised by the automated suite.", "Body"))
add(make_table(
    ["Story", "Title", "Summary of delivered behaviour"],
    [
        ["ING-01 / 05", "Foundation &amp; Pre-Processing",
         "NestJS service; format + size validation; quarantine of failures; validated hand-off with metadata; <font face='Courier'>GET /ingestion/health</font>."],
        ["ING-02", "Automated Email Ingestion",
         "Scheduled mailbox polling; attachment extraction; folder routing (Processed / No-Attachment / Failed); retry on transient failure; no files written to disk."],
        ["ING-03", "SFTP Ingestion",
         "Scheduled per-plant polling; partial-write grace; download, validate, then delete-on-success; retry vs. quarantine decisioning."],
        ["ING-04", "Web Portal Upload",
         "<font face='Courier'>POST /api/ingestion/upload</font> (multipart); JWT-guarded; mirrors core size/type rules; 201 with documentId + status."],
        ["ING-06", "End-to-End Testing",
         "Integration suite across all three channels (valid / oversized / invalid-type / duplicate); green-red CI gate; coverage artifact archived."],
    ],
    [2.2 * cm, 3.5 * cm, CONTENT_W - 5.7 * cm]))

# ---- 5. Technology stack --------------------------------------------------
H1("5.  Technology Stack")
add(P(
    "The stack aligns with the platform-wide standard (NestJS / TypeScript back-end, Azure cloud, "
    "Keycloak identity, Docker / Kubernetes, GitHub Actions CI). The table groups the libraries "
    "actually used by the ingestion service.", "Body"))
add(make_table(
    ["Layer", "Technology", "Role in the ingestion service"],
    [
        ["Runtime", "Node.js 20 LTS (Alpine container)", "Service host; container base image <font face='Courier'>node:20-alpine</font>."],
        ["Language", "TypeScript 5.7", "Strongly-typed source across services, adapters and tests."],
        ["Framework", "NestJS 10 (common / core / platform-express)", "Dependency injection, module wiring, controllers, providers."],
        ["HTTP", "Express (via platform-express) + Multer", "Portal upload endpoint; multipart parsing with a hard size limit."],
        ["Scheduling", "@nestjs/schedule + cron", "Registers the e-mail and SFTP poll cron jobs."],
        ["Config", "@nestjs/config", "Loads <font face='Courier'>.env</font> and resolves profile / transport selection."],
        ["Validation", "class-validator, class-transformer", "DTO validation + global <font face='Courier'>ValidationPipe</font> (whitelist, transform)."],
        ["Type sniffing", "file-type 16.5.4", "Magic-byte MIME detection (defeats renamed-extension attacks)."],
        ["Hashing", "Node.js crypto (SHA-256)", "Content-hash de-duplication key."],
        ["Email (prod)", "@microsoft/microsoft-graph-client, @azure/identity", "App-only Graph access to M365 AP mailboxes."],
        ["Email (demo)", "imapflow, mailparser", "Dummy Gmail inbox over IMAP for the demo phase."],
        ["SFTP", "ssh2-sftp-client", "Real SFTP transport (connect-per-poll)."],
        ["Auth", "jose (JWKS verify) + Keycloak IdP", "Cryptographic bearer-JWT verification on the portal endpoint."],
        ["Storage hand-off", "Backend HTTP document API / OCI PAR / Azure Blob", "Pluggable <font face='Courier'>BlobUploadClient</font> adapters."],
        ["Reactive utils", "rxjs", "NestJS framework dependency."],
        ["Testing", "Jest, ts-jest, supertest", "Unit + end-to-end channel suite with coverage thresholds."],
        ["Quality", "ESLint, Prettier", "Lint + format gates (run in CI)."],
        ["Build", "Nest CLI / tsc, ts-node", "Compilation and on-demand ops scripts."],
        ["Container / CI", "Docker, GitHub Actions", "Image build; lint -> build -> unit -> e2e pipeline."],
    ],
    [2.6 * cm, 4.9 * cm, CONTENT_W - 7.5 * cm]))
add(callout("Platform target (per PRD)", [
    "Cloud-native deployment on <b>Docker + Kubernetes</b>; secrets in <b>Azure Key Vault</b>; "
    "documents in <b>Azure Blob Storage</b>; identity through <b>Keycloak</b>; "
    "delivery via <b>GitHub Actions + Argo CD</b> across DEV / QA / UAT / PROD.",
], accent=NAVY2, bg=HexColor("#EAF1F8")))

# ---- 6. Solution architecture --------------------------------------------
H1("6.  Solution Architecture")
add(P(
    "The service follows a <b>ports-and-adapters (hexagonal)</b> pattern. Three thin channel "
    "components capture documents and converge on one pre-processing funnel; that funnel depends "
    "only on a small set of interfaces (the <i>ports</i>), and concrete <i>adapters</i> supply the "
    "transports. As a result, the same business logic runs unchanged whether the backing store is "
    "the local filesystem or a cloud API.", "Body"))
ext(fig(diagram_architecture(),
        "Figure 1 - Three-channel ingestion architecture. All channels converge on one validation "
        "funnel; accepted documents flow to storage and OCR, rejections to an audited quarantine."))

H2("6.1  Profiles &amp; transport selection")
add(P(
    "<font face='Courier'>INGESTION_PROFILE</font> sets the defaults; each channel transport can also "
    "be overridden independently so a demo can mix real and local transports (for example a real "
    "Gmail inbox with local file storage). Non-local adapters validate their own credentials at "
    "construction and <b>fail loudly at boot</b> - a misconfigured deployment never silently drops "
    "invoices.", "Body"))
add(make_table(
    ["Injection token", "Env override", "Options (first = local default)"],
    [
        ["<font face='Courier'>MAIL_CLIENT</font>", "<font face='Courier'>MAIL_TRANSPORT</font>",
         "<font face='Courier'>local</font> (FS) &bull; <font face='Courier'>imap</font> (Gmail demo) &bull; <font face='Courier'>graph</font> (M365)"],
        ["<font face='Courier'>SFTP_CLIENT_FACTORY</font>", "<font face='Courier'>SFTP_TRANSPORT</font>",
         "<font face='Courier'>local</font> (FS) &bull; <font face='Courier'>ssh2</font> (real SFTP)"],
        ["<font face='Courier'>BLOB_UPLOAD_CLIENT</font>", "<font face='Courier'>BLOB_TRANSPORT</font>",
         "<font face='Courier'>local</font> (FS) &bull; <font face='Courier'>http</font> (backend doc API) &bull; <font face='Courier'>par</font> (OCI bucket)"],
    ],
    [4.7 * cm, 4.0 * cm, CONTENT_W - 8.7 * cm]))
add(P(
    "The interfaces in <font face='Courier'>src/ingestion/shared/</font> (<font face='Courier'>MailClient</font>, "
    "<font face='Courier'>SftpClient</font>/<font face='Courier'>SftpClientFactory</font>, "
    "<font face='Courier'>BlobUploadClient</font>) are the only contract the channel services know about; "
    "they are protocol-agnostic by design.", "Body"))

H2("6.2  Module composition")
add(bullets([
    "<b>main.ts</b> - bootstraps Nest, enables a global <font face='Courier'>ValidationPipe</font> and env-driven CORS, and listens on <font face='Courier'>PORT</font> (default 3002).",
    "<b>IngestionModule</b> - profile-aware factory providers wire each port to its local or prod adapter and log the chosen implementation at boot.",
    "<b>PreProcessingService</b> - the single validation funnel shared by all channels.",
    "<b>EmailIngestionService / SftpIngestionService</b> - schedule-driven pollers.",
    "<b>PortalIngestionController / HealthController</b> - the two HTTP surfaces.",
    "<b>KeycloakAuthGuard</b> - bearer-JWT guard protecting the portal endpoint.",
]))

# ---- 7. Pre-processing pipeline ------------------------------------------
H1("7.  Pre-Processing Pipeline (ING-01 / ING-05)")
add(P(
    "Every channel ends by calling <font face='Courier'>PreProcessingService.validateAndHandoff(buffer, meta)</font>. "
    "This is the <b>only</b> place validation lives, which keeps the rules consistent across all "
    "three entry points. The pipeline is intentionally fail-fast and audit-complete.", "Body"))
ext(fig(diagram_funnel(),
        "Figure 2 - Pre-processing validation funnel. Each gate that rejects a document ships the "
        "bytes to quarantine with a reason code before raising a typed error."))

H2("7.1  Validation steps")
add(make_table(
    ["#", "Step", "Behaviour on failure"],
    [
        ["1", "Empty-buffer check", "<font face='Courier'>EmptyFileError</font> - HTTP 400; quarantined as <font face='Courier'>EMPTY_FILE</font>."],
        ["2", "Size check vs. <font face='Courier'>MAX_FILE_BYTES</font> (10&nbsp;MiB)", "<font face='Courier'>FileTooLargeError</font> - HTTP 413; quarantined as <font face='Courier'>FILE_TOO_LARGE</font>."],
        ["3", "Magic-byte MIME sniff vs. allow-list", "<font face='Courier'>InvalidFileTypeError</font> - HTTP 415; quarantined as <font face='Courier'>INVALID_TYPE</font>. Catches renamed binaries (e.g. <font face='Courier'>evil.exe</font> &rarr; <font face='Courier'>invoice.pdf</font>)."],
        ["4", "SHA-256 content hash", "Computed as the de-duplication key."],
        ["5", "Metadata stamping", "Builds the <font face='Courier'>IngestionMetadata</font> record."],
        ["6", "Blob hand-off", "<font face='Courier'>upload()</font>; if <font face='Courier'>isDuplicate</font> the source is still acked but OCR is skipped."],
    ],
    [0.8 * cm, 6.0 * cm, CONTENT_W - 6.8 * cm]))
add(P(
    "Type detection reads <i>magic bytes</i>, never the client-supplied extension. A small fallback "
    "recognises XML / CFDI payloads (which the sniffer does not always detect for tiny files) so "
    "Mexican <font face='Courier'>Comprobante</font> XML invoices are accepted rather than quarantined.", "Body"))

H2("7.2  Accepted formats &amp; limits")
add(make_table(
    ["Policy", "Value", "Notes"],
    [
        ["Allowed MIME types", "PDF, JPEG, PNG, TIFF, XML",
         "PRD baseline (PDF/JPG/PNG/TIF) plus <font face='Courier'>application/xml</font> &amp; <font face='Courier'>text/xml</font> for CFDI."],
        ["Maximum file size", "10&nbsp;MiB (10,485,760 bytes)",
         "Enforced at Multer level (portal) and again in the funnel (all channels)."],
        ["De-duplication", "SHA-256 of file content",
         "Identical bytes from any channel are treated as a successful no-op."],
        ["Quarantine reasons", "EMPTY_FILE, FILE_TOO_LARGE, INVALID_TYPE, UNREADABLE",
         "Stored alongside the rejected bytes for QA / ops inspection."],
    ],
    [3.6 * cm, 3.8 * cm, CONTENT_W - 7.4 * cm]))
add(callout("Design rule", [
    "Quarantine is <b>best-effort and never throws</b> - a failure to quarantine is logged but does "
    "not mask the original validation error. Validation is centralised: no channel duplicates "
    "type or size checks.",
], accent=AMBER, bg=HexColor("#FEF6E7")))

# ---- 8. Email channel -----------------------------------------------------
H1("8.  Channel: Automated Email (ING-02)")
add(P(
    "<font face='Courier'>EmailIngestionService</font> polls one or more AP mailboxes on a cron "
    "schedule (<font face='Courier'>EMAIL_POLL_CRON</font>, default every 2 minutes). For each unread "
    "message it streams every attachment buffer through the pre-processing funnel and then routes the "
    "message to a result folder. In production it authenticates to Microsoft 365 through Graph using "
    "the OAuth 2.0 client-credentials (app-only) flow; in the demo phase it reads a dummy Gmail inbox "
    "over IMAP. Attachment buffers are passed directly downstream - <b>no file is ever written to "
    "local disk</b>.", "Body"))
ext(fig(diagram_email(),
        "Figure 3 - E-mail polling and folder-routing flow. A message is only marked read and moved "
        "once its attachments have been processed."))
H2("8.1  Folder routing &amp; resilience")
add(make_table(
    ["Outcome", "Destination folder", "Rationale"],
    [
        ["&ge;1 attachment ingested", "<font face='Courier'>AP-Processed</font>", "Message acknowledged; marked read."],
        ["No attachments at all", "<font face='Courier'>AP-No-Attachment</font>", "Surfaced for human review (vendor terms may be in the body)."],
        ["All attachments rejected", "<font face='Courier'>AP-Failed</font>", "Bytes already quarantined by pre-processing."],
    ],
    [4.6 * cm, 4.4 * cm, CONTENT_W - 9.0 * cm]))
add(bullets([
    "<b>Fetch failure</b> (network / auth) is logged and the tick is abandoned; the next cron tick retries because the messages are still unread - nothing is lost.",
    "<b>Folder move</b> retries up to 3 times with exponential back-off; if it still fails the message stays unread for the next poll.",
    "<b>Idempotency:</b> re-polling the same message produces no duplicates because the content hash is de-duplicated downstream.",
]))

# ---- 9. SFTP channel ------------------------------------------------------
H1("9.  Channel: SFTP File Drop (ING-03)")
add(P(
    "<font face='Courier'>SftpIngestionService</font> polls each configured incoming path "
    "(<font face='Courier'>SFTP_INCOMING_PATHS</font>, one folder per plant) on the "
    "<font face='Courier'>SFTP_POLL_CRON</font> schedule. A fresh connection is opened per poll - "
    "long-lived SSH sessions die silently behind corporate firewalls - and is always torn down in a "
    "<font face='Courier'>finally</font> block.", "Body"))
ext(fig(diagram_sftp(),
        "Figure 4 - SFTP poll flow with partial-write grace, bandwidth guard and the "
        "success / permanent-reject / transient-error outcome split."))
H2("9.1  Guards &amp; outcome decisioning")
add(make_table(
    ["Mechanism", "Default", "Purpose"],
    [
        ["Partial-write grace", "30,000&nbsp;ms", "Skip files modified within the window - the scanner / partner may still be writing."],
        ["Bandwidth hard ceiling", "50&nbsp;MiB", "Skip (without downloading) pathologically large files; ~5&times; the 10&nbsp;MiB policy so genuine oversize invoices are still audited."],
        ["Plant-code inference", "folder name", "<font face='Courier'>/incoming/welland/</font> &rarr; <font face='Courier'>WELLAND</font> metadata for Epicor attribution."],
    ],
    [4.2 * cm, 2.8 * cm, CONTENT_W - 7.0 * cm]))
add(make_table(
    ["Result of validateAndHandoff()", "Action on SFTP source"],
    [
        ["Success", "Delete from the server (prevents re-ingestion)."],
        ["Permanent rejection (typed <font face='Courier'>IngestionError</font>)", "Already quarantined - delete from the server so the same bytes are not re-quarantined every poll."],
        ["Transient failure (e.g. blob backend down)", "Leave in place; the next poll retries."],
    ],
    [6.4 * cm, CONTENT_W - 6.4 * cm]))

# ---- 10. Portal channel ---------------------------------------------------
H1("10.  Channel: Web Portal Upload (ING-04)")
add(P(
    "<font face='Courier'>PortalIngestionController</font> exposes "
    "<font face='Courier'>POST /api/ingestion/upload</font> accepting "
    "<font face='Courier'>multipart/form-data</font> (field <font face='Courier'>file</font>, plus "
    "optional <font face='Courier'>vendorHint</font> and <font face='Courier'>notes</font>). The "
    "endpoint is synchronous: it validates, hands off, and returns immediately with a "
    "<font face='Courier'>documentId</font> so the frontend can confirm the upload - it does not block "
    "on OCR, which runs asynchronously after Roshni's queue trigger.", "Body"))
add(bullets([
    "Protected by <font face='Courier'>KeycloakAuthGuard</font> - a valid bearer JWT is required (<font face='Courier'>AP_Clerk</font> or higher).",
    "Multer enforces the size cap <i>before</i> the handler runs; the pre-processing funnel re-checks at runtime (belt-and-braces) - both limits read the same <font face='Courier'>MAX_FILE_BYTES</font>.",
    "The same validation funnel and de-dup as the other channels; a duplicate returns status <font face='Courier'>DUPLICATE</font> rather than creating a second record.",
    "Captures the authenticated user (id / email) as source metadata for audit.",
]))
add(P("<b>Success response</b> (HTTP 201):", "BodyL"))
add(code_block(
    '{\n'
    '  "success": true,\n'
    '  "data": {\n'
    '    "documentId": "87c03cd8-1a9a-4eae-9f91-c4835820054d",\n'
    '    "status": "STAGED",            // or "DUPLICATE"\n'
    '    "estimatedOcrTimeSec": 120\n'
    '  }\n'
    '}'))

# ---- 11. Data contract ----------------------------------------------------
H1("11.  Metadata &amp; Data Contract")
add(P(
    "Every accepted document is stamped with a sanitised <font face='Courier'>IngestionMetadata</font> "
    "record before it leaves the epic. This is the contract consumed by the Data &amp; Repository "
    "service.", "Body"))
add(make_table(
    ["Field", "Type", "Description"],
    [
        ["sourceChannel", "'email' | 'sftp' | 'portal'", "Channel the document arrived through."],
        ["originalName", "string", "Original filename as received."],
        ["mimeType", "string", "MIME detected from magic bytes."],
        ["sizeBytes", "number", "Validated byte length."],
        ["contentHash", "string", "SHA-256 hex digest - the de-duplication key."],
        ["ingestedAt", "string (ISO-8601)", "Timestamp the document was accepted."],
        ["sourceMeta", "object", "Channel-specific context (mailbox / message id, remote path / plant code, uploader id, vendor hint, etc.)."],
    ],
    [3.0 * cm, 3.7 * cm, CONTENT_W - 6.7 * cm], body_style="Cell"))
add(P(
    "The blob client returns an <font face='Courier'>UploadResult</font> "
    "(<font face='Courier'>documentId</font>, <font face='Courier'>blobPath</font>, "
    "<font face='Courier'>isDuplicate</font>). When <font face='Courier'>isDuplicate</font> is true, "
    "the ingestion service treats it as a successful no-op and skips the OCR hand-off.", "Body"))

# ---- 12. API reference ----------------------------------------------------
H1("12.  API Reference")
add(make_table(
    ["Method &amp; path", "Auth", "Request", "Success"],
    [
        ["<font face='Courier'>GET /ingestion/health</font>", "None", "-",
         "200 <font face='Courier'>{ status:'ok', service, uptimeSec, time }</font>"],
        ["<font face='Courier'>POST /api/ingestion/upload</font>", "Bearer JWT",
         "<font face='Courier'>multipart/form-data</font>: <font face='Courier'>file</font>, <font face='Courier'>vendorHint?</font>, <font face='Courier'>notes?</font>",
         "201 <font face='Courier'>{ success, data:{ documentId, status, estimatedOcrTimeSec } }</font>"],
    ],
    [4.8 * cm, 1.8 * cm, 4.6 * cm, CONTENT_W - 11.2 * cm], body_style="Cell"))
add(P(
    "The e-mail and SFTP channels have <b>no HTTP trigger</b> - they run purely on "
    "<font face='Courier'>@nestjs/schedule</font> cron jobs. Operators can force a single poll on demand "
    "via the <font face='Courier'>poll:email</font> / <font face='Courier'>poll:sftp</font> scripts.", "Body"))
add(make_table(
    ["Error", "HTTP", "Code"],
    [
        ["Empty file", "400", "<font face='Courier'>EMPTY_FILE</font>"],
        ["File too large", "413", "<font face='Courier'>FILE_TOO_LARGE</font>"],
        ["Unsupported / renamed type", "415", "<font face='Courier'>INVALID_FILE_TYPE</font>"],
        ["Missing / invalid bearer token", "401", "<font face='Courier'>Unauthorized</font>"],
    ],
    [6.8 * cm, 2.0 * cm, CONTENT_W - 8.8 * cm], body_style="Cell"))

# ---- 13. Security ---------------------------------------------------------
H1("13.  Security &amp; Access Control")
add(P(
    "The portal endpoint is protected by <font face='Courier'>KeycloakAuthGuard</font>, which supports "
    "three modes selected by <font face='Courier'>INGESTION_AUTH_MODE</font> (falling back to "
    "<font face='Courier'>INGESTION_PROFILE</font>). The guard always <b>fails closed</b> in production: "
    "a missing or invalid token - or missing configuration - returns 401.", "Body"))
add(make_table(
    ["Mode", "Verification", "When used"],
    [
        ["<font face='Courier'>local</font>", "Dev bypass - any bearer accepted; injects a dev <font face='Courier'>AP_Clerk</font> (role overridable via <font face='Courier'>X-Dev-Role</font>).", "Local dev, demos, the E2E suite."],
        ["<font face='Courier'>jwt</font>", "Verifies an HS256 token signed with the shared <font face='Courier'>JWT_SECRET</font> issued by the workflow service.", "Integrated stack without Keycloak."],
        ["<font face='Courier'>keycloak</font>", "Cryptographically verifies the JWT against the Keycloak JWKS (issuer + audience) and maps the role claim.", "Production identity."],
    ],
    [2.4 * cm, CONTENT_W - 6.4 * cm, 4.0 * cm], body_style="Cell"))
add(P(
    "Recognised roles are <font face='Courier'>AP_Clerk</font>, <font face='Courier'>Plant_Manager</font>, "
    "<font face='Courier'>Finance_Director</font> and <font face='Courier'>Admin</font>; the upload "
    "endpoint requires <font face='Courier'>AP_Clerk</font> as a minimum. Broader platform controls "
    "(TLS 1.2+ in transit, AES-256 at rest, 8-hour token expiry, AP-malware scanning via Defender for "
    "Storage post-upload) are inherited from the platform NFRs.", "Body"))

# ---- 14. Configuration ----------------------------------------------------
H1("14.  Configuration Reference")
add(P("Key environment variables (full list with comments in <font face='Courier'>.env.example</font>):", "Body"))
add(make_table(
    ["Variable", "Default", "Purpose"],
    [
        ["INGESTION_PROFILE", "local", "Master switch: local (FS adapters) vs. prod (real adapters)."],
        ["MAIL_TRANSPORT / BLOB_TRANSPORT / SFTP_TRANSPORT", "(profile)", "Per-channel transport overrides."],
        ["MAX_FILE_BYTES", "10485760", "Hard size cap (Multer + funnel)."],
        ["ALLOWED_MIME_TYPES", "PDF,JPEG,PNG,TIFF,XML", "Comma-separated MIME allow-list (matched against magic bytes)."],
        ["EMAIL_POLL_CRON / SFTP_POLL_CRON", "0 */2 * * * *", "Poll schedules (6-field cron, second granularity)."],
        ["MAIL_AP_MAILBOXES", "ap-canada@martinrea.com", "Comma-separated mailboxes to poll."],
        ["IMAP_HOST / PORT / USER / PASSWORD", "imap.gmail.com / 993", "IMAP demo inbox credentials (Gmail app password)."],
        ["GRAPH_TENANT_ID / CLIENT_ID / CLIENT_SECRET", "-", "Microsoft Graph app-only credentials (prod e-mail)."],
        ["SFTP_HOST / PORT / USERNAME / PRIVATE_KEY", "- / 22", "Real SFTP connection (key sourced from Key Vault in prod)."],
        ["SFTP_INCOMING_PATHS", "/incoming/welland,/incoming/saltillo", "Remote folders, one per plant."],
        ["SFTP_PARTIAL_WRITE_GRACE_MS", "30000", "Skip-window for files still being written."],
        ["SFTP_HARD_CEILING_BYTES", "52428800", "Bandwidth guard ceiling (50 MiB)."],
        ["BLOB_API_BASE_URL / BLOB_API_AUTH_TOKEN", "-", "Backend document HTTP API (BLOB_TRANSPORT=http)."],
        ["KEYCLOAK_ISSUER_URL / JWKS_URL / AUDIENCE / ROLE_CLAIM_PATH", "-", "Keycloak JWT verification settings."],
        ["PORT / CORS_ORIGINS", "3002 / localhost:3000", "HTTP listen port and allowed browser origins."],
    ],
    [5.4 * cm, 3.1 * cm, CONTENT_W - 8.5 * cm], body_style="Cell"))

# ---- 15. Resilience -------------------------------------------------------
H1("15.  Resilience, Idempotency &amp; Error Handling")
add(bullets([
    "<b>Idempotent by content hash:</b> the same invoice arriving twice (re-poll, re-send, or via two channels) is de-duplicated downstream and surfaces as a no-op / <font face='Courier'>DUPLICATE</font>.",
    "<b>Transient vs. permanent failures:</b> permanent rejections (type / size / empty) are quarantined and the source is cleaned up; transient failures (backend down, network blip) leave the source in place for the next poll to retry.",
    "<b>Bounded retries:</b> e-mail folder moves retry 3&times; with exponential back-off; the platform standard is retry-with-back-off for all external calls.",
    "<b>Fail-closed boot:</b> prod adapters validate credentials at construction and abort start-up if misconfigured, so invoices are never silently dropped.",
    "<b>Connect-per-poll SFTP:</b> avoids dead long-lived sessions behind firewalls; disconnect always runs in <font face='Courier'>finally</font>.",
    "<b>Typed errors:</b> <font face='Courier'>IngestionError</font> carries an HTTP status, a machine code and a quarantine reason for consistent handling and audit.",
]))

# ---- 16. Testing ----------------------------------------------------------
H1("16.  Testing &amp; Quality Gates (ING-06)")
add(P(
    "Quality is enforced automatically. Unit tests cover the services and the auth guard; the "
    "end-to-end suite boots the real <font face='Courier'>IngestionModule</font> under the local "
    "profile against throwaway temp directories and exercises every channel with the four "
    "ING-06 cases - valid, oversized, invalid-type and duplicate - plus health and auth checks.", "Body"))
add(make_table(
    ["Channel", "E2E cases covered"],
    [
        ["Email (ING-02)", "Valid &rarr; AP-Processed; no-attachment &rarr; AP-No-Attachment; bad type &rarr; quarantine + AP-Failed; duplicate idempotency."],
        ["SFTP (ING-03)", "Valid (download + delete); oversized &rarr; quarantine; bad type &rarr; quarantine; duplicate no-op; CFDI XML accepted."],
        ["Portal (ING-04)", "201 valid; 413 oversized; 415 + quarantine bad type; DUPLICATE on resend; 400 no file; 401 no token; PNG accepted."],
    ],
    [3.0 * cm, CONTENT_W - 3.0 * cm], body_style="Cell"))
add(P(
    "<b>Coverage gate:</b> the Jest config enforces 70% branches and 80% lines / functions / "
    "statements across <font face='Courier'>src/**</font> (network-bound prod adapters are excluded - "
    "they are integration-tested against live infrastructure). The CI pipeline runs on every push "
    "and pull request to <font face='Courier'>main</font>:", "Body"))
add(make_table(
    ["Stage", "Command", "Gate"],
    [
        ["Lint", "<font face='Courier'>npm run lint</font>", "ESLint - no errors."],
        ["Build", "<font face='Courier'>npm run build</font>", "TypeScript compiles."],
        ["Unit + coverage", "<font face='Courier'>npm run test:cov</font>", "Thresholds enforced."],
        ["End-to-end", "<font face='Courier'>npm run test:e2e</font>", "All channel cases pass."],
        ["Artifact", "upload <font face='Courier'>coverage/</font>", "Report archived (14-day retention)."],
    ],
    [3.4 * cm, 5.2 * cm, CONTENT_W - 8.6 * cm], body_style="Cell"))

# ---- 17. Deployment -------------------------------------------------------
H1("17.  Deployment &amp; Runtime")
add(bullets([
    "<b>Container:</b> multi-step <font face='Courier'>node:20-alpine</font> image - install, copy, <font face='Courier'>npm run build</font>, expose 3002, run <font face='Courier'>node dist/main.js</font>.",
    "<b>Local / demo:</b> <font face='Courier'>npm run start:dev</font> boots in local profile with zero external infrastructure; <font face='Courier'>seed:local</font> + <font face='Courier'>poll:email</font> / <font face='Courier'>poll:sftp</font> exercise the full pipeline.",
    "<b>Production:</b> set <font face='Courier'>INGESTION_PROFILE=prod</font>, supply credentials, <font face='Courier'>npm run build</font> then <font face='Courier'>start:prod</font>; orchestrated under Kubernetes with secrets from Azure Key Vault.",
    "<b>Port map:</b> ingestion 3002, workflow 3001, integrations 3003, frontend 3000 - so all services coexist locally.",
]))
add(P(
    "On boot the module logs the resolved adapter for each port (e.g. "
    "<font face='Courier'>MAIL_CLIENT -&gt; GraphMailClient</font>) and registers the cron jobs, giving "
    "operators an immediate, unambiguous record of the active configuration.", "Body"))

# ---- 18. NFR --------------------------------------------------------------
H1("18.  Non-Functional Requirements")
add(make_table(
    ["Category", "Target relevant to ingestion"],
    [
        ["Throughput", "Sized for ~450,000 documents/year (~1,233/day peak); horizontally scalable poller / API."],
        ["Performance", "Portal upload returns synchronously; OCR runs async (est. ~120 s) so the UI is never blocked."],
        ["Security", "TLS 1.2+ in transit, AES-256 at rest, JWT on the portal endpoint, secrets in Key Vault."],
        ["Reliability", "Retry-with-back-off on external calls; idempotent re-delivery; fail-closed boot."],
        ["Compliance", "Every rejection quarantined with a reason; CFDI XML accepted for SAT-bound flows; 7-year retention (platform)."],
        ["Observability", "Structured boot + per-document logs; services report to Datadog at platform level."],
    ],
    [3.2 * cm, CONTENT_W - 3.2 * cm], body_style="Cell"))

# ---- 19. Dependencies -----------------------------------------------------
H1("19.  Dependencies &amp; Open Items")
add(P(
    "The local build runs fully without any of the items below; they are the inputs required to "
    "flip individual channels to production. Resolved product decisions (12 Jun 2026) are already "
    "baked into the build.", "Body"))
add(make_table(
    ["Source", "Outstanding input"],
    [
        ["Data &amp; Repository (Roshni)", "Final REST contract for blob upload / quarantine, service-to-service auth model, metadata schema confirmation, OCR-queue trigger ownership."],
        ["IT / DevOps", "Azure AD tenant + Graph app registration, real SFTP host + service key, Key Vault URLs, DEV/QA/UAT/PROD environments and CI/CD wiring."],
        ["Workflow (Mohd Aman)", "Keycloak realm / client config, confirmed role names and JWT claim path."],
        ["AI &amp; OCR (Abhay)", "Confirmation that the OCR consumer reads Roshni's queue; CFDI XML handling expectation."],
        ["QA (Jack H.)", "Representative anonymised test-data set; load-test target; negative-path contracts."],
    ],
    [4.0 * cm, CONTENT_W - 4.0 * cm], body_style="Cell"))
add(callout("Resolved decisions (frozen)", [
    "File-size cap stays at <b>10&nbsp;MiB</b>; allowed types <b>PDF / JPG / PNG / TIF + XML</b> only; "
    "poll interval <b>every 2 minutes</b>; cross-channel duplicates use <b>silent de-dup</b>.",
], accent=GREEN, bg=HexColor("#E9F5EE")))

# ---- 20. Traceability -----------------------------------------------------
H1("20.  Requirements Traceability Matrix")
add(make_table(
    ["Story", "Acceptance theme", "Implementing component", "Verified by"],
    [
        ["ING-01/05", "Validation, quarantine, health", "PreProcessingService, HealthController", "Unit + E2E"],
        ["ING-02", "Email poll, folder routing, no-disk", "EmailIngestionService, Mail adapters", "Unit + E2E"],
        ["ING-03", "SFTP poll, delete-on-success, retry", "SftpIngestionService, SFTP adapters", "Unit + E2E"],
        ["ING-04", "Portal upload, JWT, 201 + id", "PortalIngestionController, KeycloakAuthGuard", "Unit + E2E"],
        ["ING-06", "All-channel suite, CI gate, artifact", "test/e2e + GitHub Actions", "CI pipeline"],
    ],
    [1.9 * cm, 4.2 * cm, 4.8 * cm, CONTENT_W - 10.9 * cm], body_style="Cell"))

# ---- 21. Glossary ---------------------------------------------------------
H1("21.  Glossary")
add(make_table(
    ["Term", "Meaning"],
    [
        ["Adapter / Port", "Concrete transport implementation / the interface it satisfies (hexagonal architecture)."],
        ["CFDI", "Comprobante Fiscal Digital por Internet - Mexico's SAT-regulated electronic-invoice XML."],
        ["Magic bytes", "Leading bytes of a file used to detect its true type, independent of the filename extension."],
        ["Quarantine", "Isolated store for rejected documents, kept with a reason code as an audit record."],
        ["Idempotency", "Re-processing identical content has no additional effect (here, via SHA-256 de-dup)."],
        ["Profile", "<font face='Courier'>local</font> vs. <font face='Courier'>prod</font> adapter selection driven by <font face='Courier'>INGESTION_PROFILE</font>."],
        ["JWKS", "JSON Web Key Set - the public keys used to verify Keycloak-issued JWTs."],
    ],
    [3.4 * cm, CONTENT_W - 3.4 * cm], body_style="Cell"))

# ---- Appendix -------------------------------------------------------------
H1("Appendix A.  Repository Structure")
add(code_block(
    "src/\n"
    "  main.ts                         Bootstrap (ValidationPipe, CORS, port)\n"
    "  app.module.ts                   Root module\n"
    "  ingestion/\n"
    "    ingestion.module.ts           Profile-aware adapter wiring (local | prod)\n"
    "    pre-processing/               Validation / hashing / dispatch funnel\n"
    "    email/                        ING-02 automated e-mail poller\n"
    "    sftp/                         ING-03 automated SFTP poller\n"
    "    portal/                       ING-04 portal upload endpoint + DTO\n"
    "    health/                       GET /ingestion/health\n"
    "    auth/                         Keycloak bearer-JWT guard\n"
    "    shared/                       Interfaces (ports): mail / sftp / blob, types, errors\n"
    "    adapters/\n"
    "      local/                      Filesystem transports (zero-infra)\n"
    "      prod/                       Graph / IMAP / ssh2 / HTTP / OCI adapters\n"
    "scripts/                          seed-local-fixtures, poll-email-once, poll-sftp-once\n"
    "test/                             fixtures + e2e/ingestion.e2e-spec.ts (ING-06)\n"
    ".github/workflows/ci.yml          lint -> build -> unit(+coverage) -> e2e gate\n"
    "Dockerfile                        node:20-alpine runtime image"))
add(Spacer(1, 8))
add(P(
    "<i>End of document. Prepared from the demo-phase ingestion-service source and the Phase 1 "
    "Product Requirements Document.</i>", "Small"))

# ==========================================================================
# Render (multiBuild for TOC page numbers + bookmarks)
# ==========================================================================
OUT = "Ingestion_Epic_Documentation.pdf"
doc = IngestionDoc(OUT, pagesize=A4,
                   leftMargin=LM, rightMargin=RM, topMargin=TM, bottomMargin=BM,
                   title="Ingestion Epic - Technical Documentation",
                   author="Ingestion Epic (Ayush)",
                   subject="Martinrea AP Automation - Phase 1")
doc.multiBuild(story)
print("WROTE", OUT)

