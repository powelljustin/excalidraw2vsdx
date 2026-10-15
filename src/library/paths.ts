import { resolve, sep } from "node:path";
import { LibraryError } from "./errors.js";

export const LIBRARY_ID = /^lib_[a-f0-9]{16}$/;
export const ITEM_ID = /^item_[a-f0-9]{16}$/;

export function assertLibraryId(id: string): string {
  if (!LIBRARY_ID.test(id)) throw new LibraryError("Invalid library id.", 400);
  return id;
}

export function assertItemId(id: string): string {
  if (!ITEM_ID.test(id)) throw new LibraryError("Invalid item id.", 400);
  return id;
}

/**
 * Join segments onto `root` and refuse anything that would leave that directory.
 * Segments must be single path components we generated or checked ourselves.
 */
export function safePath(root: string, ...segments: string[]): string {
  for (const segment of segments) {
    if (
      segment.length === 0 ||
      segment === "." ||
      segment === ".." ||
      segment.includes("/") ||
      segment.includes("\\") ||
      segment.includes("\0")
    ) {
      throw new LibraryError("Invalid path.", 400);
    }
  }
  const rootResolved = resolve(root);
  const full = resolve(rootResolved, ...segments);
  const prefix = rootResolved.endsWith(sep) ? rootResolved : rootResolved + sep;
  if (full !== rootResolved && !full.startsWith(prefix)) {
    throw new LibraryError("Invalid path.", 400);
  }
  return full;
}

/** Keep a user-supplied file name as a label. It is never used as a disk path. */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "";
  const cleaned = base
    .replace(/\0/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^[._]+/, "")
    .slice(0, 80);
  if (!cleaned) return "library.excalidrawlib";
  if (!/\.(excalidrawlib|excalidraw|json)$/i.test(cleaned)) {
    return `${cleaned}.excalidrawlib`;
  }
  return cleaned;
}

export function assertUploadFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "";
  if (!/\.(excalidrawlib|excalidraw|json)$/i.test(base)) {
    throw new LibraryError("Upload an .excalidrawlib, .excalidraw, or .json file.");
  }
  return sanitizeFilename(base);
}

/** ASCII download name with a fixed extension. */
export function downloadFilename(name: string, extension: ".excalidrawlib" | ".vsdx"): string {
  const stripped = name
    .replace(/\.(excalidrawlib|excalidraw|json|vsdx)$/i, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^[._]+/, "")
    .slice(0, 80);
  return `${stripped || "library"}${extension}`;
}
