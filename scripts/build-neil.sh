#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build --prefix packages/openai-adapters
npm run build --prefix gui
cd extensions/vscode
SKIP_INSTALLS=true node scripts/prepackage.js --target darwin-arm64
mkdir -p build
npm run esbuild-base -- --minify
./node_modules/.bin/vsce package --no-dependencies --target darwin-arm64 --out build/continue-neil-2.0.1-darwin-arm64.vsix
