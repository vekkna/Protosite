"""Read embedded images from RolesStats in a public XLSX export.

The workbook is read only. Uses standard Python libraries, no account connection.
"""
from pathlib import Path
from xml.etree import ElementTree as ET
import hashlib
import json
import posixpath
import re
import sys
import zipfile

ROOT = Path(__file__).resolve().parent.parent
NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
      'x': 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing',
      'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
      'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}

def related(archive, owner):
    folder, name = posixpath.split(owner)
    rels = ET.fromstring(archive.read(posixpath.join(folder, '_rels', name + '.rels')))
    return {item.attrib['Id']: posixpath.normpath(posixpath.join(folder, item.attrib['Target'])) for item in rels if item.attrib.get('TargetMode') != 'External'}

def import_icons(filename):
    mapping = {}
    with zipfile.ZipFile(filename) as archive:
        book = ET.fromstring(archive.read('xl/workbook.xml'))
        sheet = next(item for item in book.find('s:sheets', NS) if item.attrib['name'] == 'RolesStats')
        sheet_path = related(archive, 'xl/workbook.xml')[sheet.attrib['{' + NS['r'] + '}id']]
        table = ET.fromstring(archive.read(sheet_path))
        strings = [''.join(item.itertext()) for item in ET.fromstring(archive.read('xl/sharedStrings.xml'))]
        def cell_text(cell):
            value = cell.find('s:v', NS)
            if cell.attrib.get('t') == 'inlineStr':
                return ''.join(cell.find('s:is', NS).itertext())
            return strings[int(value.text)] if value is not None and cell.attrib.get('t') == 's' else (value.text if value is not None else '')
        cells = {cell.attrib['r']: cell_text(cell) for cell in table.findall('.//s:c', NS)}
        headers = {re.sub(r'\d+$', '', reference): value.strip() for reference, value in cells.items() if re.search(r'(?<!\d)1$', reference)}
        unit_col = next(col for col, title in headers.items() if title == 'Unit')
        icon_col = next(col for col, title in headers.items() if title == 'Icon')
        def col_number(col):
            number = 0
            for char in col:
                number = number * 26 + ord(char) - 64
            return number - 1
        drawing = table.find('s:drawing', NS)
        drawing_path = related(archive, sheet_path)[drawing.attrib['{' + NS['r'] + '}id']]
        image_paths = related(archive, drawing_path)
        for anchor in ET.fromstring(archive.read(drawing_path)):
            origin = anchor.find('x:from', NS)
            if origin is None or int(origin.find('x:col', NS).text) != col_number(icon_col):
                continue
            row = int(origin.find('x:row', NS).text) + 1
            unit = cells.get(f'{unit_col}{row}', '').strip()
            blip = anchor.find('.//a:blip', NS)
            if not unit or blip is None:
                continue
            source = image_paths[blip.attrib['{' + NS['r'] + '}embed']]
            content = archive.read(source)
            suffix = Path(source).suffix.lower()
            if suffix not in ('.png', '.jpg', '.jpeg', '.webp', '.svg'):
                raise ValueError('Unsupported embedded image format: ' + suffix)
            name = 'sheet-unit-icon-' + hashlib.sha256(content).hexdigest()[:16] + suffix
            (ROOT / 'images' / name).write_bytes(content)
            mapping[unit] = name
    if not mapping:
        raise ValueError('No embedded Icon images found in RolesStats.')
    target = ROOT / 'unit-artwork.js'
    code = target.read_text(encoding='utf-8')
    replacement = '// BEGIN SHEET ICONS\n    const sheetFiles = ' + json.dumps(mapping, indent=4) + ';\n    // END SHEET ICONS'
    code, count = re.subn(r'// BEGIN SHEET ICONS.*?// END SHEET ICONS', lambda _: replacement, code, flags=re.S)
    if count != 1:
        raise ValueError('Shared artwork file has no unique import marker.')
    target.write_text(code, encoding='utf-8')
    (ROOT / 'card-maker' / 'assets' / 'sheet-icon-assignments.json').write_text(json.dumps(mapping, indent=2), encoding='utf-8')
    print(f'Imported {len(mapping)} assignments / {len(set(mapping.values()))} distinct images from RolesStats.')

if __name__ == '__main__':
    import_icons(sys.argv[1])
