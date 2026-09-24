#!/usr/bin/env python3
"""Serve the site locally, telling the browser to re-check every file before using it.

`python3 -m http.server` sends no Cache-Control header, so browsers are free to keep
using cached copies of js/*.js for a while. After updating the project (git pull), that
can leave a new index.html running old scripts -- a broken page until a hard refresh.
`Cache-Control: no-cache` makes the browser ask each time; unchanged files still come
back as a quick 304 Not Modified, so nothing is downloaded twice.

Usage:
    python3 scripts/serve.py            # http://localhost:8000
    python3 scripts/serve.py 8080

Only the Python standard library is used; it serves the project folder whatever the
current directory is. It listens on this computer only (127.0.0.1), not the local
network -- js/config.js may hold your Mapbox token.
"""
from __future__ import annotations

import functools
import http.server
import os
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def make_server(port):
    handler = functools.partial(NoCacheHandler, directory=os.path.abspath(ROOT))
    return http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    with make_server(port) as httpd:
        print(f"Serving {os.path.abspath(ROOT)} at http://localhost:{port} (Ctrl+C to stop)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
