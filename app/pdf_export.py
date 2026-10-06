"""Vector PDF exports from authorized snapshots, with no HTML/SVG or remote resources."""

import json
import math
import unicodedata
from collections import deque
from io import BytesIO
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, A3, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    PageBreak,
    LongTable,
    TableStyle,
    Flowable,
)

FONT = "DatabaseDoc"
BOLD = "DatabaseDocBold"
pdfmetrics.registerFont(TTFont(FONT, "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"))
pdfmetrics.registerFont(
    TTFont(BOLD, "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")
)
pdfmetrics.registerFontFamily(
    FONT, normal=FONT, bold=BOLD, italic=FONT, boldItalic=BOLD
)
GREEN = colors.HexColor("#224f42")
INK = colors.HexColor("#263d36")
MUTED = colors.HexColor("#6b7d73")
PALE = colors.HexColor("#edf3ec")
LINE = colors.HexColor("#d9e3d7")
STYLES = {
    "title": ParagraphStyle(
        "title",
        fontName=BOLD,
        fontSize=22,
        leading=28,
        textColor=GREEN,
        spaceAfter=14,
        splitLongWords=True,
    ),
    "h1": ParagraphStyle(
        "h1",
        fontName=BOLD,
        fontSize=16,
        leading=21,
        textColor=GREEN,
        spaceAfter=10,
        keepWithNext=True,
    ),
    "h2": ParagraphStyle(
        "h2",
        fontName=BOLD,
        fontSize=10,
        leading=14,
        textColor=GREEN,
        spaceBefore=14,
        spaceAfter=7,
        keepWithNext=True,
    ),
    "body": ParagraphStyle(
        "body",
        fontName=FONT,
        fontSize=9,
        leading=13,
        textColor=INK,
        spaceAfter=8,
        splitLongWords=True,
    ),
    "cell": ParagraphStyle(
        "cell",
        fontName=FONT,
        fontSize=8,
        leading=11,
        textColor=INK,
        splitLongWords=True,
    ),
    "header": ParagraphStyle(
        "header",
        fontName=BOLD,
        fontSize=8,
        leading=11,
        textColor=GREEN,
        splitLongWords=True,
    ),
    "small": ParagraphStyle(
        "small",
        fontName=FONT,
        fontSize=8,
        leading=11,
        textColor=MUTED,
        spaceAfter=6,
        splitLongWords=True,
    ),
}


def text(value):
    if value is None:
        return "—"
    if isinstance(value, (dict, list)):
        value = json.dumps(value, ensure_ascii=False, indent=2, default=str)
    value = str(value).replace("\r\n", "\n").replace("\r", "\n").replace("\t", "    ")
    return "".join(
        c for c in value if c == "\n" or unicodedata.category(c) not in {"Cc", "Cs"}
    )


def para(value, style="body"):
    # ReportLab Paragraph understands markup; every database/user string is literal text.
    return Paragraph(escape(text(value)).replace("\n", "<br/>"), STYLES[style])


def full_name(table):
    return ".".join(filter(None, [table.get("schema"), table["name"]]))


class ExportDocument(SimpleDocTemplate):
    def afterFlowable(self, flowable):
        if getattr(flowable, "bookmark", None):
            key, title = flowable.bookmark
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(text(title), key, level=0, closed=False)


def heading(value, bookmark):
    item = para(value, "h1")
    item.bookmark = (bookmark, value)
    return item


def document(buffer, payload, page_size, title):
    return ExportDocument(
        buffer,
        pagesize=page_size,
        leftMargin=36,
        rightMargin=36,
        topMargin=54,
        bottomMargin=42,
        title=text(title),
        author="DatabaseDoc",
        pageCompression=1,
    )


def footer(payload, page_size):
    width, height = page_size

    def draw(canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(LINE)
        canvas.line(36, height - 33, width - 36, height - 33)
        canvas.setFont(BOLD, 9)
        canvas.setFillColor(GREEN)
        canvas.drawString(36, height - 25, "DatabaseDoc · Datenbankdokumentation")
        canvas.setFont(FONT, 8)
        canvas.setFillColor(MUTED)
        canvas.drawString(
            36, 24, f'Schema-Stand #{payload["snapshot_id"]} · {payload["created"]}'
        )
        canvas.drawRightString(width - 36, 24, f"Seite {canvas.getPageNumber()}")
        canvas.restoreState()

    return draw


def grid(headers, rows, widths):
    data = [[para(h, "header") for h in headers]] + [
        [para(v, "cell") for v in row] for row in rows
    ]
    table = LongTable(
        data,
        colWidths=widths,
        repeatRows=1,
        splitByRow=1,
        splitInRow=1,
        hAlign="LEFT",
        spaceAfter=10,
    )
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), PALE),
                (
                    "ROWBACKGROUNDS",
                    (0, 1),
                    (-1, -1),
                    [colors.white, colors.HexColor("#f7f9f6")],
                ),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
                ("LINEBELOW", (0, 0), (-1, 0), 0.7, LINE),
                ("LINEBELOW", (0, 1), (-1, -1), 0.3, LINE),
            ]
        )
    )
    return table


