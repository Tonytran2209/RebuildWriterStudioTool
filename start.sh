#!/bin/bash
set -e
export DIST_PATH=/app/dist
echo "[start] DIST_PATH=$DIST_PATH"
echo "[start] cwd=$(pwd)"
ls "$DIST_PATH/index.html" && echo "[start] dist/index.html found" || echo "[start] WARNING: dist/index.html NOT found"
exec node backend/node_modules/.bin/tsx backend/index.ts
