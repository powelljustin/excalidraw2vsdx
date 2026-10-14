import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import type { AccessLevel } from "./access.js";
import { LibraryError } from "./errors.js";
import { isRecord, normalizeAccess, normalizeDescription, normalizeName, normalizeTags } from "./fields.js";
import { assertItemId, assertLibraryId, LIBRARY_ID, safePath } from "./paths.js";
import { singleItemDocument, type SplitItem } from "./split.js";

/**
 * Metadata lives in `index.json` inside the data directory.
 *
 * better-sqlite3 is a native addon. Its musl builds, especially linux/arm64
 * on node:22-alpine, need a compiler toolchain and still fail in some images.
 * A JSON file is one document, easy to back up, and has no native dependency.
 * The process is single-threaded and writes the file by renaming a temp file,
 * so a crash cannot leave a half-written index.
 */
export interface StoredItem {
  id: string;
  name: string;
  description: string;
  tags: string[];
  access: AccessLevel;
  elementCount: number;
}

export interface StoredLibrary {
  id: string;
  name: string;
  description: string;
  tags: string[];
  access: AccessLevel;
  filename: string;
  createdAt: string;
  updatedAt: string;
  items: StoredItem[];
}

interface IndexFile {
  version: 1;
  libraries: StoredLibrary[];
}

export interface NewLibrary {
  filename: string;
  name: string;
  description: string;
  tags: string[];
  access: AccessLevel;
  sourceJson: string;
  items: SplitItem[];
  previews: Buffer[];
}

export interface LibraryPatch {
  name?: unknown;
  description?: unknown;
  tags?: unknown;
  access?: unknown;
}

export class LibraryStore {
  private index: IndexFile;

  constructor(private readonly root: string) {
    mkdirSync(this.root, { recursive: true });
    this.index = loadIndex(safePath(this.root, "index.json"));
  }

  list(): StoredLibrary[] {
    return this.index.libraries.map(cloneLibrary);
  }

  get(id: string): StoredLibrary | null {
    assertLibraryId(id);
    const found = this.index.libraries.find((library) => library.id === id);
    return found ? cloneLibrary(found) : null;
  }

  add(input: NewLibrary): StoredLibrary {
    if (input.previews.length !== input.items.length) {
      throw new LibraryError("Each library item needs one preview.", 500);
    }
    const reserved = new Set<string>();
    const id = this.freshId("lib", reserved);
    const dir = safePath(this.root, "libraries", id);
    mkdirSync(safePath(dir, "items"), { recursive: true });
    try {
      const now = new Date().toISOString();
      const items: StoredItem[] = input.items.map((item, index) => {
        const itemId = this.freshId("item", reserved);
        const preview = input.previews[index];
        if (!preview) throw new LibraryError("Missing preview image.", 500);
        writeFileSync(safePath(dir, "items", `${itemId}.png`), preview);
        writeFileSync(
          safePath(dir, "items", `${itemId}.excalidrawlib`),
          pretty(singleItemDocument(item)),
        );
        const elementCount = item.elements.filter((element) => !element.isDeleted).length;
        return {
          id: itemId,
          name: item.name,
          description: "",
          tags: [...input.tags],
          access: input.access,
          elementCount,
        };
      });
      writeFileSync(safePath(dir, "source.json"), input.sourceJson.endsWith("\n") ? input.sourceJson : `${input.sourceJson}\n`);
      const record: StoredLibrary = {
        id,
        name: input.name,
        description: input.description,
        tags: input.tags,
        access: input.access,
        filename: input.filename,
        createdAt: now,
        updatedAt: now,
        items,
      };
      this.writeBundle(record);
      this.index.libraries.unshift(record);
      try {
        this.saveIndex();
      } catch (error) {
        this.index.libraries.shift();
        throw error;
      }
      return cloneLibrary(record);
    } catch (error) {
      rmSync(dir, { recursive: true, force: true });
      throw error;
    }
  }

  updateLibrary(id: string, patch: LibraryPatch): StoredLibrary {
    const library = this.require(id);
    applyPatch(library, patch);
    library.updatedAt = new Date().toISOString();
    this.saveIndex();
    return cloneLibrary(library);
  }

  updateItem(libraryId: string, itemId: string, patch: LibraryPatch): StoredLibrary {
    const library = this.require(libraryId);
    assertItemId(itemId);
    const item = library.items.find((entry) => entry.id === itemId);
    if (!item) throw new LibraryError("Item not found.", 404);
    const next = { ...item, tags: [...item.tags] };
    applyPatch(next, patch);
    if (next.name !== item.name) this.renameItemFile(library, item.id, next.name);
    item.name = next.name;
    item.description = next.description;
    item.tags = next.tags;
    item.access = next.access;
    library.updatedAt = new Date().toISOString();
    this.saveIndex();
    return cloneLibrary(library);
  }