def tables_pdf(payload, tables):
    buffer = BytesIO()
    size = landscape(A4)
    width = size[0] - 72
    source = payload["source"]
    doc = document(buffer, payload, size, f'{source["name"]} · Tabellendokumentation')
    story = [
        para("Tabellendokumentation", "title"),
        para(source["name"], "h1"),
        para(f'Typ: {source["kind"]} · Schema-Stand: {payload["created"]}'),
        para(
            f'Tags: {", ".join(source.get("tags", [])) or "—"}\nVerantwortlich: {source.get("owner") or "—"}\nKontakt: {source.get("owner_email") or "—"}'
        ),
        para(
            f"{len(tables)} dokumentierte Objekte · Gespeicherte Metadaten und aktuelle Dokumentationsnotizen. Keine Datenzeilen oder Zugangsdaten.",
            "small",
        ),
    ]
    for warning in payload["schema"].get("warnings", []):
        story.append(para(warning, "small"))
    if tables:
        story += [
            para("Objektübersicht", "h2"),
            grid(
                ["Objekt", "Typ", "Spalten", "Fremdschlüssel"],
                [
                    [
                        full_name(t),
                        t["kind"],
                        len(t["columns"]),
                        len(t.get("foreign_keys", [])),
                    ]
                    for t in tables
                ],
                [width * 0.60, width * 0.16, width * 0.12, width * 0.12],
            ),
        ]
    else:
        story.append(
            para("Keine zugänglichen Objekte im gespeicherten Schema gefunden.")
        )
    for index, table in enumerate(tables):
        story += [
            PageBreak(),
            heading(full_name(table), f"table-{index}"),
            para(
                f'Objekttyp: {table["kind"]} · {len(table["columns"])} Spalten / Felder',
                "small",
            ),
        ]
        if table.get("comment"):
            story += [para("Datenbankkommentar", "h2"), para(table["comment"])]
        if payload["notes"].get(table["key"]):
            story += [para("Dokumentation", "h2"), para(payload["notes"][table["key"]])]
        if "sampled_documents" in table:
            story.append(
                para(
                    f'Feldableitung aus {table["sampled_documents"]} MongoDB-Dokumenten; Stichproben können seltene Felder übersehen.',
                    "small",
                )
            )
        foreign_columns = {
            c for fk in table.get("foreign_keys", []) for c in fk.get("columns", [])
        }
        story.append(para("Spalten & Felder", "h2"))
        if table["columns"]:
            rows = [
                [
                    c["name"],
                    c["type"],
                    "Ja" if c.get("nullable") else "Nein",
                    ", ".join(
                        label
                        for flag, label in [
                            (c.get("primary_key"), "PK"),
                            (c["name"] in foreign_columns, "FK"),
                        ]
                        if flag
                    )
                    or "—",
                    c.get("default"),
                    c.get("comment") or "—",
                ]
                for c in table["columns"]
            ]
            story.append(
                grid(
                    [
                        "Spalte / Feld",
                        "Datentyp",
                        "NULL",
                        "Schlüssel",
                        "Standard",
                        "Kommentar",
                    ],
                    rows,
                    [
                        width * 0.22,
                        width * 0.17,
                        width * 0.06,
                        width * 0.09,
                        width * 0.20,
                        width * 0.26,
                    ],
                )
            )
        else:
            story.append(para("Keine Felder dokumentiert."))
        story += [
            para("Primärschlüssel", "h2"),
            para(
                ", ".join(table.get("primary_key", []))
                or "Kein Primärschlüssel erkannt."
            ),
        ]
        foreign_keys = table.get("foreign_keys", [])
        if foreign_keys:
            story += [
                para("Fremdschlüssel", "h2"),
                grid(
                    ["Name", "Spalten", "Zielobjekt", "Zielspalten"],
                    [
                        [
                            fk.get("name") or "—",
                            ", ".join(fk.get("columns", [])),
                            ".".join(
                                filter(
                                    None,
                                    [
                                        fk.get("target_schema") or table.get("schema"),
                                        fk["target_table"],
                                    ],
                                )
                            ),
                            ", ".join(fk.get("target_columns", [])),
                        ]
                        for fk in foreign_keys
                    ],
                    [width * 0.20, width * 0.25, width * 0.30, width * 0.25],
                ),
            ]
        indexes = [
            [
                i.get("name") or "—",
                ", ".join(str(c) for c in i.get("columns", [])),
                "Ja" if i.get("unique") else "Nein",
                "Index",
            ]
            for i in table.get("indexes", [])
        ]
        indexes += [
            [
                i.get("name") or "—",
                ", ".join(str(c) for c in i.get("columns", [])),
                "Ja",
                "Unique Constraint",
            ]
            for i in table.get("unique_constraints", [])
        ]
        if indexes:
            story += [
                para("Indizes & eindeutige Constraints", "h2"),
                grid(
                    ["Name", "Spalten", "Eindeutig", "Typ"],
                    indexes,
                    [width * 0.30, width * 0.40, width * 0.12, width * 0.18],
                ),
            ]
        if table.get("validator"):
            story += [para("MongoDB-Validator", "h2"), para(table["validator"])]
    draw_footer = footer(payload, size)
    doc.build(story, onFirstPage=draw_footer, onLaterPages=draw_footer)
    return buffer.getvalue()


