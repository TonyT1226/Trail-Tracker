"""The local server must make browsers re-check files, so an update never runs stale JS.

Run:  python -m unittest tests/test_serve.py -v
"""
import os
import sys
import threading
import unittest
import urllib.error
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

from serve import make_server  # noqa: E402


class ServeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = make_server(0)                      # any free port
        cls.base = f"http://127.0.0.1:{cls.httpd.server_address[1]}"
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()

    def get(self, path, headers=None):
        req = urllib.request.Request(self.base + path, headers=headers or {})
        try:
            return urllib.request.urlopen(req, timeout=5)
        except urllib.error.HTTPError as e:           # 304 comes back as an "error"
            return e

    def test_scripts_are_served_with_no_cache(self):
        r = self.get("/js/app.js")
        self.assertEqual(r.status, 200)
        self.assertEqual(r.headers["Cache-Control"], "no-cache")
        self.assertIn(b"export async function start", r.read())

    def test_unchanged_files_revalidate_cheaply(self):
        first = self.get("/js/map.js")
        again = self.get("/js/map.js", {"If-Modified-Since": first.headers["Last-Modified"]})
        self.assertEqual(again.status, 304)

    def test_serves_the_project_whatever_the_cwd(self):
        self.assertEqual(self.get("/data/trails/index.json").status, 200)

    def test_listens_on_this_computer_only(self):
        self.assertEqual(self.httpd.server_address[0], "127.0.0.1")


if __name__ == "__main__":
    unittest.main()
