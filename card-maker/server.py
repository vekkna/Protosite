"""Local card maker. Run with Python 3; no third-party packages required."""
import csv
import io
import json
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import urlopen
from urllib.parse import urlparse
import webbrowser

ROOT = Path(__file__).resolve().parent.parent
SOURCE = 'https://docs.google.com/spreadsheets/d/1ONrDG-NfkjDlBoJvRlDNbhBSsCUkxlD_tbmZNQom1PU/export?format=csv&gid=663136589'

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        if urlparse(self.path).path != '/api/units':
            return super().do_GET()
        cached = False
        warning = ''
        try:
            with urlopen(SOURCE, timeout=15) as response:
                content = response.read().decode('utf-8-sig')
            rows = list(csv.DictReader(io.StringIO(content)))
            if not rows or not {'Unit', 'Speed', 'Drill', 'Melee', 'Ranged', 'Def', 'Footprint'}.issubset(rows[0]):
                raise ValueError('The sheet did not return the expected unit columns.')
            (ROOT / 'unit-cards-source.csv').write_text(content, encoding='utf-8')
        except Exception as exc:
            cached = True
            warning = 'Live sheet unavailable; using the downloaded snapshot. ' + str(exc)
            with (ROOT / 'unit-cards-source.csv').open(encoding='utf-8-sig', newline='') as source:
                rows = list(csv.DictReader(source))
        data = json.dumps({'units': [{k: (v or '').strip() for k, v in row.items() if k} for row in rows if row.get('Unit', '').strip()], 'cached': cached, 'warning': warning}).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

if __name__ == '__main__':
    import sys
    import os
    port = int(os.environ.get('CARD_MAKER_PORT', '8765'))
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    print(f'Card maker: http://127.0.0.1:{port}/card-maker/', flush=True)
    if '--no-browser' not in sys.argv:
        webbrowser.open(f'http://127.0.0.1:{port}/card-maker/')
    server.serve_forever()