def relationships(tables):
    lookup = {(t.get("schema") or "", t["name"]): t for t in tables}
    result = []
    for table in tables:
        for fk in table.get("foreign_keys", []):
            schema = fk.get("target_schema") or table.get("schema") or ""
            target = lookup.get((schema, fk["target_table"]))
            result.append(
                {
                    "number": len(result) + 1,
                    "source": table,
                    "target": target,
                    "target_name": ".".join(filter(None, [schema, fk["target_table"]])),
                    "fk": fk,
                }
            )
    return result


def diagram_groups(tables, relations):
    lookup = {t["key"]: t for t in tables}
    neighbors = {key: set() for key in lookup}
    for relation in relations:
        if relation["target"]:
            left, right = relation["source"]["key"], relation["target"]["key"]
            neighbors[left].add(right)
            neighbors[right].add(left)
    remaining = set(lookup)
    order = []
    while remaining:
        root = min(
            remaining,
            key=lambda k: (-len(neighbors[k]), full_name(lookup[k]).casefold(), k),
        )
        queue = deque([root])
        queued = {root}
        while queue:
            key = queue.popleft()
            if key not in remaining:
                continue
            remaining.remove(key)
            order.append(lookup[key])
            for neighbor in sorted(
                neighbors[key], key=lambda k: (full_name(lookup[k]).casefold(), k)
            ):
                if neighbor in remaining and neighbor not in queued:
                    queue.append(neighbor)
                    queued.add(neighbor)
    return [order[i : i + 6] for i in range(0, len(order), 6)]


def fit(value, width, font=FONT, size=8):
    value = text(value).replace("\n", " ")
    if pdfmetrics.stringWidth(value, font, size) <= width:
        return value
    while value and pdfmetrics.stringWidth(value + "…", font, size) > width:
        value = value[:-1]
    return value + "…"


