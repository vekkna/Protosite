"""Create an A4, actual-size, 3 x 3 card PDF from the editor's PNG ZIP."""
import io
import re
import struct
import sys
import zipfile

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas


def make_pdf(archive_bytes):
    cards = []
    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
        for entry in archive.infolist():
            match = re.fullmatch(r'\d+-[a-z0-9-]+-(blue|orange)\.png', entry.filename)
            if not match:
                continue
            data = archive.read(entry)
            if len(data) < 24 or data[:8] != b'\x89PNG\r\n\x1a\n':
                raise ValueError('A card is not a valid PNG.')
            pixels = struct.unpack('>II', data[16:24])
            if pixels == (1260, 1760):
                footprint = 'SN'
            elif pixels == (1760, 1260):
                footprint = 'SW'
            else:
                raise ValueError('Cards must use the editor\'s exact-size SN or SW export.')
            cards.append((footprint, data))
    if not cards:
        raise ValueError('No card images were supplied.')

    output = io.BytesIO()
    pdf = canvas.Canvas(output, pagesize=A4, pageCompression=1)
    pdf.setTitle('Seize the Day - actual-size unit cards, 3 x 3')
    pdf.setAuthor('Unit Card Studio')
    pdf.setViewerPreference('PrintScaling', 'None')
    page_number = 0
    gutter = 0
    # Both footprints occupy the same slot after a quarter-turn. Mixing colours
    # and footprints therefore always achieves ceil(card_count / 9) pages.
    width_mm, height_mm = 63, 88
    card_width, card_height = width_mm * mm, height_mm * mm
    page_width, page_height = A4
    left = (page_width - 3 * card_width - 2 * gutter) / 2
    bottom = (page_height - 3 * card_height - 2 * gutter) / 2
    for start in range(0, len(cards), 9):
        pdf.setPageSize((page_width, page_height))
        page_number += 1
        for index, (footprint, data) in enumerate(cards[start:start + 9]):
            column, row = index % 3, index // 3
            x = left + column * (card_width + gutter)
            y = bottom + (2 - row) * (card_height + gutter)
            # PDF points specify the print size directly; no image-DPI guesswork.
            pdf.saveState()
            if footprint == 'SW':
                pdf.translate(x + card_width, y)
                pdf.rotate(90)
                pdf.drawImage(ImageReader(io.BytesIO(data)), 0, 0, width=card_height, height=card_width)
            else:
                pdf.drawImage(ImageReader(io.BytesIO(data)), x, y, width=card_width, height=card_height)
            pdf.restoreState()
        # Guides stay outside the entire grid; adjacent cards share cut edges.
        pdf.setStrokeColorRGB(0.65, 0.65, 0.65)
        pdf.setLineWidth(0.2)
        for column in range(4):
            edge_x = left + column * card_width
            for edge_y, direction in ((bottom, -1), (bottom + 3 * card_height, 1)):
                pdf.line(edge_x, edge_y + direction * 0.5 * mm, edge_x, edge_y + direction * 2 * mm)
        for row in range(4):
            edge_y = bottom + row * card_height
            for edge_x, direction in ((left, -1), (left + 3 * card_width, 1)):
                pdf.line(edge_x + direction * 0.5 * mm, edge_y, edge_x + direction * 2 * mm, edge_y)
        pdf.setFillColorRGB(0.35, 0.35, 0.35)
        pdf.setFont('Helvetica', 6)
        pdf.drawString(10 * mm, 5 * mm, 'Cards 63 x 88 mm (some rotated) | Print: Actual size / 100%')
        pdf.drawRightString(page_width - 10 * mm, 5 * mm, f'{page_number}')
        pdf.showPage()
    pdf.save()
    return output.getvalue()


if __name__ == '__main__':
    sys.stdout.buffer.write(make_pdf(sys.stdin.buffer.read()))