  remove(id: string): void {
    assertLibraryId(id);
    const index = this.index.libraries.findIndex((library) => library.id === id);
    if (index < 0) throw new LibraryError("Library not found.", 404);
    const [removed] = this.index.libraries.splice(index, 1);
    this.saveIndex();
    if (removed && LIBRARY_ID.test(removed.id)) {
      rmSync(safePath(this.root, "libraries", removed.id), { recursive: true, force: true });
    }
  }

  readLibraryFile(id: string): Buffer {
    assertLibraryId(id);
    return readFileSync(safePath(this.root, "libraries", id, "library.excalidrawlib"));
  }

  readItemFile(libraryId: string, itemId: string): Buffer {
    assertLibraryId(libraryId);
    assertItemId(itemId);
    return readFileSync(safePath(this.root, "libraries", libraryId, "items", `${itemId}.excalidrawlib`));
  }

  readPreview(libraryId: string, itemId: string): Buffer {
    assertLibraryId(libraryId);
    assertItemId(itemId);
    return readFileSync(safePath(this.root, "libraries", libraryId, "items", `${itemId}.png`));
  }

  private require(id: string): StoredLibrary {
    assertLibraryId(id);
    const library = this.index.libraries.find((entry) => entry.id === id);
    if (!library) throw new LibraryError("Library not found.", 404);
    return library;
  }

  private renameItemFile(library: StoredLibrary, itemId: string, name: string): void {
    const file = safePath(this.root, "libraries", library.id, "items", `${itemId}.excalidrawlib`);
    const document = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    const items = document.libraryItems;
    if (Array.isArray(items) && isRecord(items[0])) items[0].name = name;
    writeFileSync(file, pretty(document));
    this.writeBundle(library);
  }

  private writeBundle(library: StoredLibrary): void {
    const libraryItems = library.items.map((item) => {
      const file = safePath(this.root, "libraries", library.id, "items", `${item.id}.excalidrawlib`);
      const document = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
      const items = document.libraryItems;
      if (!Array.isArray(items) || !isRecord(items[0])) {
        throw new LibraryError("Stored library item is unreadable.", 500);
      }
      return items[0];
    });
    const bundle: Record<string, unknown> = {
      type: "excalidrawlib",
      version: 2,
      source: "https://excalidraw.com",
      libraryItems,
    };
    writeFileSync(safePath(this.root, "libraries", library.id, "library.excalidrawlib"), pretty(bundle));
  }

  private freshId(prefix: "lib" | "item", reserved: Set<string>): string {
    const taken = new Set<string>(reserved);
    for (const library of this.index.libraries) {
      taken.add(library.id);
      for (const item of library.items) taken.add(item.id);
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const id = `${prefix}_${randomBytes(8).toString("hex")}`;
      if (!taken.has(id)) {
        reserved.add(id);
        return id;
      }
    }
    throw new LibraryError("Could not allocate an id.", 500);
  }

  private saveIndex(): void {
    const file = safePath(this.root, "index.json");
    const tmp = safePath(this.root, "index.json.tmp");
    writeFileSync(tmp, pretty(this.index));
    renameSync(tmp, file);
  }
}

function applyPatch(
  target: { name: string; description: string; tags: string[]; access: AccessLevel },
  patch: LibraryPatch,
): void {
  const keys = ["name", "description", "tags", "access"].filter((key) => key in patch);
  if (keys.length === 0) throw new LibraryError("Nothing to update.");
  if ("name" in patch) target.name = normalizeName(patch.name, "");
  if ("description" in patch) target.description = normalizeDescription(patch.description);
  if ("tags" in patch) target.tags = normalizeTags(patch.tags);
  if ("access" in patch) target.access = normalizeAccess(patch.access);
}

function loadIndex(file: string): IndexFile {
  if (!existsSync(file)) return { version: 1, libraries: [] };
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new Error(`Library index is not valid JSON (${file}). Refusing to overwrite it.`);
  }
  if (!isRecord(data) || data.version !== 1 || !Array.isArray(data.libraries)) {
    throw new Error(`Library index has an unexpected shape (${file}). Refusing to overwrite it.`);
  }
  for (const library of data.libraries) {
    if (!isStoredLibrary(library)) {
      throw new Error(`Library index has an unreadable library (${file}). Refusing to overwrite it.`);
    }
  }
  return { version: 1, libraries: data.libraries as StoredLibrary[] };
}

function isStoredLibrary(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || !LIBRARY_ID.test(value.id)) return false;
  if (typeof value.name !== "string" || !Array.isArray(value.items)) return false;
  return value.items.every((item) => isRecord(item) && typeof item.id === "string" && typeof item.name === "string");
}

function cloneLibrary(library: StoredLibrary): StoredLibrary {
  return {
    ...library,
    tags: [...library.tags],
    items: library.items.map((item) => ({ ...item, tags: [...item.tags] })),
  };
}

function pretty(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
