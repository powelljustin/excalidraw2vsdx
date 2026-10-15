import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAccessPolicy } from "../src/library/access.js";
import { LibraryError } from "../src/library/errors.js";
import { filterLibraries } from "../src/library/filter.js";
import { assertUploadFilename, safePath } from "../src/library/paths.js";
import { splitLibraryDocument } from "../src/library/split.js";
import type { LibraryView } from "../src/library/view.js";

const rect = {
  id: "box",
  type: "rectangle",
  x: 10,
  y: 20,
  width: 80,
  height: 40,
  backgroundColor: "#ffc9c9",
  strokeColor: "#1e1e1e",
};

describe("splitLibraryDocument", () => {
  it("splits a v2 library into one item per entry", () => {
    const document = JSON.parse(readFileSync("test/fixtures/widgets.excalidrawlib", "utf8"));
    const split = splitLibraryDocument(document);
    expect(split.items.map((item) => item.name)).toEqual(["Router", "Database", "Choice"]);
    expect(split.libraryDocument.type).toBe("excalidrawlib");
    expect(split.libraryDocument.libraryItems).toHaveLength(3);
    const choice = split.items[2];
    expect(choice?.elements.some((element) => element.type === "diamond")).toBe(true);
    expect(choice?.elements.some((element) => element.type === "arrow")).toBe(true);
  });

  it("splits a v1 library of element arrays", () => {
    const split = splitLibraryDocument({
      type: "excalidrawlib",
      version: 1,
      library: [[rect], [{ ...rect, id: "other", type: "ellipse" }]],
    });
    expect(split.items).toHaveLength(2);
    expect(split.items[1]?.elements[0]?.type).toBe("ellipse");
    const single = split.items[0]?.libraryItem;
    expect(single?.elements).toHaveLength(1);
  });

  it("turns an .excalidraw scene into one item and names it from the first text", () => {
    const split = splitLibraryDocument({
      type: "excalidraw",
      version: 2,
      elements: [
        rect,
        { id: "label", type: "text", x: 0, y: 0, width: 40, height: 20, text: "Switch\nextra" },
      ],
    });
    expect(split.items).toHaveLength(1);
    expect(split.items[0]?.name).toBe("Switch");
  });

  it("keeps image files that an item references", () => {
    const split = splitLibraryDocument({
      type: "excalidrawlib",
      version: 2,
      libraryItems: [
        {
          id: "pic",
          elements: [{ ...rect, id: "img", type: "image", fileId: "file-1" }],
        },
      ],
      files: {
        "file-1": { id: "file-1", mimeType: "image/png", dataURL: "data:image/png;base64,aaaa" },
        "file-2": { id: "file-2", dataURL: "data:image/png;base64,bbbb" },
      },
    });
    expect(split.items[0]?.files["file-1"]?.dataURL).toContain("aaaa");
    expect(split.items[0]?.files["file-2"]).toBeUndefined();
  });

  it("rejects an empty library, a non-drawing, and too many items", () => {
    expect(() => splitLibraryDocument({ type: "excalidrawlib", version: 2, libraryItems: [] }))
      .toThrow(/no items/);
    expect(() => splitLibraryDocument({ type: "excalidraw", elements: [] })).toThrow(/no elements/);
    expect(() => splitLibraryDocument({ hello: "nope" })).toThrow(/Unrecognized/);
    const items = Array.from({ length: 401 }, () => ({ elements: [rect] }));
    expect(() => splitLibraryDocument({ type: "excalidrawlib", version: 2, libraryItems: items }))
      .toThrow(/at most 400/);
  });
});

describe("filenames and paths", () => {
  it("sanitizes upload names and refuses to leave the data directory", () => {
    expect(assertUploadFilename("../../etc/passwd.excalidraw")).toBe("passwd.excalidraw");
    expect(assertUploadFilename("my shapes.excalidrawlib")).toBe("my_shapes.excalidrawlib");
    expect(() => assertUploadFilename("notes.txt")).toThrow(LibraryError);
    expect(() => assertUploadFilename("foo.excalidraw/../../etc/passwd")).toThrow(LibraryError);

    const root = mkdtempSync(join(tmpdir(), "lib-path-"));
    expect(safePath(root, "libraries", "lib_0123456789abcdef")).toContain(root);
    expect(() => safePath(root, "..", "etc")).toThrow(LibraryError);
    expect(() => safePath(root, "libraries/../../etc")).toThrow(LibraryError);
  });
});

describe("filterLibraries", () => {
  const libraries: LibraryView[] = [
    {
      id: "lib_aaaaaaaaaaaaaaaa",
      name: "Office",
      description: "Desk layout",
      tags: ["room"],
      access: "free",
      locked: false,
      filename: "office.excalidrawlib",
      createdAt: "2026-10-14T00:00:00.000Z",
      updatedAt: "2026-10-14T00:00:00.000Z",
      itemCount: 2,
      downloadUrl: "/library",
      items: [
        item("item_aaaaaaaaaaaaaaaa", "Chair", ["seat"]),
        item("item_bbbbbbbbbbbbbbbb", "Lamp", []),
      ],
    },
  ];

  it("matches names and applies a library tag to every item", () => {
    expect(filterLibraries(libraries, { q: "chair" })[0]?.items.map((entry) => entry.name)).toEqual(["Chair"]);
    expect(filterLibraries(libraries, { q: "desk" })[0]?.items).toHaveLength(2);
    expect(filterLibraries(libraries, { tag: "room" })[0]?.items).toHaveLength(2);
    expect(filterLibraries(libraries, { tag: "seat" })[0]?.items.map((entry) => entry.name)).toEqual(["Chair"]);
    expect(filterLibraries(libraries, { q: "missing" })).toEqual([]);
  });
});

describe("access policy", () => {
  it("stays open until an admin token is set, and denies paid reads unless a check allows them", () => {
    const open = createAccessPolicy();
    expect(open.canUpload({ adminToken: null }).allowed).toBe(true);
    expect(open.canRead({ access: "free" }, { adminToken: null }).allowed).toBe(true);
    expect(open.canRead({ access: "paid" }, { adminToken: null }).allowed).toBe(false);

    const locked = createAccessPolicy({ adminToken: "s3cret" });
    expect(locked.canUpload({ adminToken: null }).status).toBe(401);
    expect(locked.canUpload({ adminToken: "nope" }).allowed).toBe(false);
    expect(locked.canUpload({ adminToken: "s3cret" }).allowed).toBe(true);
    expect(locked.canRead({ access: "paid" }, { adminToken: "s3cret" }).allowed).toBe(true);

    const paid = createAccessPolicy({ allowPaid: () => true });
    expect(paid.canRead({ access: "paid" }, { adminToken: null }).allowed).toBe(true);
  });
});

function item(id: string, name: string, tags: string[]): LibraryView["items"][number] {
  return {
    id,
    name,
    description: "",
    tags,
    access: "free",
    locked: false,
    elementCount: 1,
    previewUrl: "/preview",
    downloadUrl: "/download",
    vsdxUrl: "/vsdx",
  };
}