class Diagram(Flowable):
    def __init__(self, tables, relations, pages, ids, number, width):
        super().__init__()
        self.width, self.height = width, 585
        self.tables, self.relations, self.pages, self.ids, self.number = (
            tables,
            relations,
            pages,
            ids,
            number,
        )

    def draw(self):
        canvas = self.canv
        canvas.bookmarkPage(f"diagram-{self.number}")
        canvas.addOutlineEntry(
            f"ER-Diagramm {self.number}", f"diagram-{self.number}", level=0
        )
        node_width = (self.width - 160) / 3
        node_height = 220
        slots = [1, 0, 2, 4, 3, 5]
        positions = {}
        for i, table in enumerate(self.tables):
            slot = slots[i]
            positions[table["key"]] = (
                (slot % 3) * (node_width + 80),
                330 if slot < 3 else 35,
            )
        # Lines run in the gap between rows so they do not pass through other cards.
        canvas.setLineWidth(1)
        canvas.setStrokeColor(colors.HexColor("#80a28c"))
        for relation in self.relations:
            source = relation["source"]["key"]
            target = relation["target"]["key"] if relation["target"] else None
            if source not in positions or target not in positions:
                continue
            ax, ay = positions[source]
            bx, by = positions[target]
            if source == target:
                points = [
                    (ax + node_width, ay + 135),
                    (ax + node_width + 25, ay + 135),
                    (ax + node_width + 25, ay + 105),
                    (ax + node_width, ay + 105),
                ]
                label_x, label_y = ax + node_width + 7, ay + 120
            else:
                sx, sy = ax + node_width / 2, ay if ay > 300 else ay + node_height
                tx, ty = bx + node_width / 2, by if by > 300 else by + node_height
                lane = 290 + (relation["number"] % 7 - 3) * 5
                # Distinct x offsets keep links on the same side visible when sharing a row.
                offset = (relation["number"] % 5 - 2) * 8
                sx += offset
                tx -= offset
                points = [(sx, sy), (sx, lane), (tx, lane), (tx, ty)]
                label_x, label_y = (sx + tx) / 2, lane + 3
            path = canvas.beginPath()
            path.moveTo(*points[0])
            for point in points[1:]:
                path.lineTo(*point)
            canvas.drawPath(path)
            angle = math.atan2(
                points[-1][1] - points[-2][1], points[-1][0] - points[-2][0]
            )
            x, y = points[-1]
            arrow = canvas.beginPath()
            arrow.moveTo(x, y)
            arrow.lineTo(x - 6 * math.cos(angle - 0.45), y - 6 * math.sin(angle - 0.45))
            arrow.lineTo(x - 6 * math.cos(angle + 0.45), y - 6 * math.sin(angle + 0.45))
            arrow.close()
            canvas.setFillColor(GREEN)
            canvas.drawPath(arrow, fill=1, stroke=0)
            canvas.setFont(BOLD, 7)
            canvas.drawString(label_x, label_y, f'[{relation["number"]}]')
        for table in self.tables:
            key = table["key"]
            x, y = positions[key]
            canvas.setFillColor(colors.white)
            canvas.setStrokeColor(LINE)
            canvas.roundRect(x, y, node_width, node_height, 8, fill=1, stroke=1)
            canvas.setFillColor(PALE)
            canvas.rect(
                x + 1, y + node_height - 52, node_width - 2, 51, fill=1, stroke=0
            )
            canvas.setFillColor(GREEN)
            canvas.setFont(BOLD, 10)
            canvas.drawString(
                x + 12,
                y + node_height - 19,
                fit(f"{self.ids[key]} · {full_name(table)}", node_width - 24, BOLD, 10),
            )
            canvas.setFillColor(MUTED)
            canvas.setFont(FONT, 8)
            canvas.drawString(
                x + 12,
                y + node_height - 37,
                f'{table["kind"]} · {len(table["columns"])} Felder',
            )
            foreign = {
                c for fk in table.get("foreign_keys", []) for c in fk.get("columns", [])
            }
            # Prioritize key columns while leaving the full column list in the table PDF.
            columns = sorted(
                enumerate(table["columns"]),
                key=lambda item: (
                    not bool(item[1].get("primary_key") or item[1]["name"] in foreign),
                    item[0],
                ),
            )
            for i, (_, column) in enumerate(columns[:8]):
                cy = y + node_height - 70 - i * 15
                flag = "/".join(
                    label
                    for condition, label in [
                        (column.get("primary_key"), "PK"),
                        (column["name"] in foreign, "FK"),
                    ]
                    if condition
                )
                canvas.setFont(BOLD, 7)
                canvas.setFillColor(GREEN)
                canvas.drawString(x + 12, cy, flag)
                canvas.setFont(FONT, 8)
                canvas.setFillColor(INK)
                canvas.drawString(
                    x + 48, cy, fit(column["name"], node_width * 0.56 - 48)
                )
                canvas.setFillColor(MUTED)
                canvas.drawRightString(
                    x + node_width - 12, cy, fit(column["type"], node_width * 0.40 - 12)
                )
            canvas.setFont(FONT, 7)
            canvas.setFillColor(MUTED)
            if len(columns) > 8:
                canvas.drawString(
                    x + 12,
                    y + 25,
                    f"+ {len(columns)-8} weitere Felder · siehe Tabellen-PDF",
                )
            outgoing = [
                r
                for r in self.relations
                if r["source"]["key"] == key
                and (not r["target"] or r["target"]["key"] not in positions)
            ]
            if outgoing:
                refs = "; ".join(
                    (
                        f'[{r["number"]}] → D.{self.pages[r["target"]["key"]]}'
                        if r["target"]
                        else f'[{r["number"]}] → extern'
                    )
                    for r in outgoing
                )
                canvas.drawString(x + 12, y + 11, fit(refs, node_width - 24, size=7))
                canvas.linkRect(
                    "Beziehungsverzeichnis",
                    "relations",
                    (x + 8, y + 5, x + node_width - 8, y + 22),
                    relative=1,
                    thickness=0,
                )


