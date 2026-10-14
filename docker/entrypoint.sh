#!/bin/sh
set -eu

cmd="${1:-serve}"

if [ "$cmd" = "cli" ]; then
  shift
  exec node /app/dist/cli/excalidraw2vsdx.js "$@"
fi

if [ "$cmd" = "serve" ]; then
  exec node /app/serve.mjs
fi

exec "$@"
