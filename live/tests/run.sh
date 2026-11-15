#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Fleet Live's tests, all local: the server's Python tests, then browser tests of the web UI against a
# fixture API (no machine is read). Needs Python 3.11+, Node 22+ and a Chromium (live/tests/web/harness.mjs
# says how one is found). Usage: live/tests/run.sh
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
python3 -m unittest discover -s "$HERE" -p 'test_*.py'
node --test "$HERE"/web/*.test.mjs
