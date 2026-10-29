"""PDF geometry and pagination checks; run with ReportLab, Pillow and pypdf."""
import hashlib
import io
from pathlib import Path
import unittest
import zipfile
from PIL import Image
from pypdf import PdfReader
from pypdf.generic import ContentStream
from pdf_export import make_pdf

ROOT = Path(__file__).resolve().parent

def placements(reader, page):
    matrices = []
    current = None
    for operands, operator in ContentStream(page.get_contents(), reader).operations:
        if operator == b'cm':
            current = [float(value) for value in operands]
        if operator == b'Do':
            matrices.append(current)
    return matrices

def card_bounds(reader, page):
    matrix = (1, 0, 0, 1, 0, 0)
    stack, bounds = [], []
    for values, operator in ContentStream(page.get_contents(), reader).operations:
        if operator == b'q':
            stack.append(matrix)
        elif operator == b'Q':
            matrix = stack.pop()
        elif operator == b'cm':
            a,b,c,d,e,f = matrix
            g,h,i,j,k,l = map(float, values)
            matrix = (a*g+c*h, b*g+d*h, a*i+c*j, b*i+d*j, a*k+c*l+e, b*k+d*l+f)
        elif operator == b'Do':
            a,b,c,d,e,f = matrix
            points = [(a*x+c*y+e, b*x+d*y+f) for x,y in ((0,0),(0,1),(1,0),(1,1))]
            bounds.append((min(x for x,y in points), min(y for x,y in points), max(x for x,y in points), max(y for x,y in points)))
    return bounds

class PdfExportTests(unittest.TestCase):
    def test_nine_cards_per_page_and_exact_physical_size(self):
        image = (ROOT / 'test-output' / 'heavy-cavalry-blue.png').read_bytes()
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, 'w') as cards:
            for i in range(10):
                cards.writestr(f'{i+1:02}-cavalry-blue.png', image)
        reader = PdfReader(io.BytesIO(make_pdf(archive.getvalue())))
        self.assertEqual([len(placements(reader, page)) for page in reader.pages], [9, 1])
        self.assertEqual(reader.trailer['/Root']['/ViewerPreferences']['/PrintScaling'], '/None')
        for page in reader.pages:
            self.assertAlmostEqual(float(page.mediabox.width) * 25.4 / 72, 210, places=3)
            self.assertAlmostEqual(float(page.mediabox.height) * 25.4 / 72, 297, places=3)
            for width, _, _, height, x, y in placements(reader, page):
                self.assertAlmostEqual(width * 25.4 / 72, 63, places=4)
                self.assertAlmostEqual(height * 25.4 / 72, 88, places=4)
                self.assertGreaterEqual(x, 0)
                self.assertGreaterEqual(y, 0)
                self.assertLessEqual(x + width, float(page.mediabox.width))
                self.assertLessEqual(y + height, float(page.mediabox.height))
        first = placements(reader, reader.pages[0])
        self.assertEqual(len(set(round(item[4], 3) for item in first)), 3)
        self.assertEqual(len(set(round(item[5], 3) for item in first)), 3)
        xs = sorted(set(item[4] for item in first))
        ys = sorted(set(item[5] for item in first))
        for index in range(2):
            self.assertAlmostEqual(xs[index + 1] - xs[index], first[0][0], delta=0.001)
            self.assertAlmostEqual(ys[index + 1] - ys[index], first[0][3], delta=0.001)

    def test_browser_export_uses_minimum_pages_for_mixed_cards(self):
        reader = PdfReader(ROOT.parent / 'output' / 'pdf' / 'unit-cards-3x3-actual-size.pdf')
        counts = [len(placements(reader, page)) for page in reader.pages]
        self.assertEqual(sum(counts), 26)
        self.assertEqual(counts, [9, 9, 8])
        self.assertEqual(len(reader.pages), 3)
        for page in reader.pages:
            self.assertLess(float(page.mediabox.width), float(page.mediabox.height))
            bounds = card_bounds(reader, page)
            for index, (left, bottom, right, top) in enumerate(bounds):
                self.assertAlmostEqual((right-left)*25.4/72, 63, places=4)
                self.assertAlmostEqual((top-bottom)*25.4/72, 88, places=4)
                if index % 3:
                    self.assertAlmostEqual(left, bounds[index-1][2], delta=0.001)
                if index >= 3:
                    self.assertAlmostEqual(top, bounds[index-3][1], delta=0.001)
            for width, _, _, height, _, _ in placements(reader, page):
                self.assertAlmostEqual(min(width, height) * 25.4 / 72, 63, places=4)
                self.assertAlmostEqual(max(width, height) * 25.4 / 72, 88, places=4)

    def test_current_browser_edits_are_embedded_losslessly(self):
        reader = PdfReader(ROOT / 'test-output' / 'pdf-edited-cards.pdf')
        page = reader.pages[0]
        first_image = next(operands[0] for operands, operator in ContentStream(page.get_contents(), reader).operations if operator == b'Do')
        actual = page.images[str(first_image)].image.convert('RGB')
        expected = Image.open(ROOT / 'test-output' / 'pdf-expected-first-card.png').convert('RGB')
        self.assertEqual(actual.size, expected.size)
        self.assertEqual(hashlib.sha256(actual.tobytes()).digest(), hashlib.sha256(expected.tobytes()).digest())

if __name__ == '__main__':
    unittest.main()
