"""Local server for Seize the Day.

    python tools/serve.py [port=8173] [--open]

Serves the project folder. Every response says Cache-Control: no-cache, so the
browser checks each file for a newer copy before using its cached one (unchanged
files come back as a quick 304). Without it, a browser can keep running an old
copy of one script alongside new copies of the others, and the game fails to start.
"""
import os
import sys
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class NoCacheHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    port = int(args[0]) if args else 8173
    server = ThreadingHTTPServer(('127.0.0.1', port), NoCacheHandler)
    url = f'http://127.0.0.1:{port}/'
    print('Seize the Day is running at ' + url, flush=True)
    print('Press Ctrl+C or close this window to stop.', flush=True)
    if '--open' in sys.argv:
        webbrowser.open(url)
    server.serve_forever()


if __name__ == '__main__':
    main()
