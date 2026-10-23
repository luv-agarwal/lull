#!/bin/sh
# Build the Chrome Web Store upload: dist/lull-<version>.zip from extension/.
set -eu
cd "$(dirname "$0")/.."
version=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' extension/manifest.json | head -1)
mkdir -p dist
out="dist/lull-$version.zip"
rm -f "$out"
(cd extension && zip -qrX "../$out" . -x '*.DS_Store' -x 'icons/icon.svg')
echo "$out $(wc -c < "$out" | tr -d ' ') bytes"
