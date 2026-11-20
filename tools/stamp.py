"""Stamp the web app with a build id so phones can tell when a newer version is deployed.

The id is a hash of the app's own files. It is written to docs/version.json, to
window.PAND_BUILD in docs/index.html, and as ?v=<id> on every local script and stylesheet
so a new build never reuses a cached asset. Idempotent: run it before pushing; the
"Stamp build" workflow also runs it on every push to main.

Usage: python3 tools/stamp.py
"""
import glob
import hashlib
import json
import os
import re

DOCS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "docs")
ASSET_RE = re.compile(r'((?:src|href)="(?:vendor/)?[\w.-]+\.(?:js|css))(?:\?v=[0-9a-f]+)?"')
BUILD_RE = re.compile(r'window\.PAND_BUILD="[^"]*"')


def main():
    index_path = os.path.join(DOCS, "index.html")
    html = open(index_path, encoding="utf-8").read()
    neutral = BUILD_RE.sub('window.PAND_BUILD=""', ASSET_RE.sub(r'\1"', html))
    h = hashlib.sha256(neutral.encode("utf-8"))
    for pattern in ("*.js", "*.css", "vendor/*.js", "vendor/*.css", "manifest.webmanifest"):
        for f in sorted(glob.glob(os.path.join(DOCS, pattern))):
            h.update(open(f, "rb").read())
    build = h.hexdigest()[:12]
    stamped = BUILD_RE.sub(f'window.PAND_BUILD="{build}"', ASSET_RE.sub(rf'\1?v={build}"', neutral))
    if stamped != html:
        open(index_path, "w", encoding="utf-8").write(stamped)
    version_path = os.path.join(DOCS, "version.json")
    payload = json.dumps({"v": build}) + "\n"
    if not os.path.exists(version_path) or open(version_path, encoding="utf-8").read() != payload:
        open(version_path, "w", encoding="utf-8").write(payload)
    print("build", build)


if __name__ == "__main__":
    main()
