# excalidraw2vsdx

Convert an [Excalidraw](https://excalidraw.com) drawing into a native Microsoft Visio `.vsdx` file.

This is a standalone converter, not a fork of Excalidraw. It reads Excalidraw JSON (a `.excalidraw` scene or an `.excalidrawlib` library) and writes an Open Packaging Convention package that Visio and LibreOffice Draw open as a drawing. Shapes are real Visio geometry, not a picture of the canvas. Arrows that are bound to shapes are connectors glued to connection points, so they stay attached when a shape moves.

Author: Justin Powell. License: [MIT](LICENSE).

## Previews

Each picture shows the source geometry on top and LibreOffice Draw’s rendering of the converted `.vsdx` underneath. The top panel redraws positions, colors, and labels from the Excalidraw file. The bottom panel is the Visio file opened by LibreOffice.

Raspberry Pi audio chain:

![Raspberry Pi audio chain, source geometry above and the Visio file below](docs/images/pi-audio-chain-compare.png)

Home network (rectangles, ellipses, a diamond, bound text, glued arrows, a three-point cable, and groups):

![Home network, source geometry above and the Visio file below](docs/images/home-network-compare.png)

## Features

- Rectangles, including adaptive and proportional rounded corners drawn as real arcs
- Ellipses and diamonds sized to the original box
- Standalone text and text bound to a shape or arrow, with no fill and no text-background plate
- Arrows and multi-point lines that keep the source path, with arrowheads and glue when a binding exists
- Groups, rotation, and embedded png, jpeg, gif, and bmp images
- One Visio page per item in an `.excalidrawlib` library
- A browser page that converts the file locally, and a Docker image for Apple Silicon and Intel
- A library on the server: upload an `.excalidrawlib` or `.excalidraw` file, browse items with a PNG preview, download each item, and convert one item to Visio

## Quick start

You need Node.js 20 or newer.

```bash
git clone https://github.com/powelljustin/excalidraw2vsdx.git
cd excalidraw2vsdx
npm install
npm run build
node dist/cli/excalidraw2vsdx.js test/fixtures/home-network.excalidraw -o home-network.vsdx
```

Without a local Node install, use Docker. The short version is below. [docs/DOCKER.md](docs/DOCKER.md) walks through installing Docker Desktop, the volume mount, Windows paths, and how to stop the container.

```bash
docker build -t excalidraw2vsdx .
docker run --rm -p 8080:8080 excalidraw2vsdx
```

Open [http://localhost:8080](http://localhost:8080). That command is enough to try the converter. Library uploads need a data folder that survives the container; [docs/DOCKER.md](docs/DOCKER.md) shows the volume and how to back it up.

## Command line

```bash
npx tsx cli/excalidraw2vsdx.ts diagram.excalidraw -o diagram.vsdx
```

After `npm run build`:

```bash
node dist/cli/excalidraw2vsdx.js diagram.excalidraw -o diagram.vsdx
```

```
excalidraw2vsdx <input.excalidraw> [-o out.vsdx] [options]
excalidraw2vsdx <input.excalidrawlib> [-o out.vsdx]

  -o, --output <file>     Output path. Default: input name with .vsdx
      --px-per-inch <n>   Scene pixels per Visio inch (default 96)
      --margin <inches>   Blank margin around the drawing (default 0.5)
  -h, --help
```

A library file becomes one Visio page per item. The command prints page size and counts, plus a note when something was simplified (roughness, a pattern fill, or a missing image).

Inside the Docker image the same tool is the `cli` command. See [docs/DOCKER.md](docs/DOCKER.md).

## Web page

The convert page builds the `.vsdx` in the browser. That file is not uploaded.

```bash
npm run dev
```

Open [http://127.0.0.1:47321](http://127.0.0.1:47321), drop an `.excalidraw` or `.excalidrawlib` file, and download the `.vsdx`.

The same site has a [library](#library-repository) and an upload page. Those talk to the API server. During development, run it in a second terminal:

```bash
npm run dev:server
```

Vite proxies `/api` to `http://127.0.0.1:8080`. The Docker image serves the pages and the API together.

To build the static files yourself:

```bash
npm run build:web
```

`npm start` (after `npm run build`) serves `dist-web/` and the library API on port 8080.

## Library repository

The library stores shapes on the server so other people can browse them. Upload an `.excalidrawlib` (or a single `.excalidraw` drawing). The server splits a library into one record per item, writes a PNG preview of each item, and keeps the files under a data directory.

Open **Library** to search by name or tag, download the whole `.excalidrawlib`, download one item as its own `.excalidrawlib`, or choose **Convert to Visio (.vsdx)** for that item. The picture is a clean drawing of the elements (roughness is dropped, the same way the converter drops it), so you can see the shape without importing it into Excalidraw.

There is no login. Set `ADMIN_TOKEN` to a long random string when anyone else can reach the server. Upload, edit, and delete then require that value in the Admin token field (sent as `X-Admin-Token`). Leave it unset on a private machine and those actions stay open.

Each library and each item has `access`: `free` or `paid`. New uploads are `free`. `paid` is stored for a later payment check. This version does not take payment. A paid library still shows its name, and its previews and downloads stay hidden until an admin token (or a future check) allows them. The check is a small function, `allowPaid`, passed to `createAccessPolicy` in `src/library/access.ts`. A Stripe check can replace that function later without rewriting the routes.

Metadata is a JSON file, `index.json`, inside the data directory. SQLite through `better-sqlite3` was not used: that package is a native addon, and its musl build is not reliable on `node:22-alpine` for both arm64 and amd64. The JSON file is the whole catalog. Copy the data directory and you have a backup. The files for each library live in `libraries/` next to the index. Previews are PNG files made with [resvg-js](https://github.com/yisibl/resvg-js) from an SVG this project draws itself. No browser runs inside the container.

```bash
DATA_DIR=./data/library ADMIN_TOKEN= npm start
```

`DATA_DIR` defaults to `./data/library` outside Docker and to `/data/library` in the image. `MAX_UPLOAD_BYTES` defaults to 20 MB. Uploads must be JSON, must look like an Excalidraw scene or library, and the file name must end in `.excalidrawlib`, `.excalidraw`, or `.json`. Names are stored as labels. They are never used as disk paths.

Docker setup, the volume, and backup steps are in [docs/DOCKER.md](docs/DOCKER.md).

## Node.js API

```ts
import { readFileSync, writeFileSync } from "node:fs";
import { convertExcalidraw } from "excalidraw2vsdx";

const result = convertExcalidraw(readFileSync("diagram.excalidraw", "utf8"), {
  pxPerInch: 96,
  marginInches: 0.5,
  title: "Diagram",
});

writeFileSync("diagram.vsdx", result.vsdx);
```

`convertExcalidraw` accepts a JSON string or an already-parsed scene, element array, or library. The result is `{ vsdx, pages, warnings }`. `vsdx` is a `Uint8Array`.

## What is mapped

| Excalidraw | Visio |
| --- | --- |
| Rectangle, including adaptive and proportional rounded corners | 2-D shape with quarter-circle corner arcs (not the Rounding cell, which LibreOffice ignores). Proportional radius is 25% of the shorter side; adaptive radius is 32px until the shorter side is small enough to use the proportional value. |
| Ellipse | Ellipse fitted to the shape box. The geometry cells store the real center and radii (LibreOffice draws those cached values and does not evaluate `Width*` / `Height*`) |
| Diamond | Diamond geometry |
| Fill color, stroke color, stroke width | `FillForegnd`, `LineColor`, `LineWeight` |
| Dashed / dotted stroke | Line pattern 2 / 3 |
| Opacity | Fill and line transparency |
| Standalone text | Text-only shape with no fill and no line. Font size, color, alignment, and opacity are kept. The block sits on the original text rectangle. |
| Text bound to a shape or arrow | Text on that shape or connector, with no text-background plate, placed on the original text rectangle (a caption stays where it was drawn; it is not recentered on the whole shape) |
| Transparent `backgroundColor` | No fill (`FillPattern` 0 and geometry `NoFill`) |
| Line | Polyline. A line with arrowheads, bindings, or more than two points is a connector. |
| Arrow | Connector with an end arrowhead. The path is the original polyline (straight or multi-segment), in a box tall enough to hold the label, so a diagonal is not flipped by a negative height. |
| `startBinding` / `endBinding` | Connection point on the target, plus a `Connect` and a `PAR(PNT(...))` glue formula, so the end stays attached when the shape moves |
| Freedraw | Polyline, slightly simplified |
| Image (`png`, `jpeg`, `gif`, `bmp` data URL) | Embedded picture (`ForeignData`) |
| Group | Visio group |
| Frame | Rectangle labeled with the frame name |
| Embed / iframe | Labeled placeholder rectangle |
| Rotation (`angle`) | Shape angle. Excalidraw’s clockwise radians become Visio’s counterclockwise angle. |
| Several library items | One page each |

Arrowheads: `arrow`, `triangle`, `bar`, `dot` / `circle`, `diamond`, and the crow’s-foot variants map to the closest Visio arrowhead index. An Excalidraw `arrow` with no explicit head still gets an end arrow.

Fonts: family 1 and 5 (Virgil, Excalifont) become Segoe Print; 2, 6, and 10 (Helvetica, Nunito, Lilita) become Arial, which is the closest face Visio ships to Helvetica; 3 (Cascadia) becomes Consolas; 7 and 9 (Assistant, Liberation) become Arial; 8 (Comic Shanns) becomes Comic Sans MS. Those faces are listed in the document so Visio does not ask for a missing font. Line spacing is the Excalidraw line height as an absolute pitch (`fontSize × lineHeight` at 96px per inch).

Coordinates: Excalidraw pixels, origin top-left, y down. Visio inches, origin bottom-left, y up. The default scale is 96 pixels per inch. The page is sized to the drawing plus a 0.5 inch margin.

## Package

The `.vsdx` is a zip with the parts Visio expects:

- `[Content_Types].xml`
- `_rels/.rels`
- `docProps/core.xml`, `docProps/app.xml`, `docProps/custom.xml`
- `visio/document.xml` (face names and the built-in style sheets)
- `visio/pages/pages.xml` and `visio/pages/page1.xml` (and further pages)
- `visio/windows.xml`
- `visio/media/` when the drawing has images

Shapes are written as geometry on the page. There is no stencil, so Visio does not try to repair a missing master.

## Samples

Two drawings live in `test/fixtures/` and are covered by the tests:

- `pi-audio-chain.excalidraw` is a device diagram with rounded rectangles, small ellipses (GPIO pins, knobs, speaker drivers, an LED), bound captions, dashed and diagonal arrows, and glued endpoints.
- `home-network.excalidraw` is a small network sketch with rectangles, ellipses, a diamond, standalone and bound text, glued arrows, a three-point cable, and three groups.

## Limitations

- Hand-drawn roughness is dropped. Strokes are clean. A note is recorded when the source had roughness. Both sample drawings are already smooth (`roughness: 0`).
- Hachure, cross-hatch, and zigzag fills become a solid color.
- Freedraw is a polyline. Points closer than about 1.25px are dropped. It is not a Visio ink stroke.
- The painted arrow is the original polyline. Glued ends are connection points on the same side as the Excalidraw binding, but Visio does not reroute bends when a shape is dragged, and the glue does not slide along the outline.
- Arrowheads are Visio’s arrowhead at a size chosen from the stroke width, not Excalidraw’s exact triangle.
- Text uses Arial, Consolas, or Segoe Print. LibreOffice, which often has none of those, substitutes Arimo for Arial. Glyph shapes differ slightly from Helvetica, and a short label is given a little extra width so the substitute does not wrap. The extra width grows away from the alignment anchor.
- Only `png`, `jpeg`, `gif`, and `bmp` images are embedded. Anything else becomes a placeholder rectangle.
- Frames, embeds, and iframes are rectangles with a label. Linked frames keep the link as a hyperlink.
- Deleted elements are skipped. Unsupported element types are skipped and reported.
- There are no layers, and the drawing grid is not copied. The page adds a 0.5 inch margin around the drawing.
- Library previews are clean shapes. Roughness, hachure, and cross-hatch are not drawn. Text uses DejaVu Sans inside the Docker image.
- The library has no accounts and no payments. `paid` only hides files until a check is added. Without `ADMIN_TOKEN`, anyone who can reach the server can upload and delete.

## Development

```bash
npm install
npm test
npm run build
npm run build:web
npm run dev
```

`npm test` runs the unit and integration tests. When LibreOffice (`soffice`) and `pdftoppm` are installed, it also renders both sample drawings to PNG under `tmp/render/`. That step is skipped when LibreOffice is not installed, which is the case on the GitHub runner.

Unit tests cover color, corner radius, coordinate conversion, rotation, text, glue, groups, freedraw, images, and libraries. Integration tests convert `test/fixtures/pi-audio-chain.excalidraw` and `test/fixtures/home-network.excalidraw` and check the package parts and page XML. Library tests cover upload parsing, splitting a library into items, PNG previews, and the HTTP API (search, download, Visio conversion, size limits, and the admin token).

## Project structure

```
cli/                 Command-line entry
src/                 Converter, geometry, colors, and the Visio package writer
src/library/         Upload parsing, JSON catalog, previews, and the access check
src/server/          HTTP API and static file server
web/                 Browser pages (Vite): convert, library, and upload
docker/              Container entrypoint. serve.mjs starts the compiled server
test/fixtures/       Sample drawings and a sample library
test/                Vitest tests
docs/DOCKER.md       Docker install, the library volume, and backup
docs/images/         Before/after preview images
Dockerfile           Multi-stage image (Node build, then Node 22 Alpine on port 8080)
docker-compose.yml   Publishes 8080, keeps the library volume, restarts unless stopped
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Issues and pull requests are welcome. The changelog is [CHANGELOG.md](CHANGELOG.md).

## License

MIT. Copyright (c) 2026 Justin Powell. See [LICENSE](LICENSE).