def er_pdf(payload):
    buffer = BytesIO()
    size = landscape(A3)
    width = size[0] - 72
    tables = payload["schema"]["tables"]
    relations = relationships(tables)
    groups = diagram_groups(tables, relations)
    by_source = {t["key"]: [] for t in tables}
    for relation in relations:
        by_source[relation["source"]["key"]].append(relation)
    pages = {t["key"]: number for number, group in enumerate(groups, 1) for t in group}
    ids = {t["key"]: f"T{number}" for number, t in enumerate(tables, 1)}
    doc = document(buffer, payload, size, f'{payload["source"]["name"]} · ER-Modell')
    story = []
    for number, group in enumerate(groups, 1):
        if story:
            story.append(PageBreak())
        story += [
            para(f"ER-Modell · Diagramm {number} von {len(groups)}", "h1"),
            para(payload["source"]["name"]),
            para(
                f'{len(tables)} Objekte · {len(relations)} deklarierte Beziehungen · Stand: {payload["created"]}',
                "small",
            ),
            para(
                "PK = Primärschlüssel · FK = Fremdschlüssel · Pfeile zeigen auf das Zielobjekt. [Nr.] verweist auf das Beziehungsverzeichnis; D.N bezeichnet ein anderes Diagramm.",
                "small",
            ),
            Diagram(
                group,
                [r for t in group for r in by_source[t["key"]]],
                pages,
                ids,
                number,
                width,
            ),
        ]
    if not tables:
        story = [
            para("ER-Modell", "title"),
            para(payload["source"]["name"]),
            para("Keine zugänglichen Objekte im gespeicherten Schema gefunden."),
        ]
    if tables:
        story += [
            PageBreak(),
            heading("Objektverzeichnis", "objects"),
            para(
                "Vollständige Objektnamen und ihre Diagrammzuordnung. Die PDF enthält alle dokumentierten Objekte; die Grenze von 80 Objekten der Bildschirmansicht gilt hier nicht.",
                "small",
            ),
            grid(
                ["ID", "Objekt", "Typ", "Felder", "Diagramm"],
                [
                    [
                        ids[t["key"]],
                        full_name(t),
                        t["kind"],
                        len(t["columns"]),
                        f'D.{pages[t["key"]]}',
                    ]
                    for t in tables
                ],
                [width * 0.06, width * 0.62, width * 0.12, width * 0.08, width * 0.12],
            ),
        ]
    if relations:
        story += [
            PageBreak(),
            heading("Beziehungsverzeichnis", "relations"),
            para(
                "Alle deklarierten Fremdschlüssel, einschließlich zusammengesetzter Schlüssel und Verweisen außerhalb des dokumentierten Schemas.",
                "small",
            ),
            grid(
                [
                    "Nr.",
                    "Quelle / FK-Spalten",
                    "Ziel / Zielspalten",
                    "Constraint",
                    "Diagramme",
                ],
                [
                    [
                        f'[{r["number"]}]',
                        f'{ids[r["source"]["key"]]} · {full_name(r["source"])}\n{", ".join(r["fk"].get("columns",[]))}',
                        f'{ids[r["target"]["key"]]+" · " if r["target"] else ""}{r["target_name"]}\n{", ".join(r["fk"].get("target_columns",[]))}',
                        r["fk"].get("name") or "—",
                        f'D.{pages[r["source"]["key"]]} → '
                        + (
                            f'D.{pages[r["target"]["key"]]}'
                            if r["target"]
                            else "Extern / nicht im Scan"
                        ),
                    ]
                    for r in relations
                ],
                [width * 0.05, width * 0.31, width * 0.31, width * 0.17, width * 0.16],
            ),
        ]
    else:
        story += [
            Spacer(1, 12),
            para(
                "Keine deklarierten Fremdschlüssel. Beziehungen werden nicht aus Feldnamen abgeleitet.",
                "small",
            ),
        ]
    for warning in payload["schema"].get("warnings", []):
        story.append(para(warning, "small"))
    if payload["schema"].get("inferred"):
        story.append(
            para(
                "MongoDB-Felder wurden aus Stichproben abgeleitet und können unvollständig sein.",
                "small",
            )
        )
    draw_footer = footer(payload, size)
    doc.build(story, onFirstPage=draw_footer, onLaterPages=draw_footer)
    return buffer.getvalue()
