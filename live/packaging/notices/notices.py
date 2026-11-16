#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""THIRD_PARTY_NOTICES.txt for a package Fleet builds: what it carries besides Fleet, and each one's licence (#388).
Usage: notices.py macos|linux <out file>"""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
PY = ("Python 3.12 (python-build-standalone)", "PSF-2.0 and others", "python/lib/python3.12/LICENSE.txt in this package: Python's licence, "
      "with the notices of what CPython includes", None)
LIBS_PY = [("libffi", "MIT", "libffi"), ("bzip2", "bzip2 licence (BSD-like)", "bzip2"), ("xz / liblzma", "0BSD and public domain", "xz"),
           ("zlib", "zlib licence", "zlib"), ("OpenSSL", "Apache-2.0", "openssl"), ("ncurses", "X11/MIT", "ncurses"), ("SQLite", "public domain", None)]
# the terminals' fonts: the symbols font (#387) and the ones to pick from (#408), each licence beside it in the package
FONTS = [("Symbols Nerd Font Mono (Nerd Fonts 3.5.1)", "MIT, with its icon sets' own licences", "live/web/fonts/SymbolsNerdFont-LICENSE.txt in this package", None),
         ("Fira Code 6.2", "SIL Open Font License 1.1", "live/web/fonts/FiraCode-OFL.txt in this package", None),
         ("JetBrains Mono 2.304", "SIL Open Font License 1.1", "live/web/fonts/JetBrainsMono-OFL.txt in this package", None),
         ("Source Code Pro 2.042", "SIL Open Font License 1.1", "live/web/fonts/SourceCodePro-OFL.txt in this package", None),
         ("Hack 3.003", "MIT, and the Bitstream Vera License for the Bitstream Vera Sans Mono it builds on", "live/web/fonts/Hack-LICENSE.txt in this package", None)]
CARRIES = {
    "macos": [("ttyd 1.7.7", "MIT", None, "ttyd"), ("libwebsockets", "MIT", None, "libwebsockets"), ("json-c", "MIT", None, "json-c"),
              ("libuv", "MIT and others", None, "libuv"), ("OpenSSL", "Apache-2.0", None, "openssl"), ("tmux 3.8", "ISC", None, "tmux"),
              ("libevent", "BSD-3-Clause", None, "libevent"), ("ncurses", "X11/MIT", None, "ncurses"), ("utf8proc", "MIT and Unicode", None, "utf8proc"),
              ("jemalloc", "BSD-2-Clause", None, "jemalloc")],
    "linux": [("ttyd 1.7.7 (its static build: with libwebsockets, json-c, libuv, mbed TLS, zlib and musl)", "MIT", None, "ttyd"),
              ("libwebsockets", "MIT", None, "libwebsockets"), ("json-c", "MIT", None, "json-c"), ("libuv", "MIT and others", None, "libuv"),
              ("mbed TLS", "Apache-2.0", None, "mbedtls"), ("zlib", "zlib licence", None, "zlib"), ("musl libc", "MIT", None, "musl"),
              ("tmux 3.8 (a static build: with libevent, ncurses and musl)", "ISC", None, "tmux"), ("libevent", "BSD-3-Clause", None, "libevent"),
              ("ncurses", "X11/MIT", None, "ncurses")]}
def main():
    kind, out = sys.argv[1], sys.argv[2]
    parts = ["Fleet carries other people's work. Each is listed here with its licence; Fleet itself is GPL-3.0-or-later (COPYING).", ""]
    rows = [(PY[0], PY[1], PY[2], None)] + [("  " + n + " (in Python)", l, None, f) for n, l, f in LIBS_PY] + CARRIES[kind] + FONTS
    for name, lic, where, f in rows:
        parts.append("- %s: %s%s" % (name.strip() if not name.startswith("  ") else name, lic, ("; " + where) if where else ""))
    seen = set()
    for name, lic, where, f in rows:
        if not f or f in seen:
            continue
        seen.add(f)
        with open(os.path.join(HERE, f + ".txt"), encoding="utf-8", errors="replace") as fh:
            parts += ["", "=" * 78, name.strip(), "=" * 78, fh.read().rstrip()]
    with open(out, "w", encoding="utf-8") as fh:
        fh.write("\n".join(parts) + "\n")
main()
