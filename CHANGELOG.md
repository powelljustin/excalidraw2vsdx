# Changelog

All notable changes to this project are documented here.

## 1.1.0 — 2026-10-14

- Add a library in the web app. Upload an `.excalidrawlib` or `.excalidraw` file, then browse items with a server-drawn PNG preview.
- Download the whole library, download one item as its own `.excalidrawlib`, or convert that item to Visio.
- Store files and a JSON catalog under `DATA_DIR` (a Docker volume in Compose). Search by name and tag.
- Record `access` as `free` or `paid` on each library and item. Paid files stay hidden. There is no payment checkout. Set `ADMIN_TOKEN` to require a token for upload, edit, and delete.

## 1.0.0 — 2026-10-14

First public release.

- Convert `.excalidraw` scenes and `.excalidrawlib` libraries to native Visio `.vsdx` packages.
- Map rectangles (with real corner arcs), ellipses, diamonds, text, bound text, arrows with glue, multi-point lines, freedraw, images, groups, and rotation.
- Ship a command-line tool, a browser page that converts locally, and a Docker image for `linux/amd64` and `linux/arm64`.
- Include two sample drawings: a Raspberry Pi audio chain and a home-network sketch.
