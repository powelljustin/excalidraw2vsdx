import type { ExcalidrawElement } from "../types.js";
import { LibraryError } from "./errors.js";
import { isRecord } from "./fields.js";

export const MAX_LIBRARY_ITEMS = 400;
export const MAX_ELEMENTS_PER_ITEM = 5000;
export const MAX_ELEMENTS_TOTAL = 20000;

export interface SplitItem {
  name: string;
  elements: ExcalidrawElement[];
  files: Record<string, PreviewFile>;
  libraryItem: Record<string, unknown>;
}

export interface PreviewFile {
  id?: string;
  mimeType?: string;
  dataURL?: string;
}

export interface SplitResult {
  items: SplitItem[];
  /** Normalized `.excalidrawlib` document containing every item. */
  libraryDocument: Record<string, unknown>;
}

/**
 * Turn an uploaded Excalidraw scene or library into one record per item.
 * A `.excalidraw` scene becomes a single item. A library becomes one item
 * per entry in `libraryItems` (v2) or `library` (v1).
 */
export function splitLibraryDocument(document: unknown): SplitResult {
  const data = unwrapDocument(document);
  const items = itemsFromDocument(data);
  if (items.length === 0) {
    throw new LibraryError("The file has no library items.");
  }
  if (items.length > MAX_LIBRARY_ITEMS) {
    throw new LibraryError(`A library can have at most ${MAX_LIBRARY_ITEMS} items.`);
  }
  const total = items.reduce((sum, item) => sum + item.elements.length, 0);
  if (total > MAX_ELEMENTS_TOTAL) {
    throw new LibraryError(`A library can have at most ${MAX_ELEMENTS_TOTAL} elements.`);
  }

  const source = !Array.isArray(data) && typeof data.source === "string" && data.source.length <= 300
    ? data.source
    : "https://excalidraw.com";
  const libraryDocument: Record<string, unknown> = {
    type: "excalidrawlib",
    version: 2,
    source,
    libraryItems: items.map((item) => item.libraryItem),
  };
  const files = mergedFiles(items);
  if (files) libraryDocument.files = files;
  return { items, libraryDocument };
}

export function singleItemDocument(item: SplitItem): Record<string, unknown> {
  const document: Record<string, unknown> = {
    type: "excalidrawlib",
    version: 2,
    source: "https://excalidraw.com",
    libraryItems: [item.libraryItem],
  };
  if (Object.keys(item.files).length > 0) document.files = item.files;
  return document;
}

function unwrapDocument(document: unknown): Record<string, unknown> | unknown[] {
  let data = document;
  if (typeof data === "string") {
    const trimmed = data.replace(/^\uFEFF/, "").trim();
    if (!trimmed) throw new LibraryError("The Excalidraw file is empty.");
    try {
      data = JSON.parse(trimmed);
    } catch {
      throw new LibraryError("The file is not valid JSON.");
    }
  }
  if (Array.isArray(data)) return data;
  if (!isRecord(data)) {
    throw new LibraryError("Expected an Excalidraw JSON object or array.");
  }
  return data;
}

function itemsFromDocument(data: Record<string, unknown> | unknown[]): SplitItem[] {
  if (Array.isArray(data)) return itemsFromArray(data, {});
  if (isLibraryDocument(data)) {
    const rawItems = (data.libraryItems ?? data.library) as unknown;
    if (!Array.isArray(rawItems)) {
      throw new LibraryError("Library file has no libraryItems array.");
    }
    if (rawItems.length === 0) throw new LibraryError("This library has no items.");
    const parentFiles = asFilePool(data.files);
    return rawItems.map((item, index) => toItem(item, index, parentFiles));
  }
  if (Array.isArray(data.elements)) {
    return [sceneToItem(data)];
  }
  throw new LibraryError(
    "Unrecognized Excalidraw JSON. Expected a scene with elements, or an .excalidrawlib library.",
  );
}

function itemsFromArray(data: unknown[], parentFiles: Record<string, unknown>): SplitItem[] {
  if (data.length === 0) throw new LibraryError("The file has no elements.");
  if (data.every(isElement)) return [elementsToItem(data.filter(isElement), 0, parentFiles, {})];
  if (data.every((item) => Array.isArray(item))) {
    return data.map((item, index) => toItem(item, index, parentFiles));
  }
  return data.map((item, index) => toItem(item, index, parentFiles));
}

function isLibraryDocument(data: Record<string, unknown>): boolean {
  const type = typeof data.type === "string" ? data.type : "";
  return type === "excalidrawlib" || Array.isArray(data.libraryItems) || Array.isArray(data.library);
}

function sceneToItem(data: Record<string, unknown>): SplitItem {
  const elements = Array.isArray(data.elements) ? data.elements.filter(isElement) : [];
  if (elements.length === 0) throw new LibraryError("This drawing has no elements.");
  const hint = typeof data.name === "string" ? data.name : "";
  return elementsToItem(elements, 0, asFilePool(data.files), {}, hint);
}

function toItem(
  raw: unknown,
  index: number,
  parentFiles: Record<string, unknown>,
): SplitItem {
  if (Array.isArray(raw)) {
    return elementsToItem(raw.filter(isElement), index, parentFiles, {});
  }
  if (!isRecord(raw)) {
    throw new LibraryError(`Library item ${index + 1} is not an object.`);
  }
  const elements = Array.isArray(raw.elements) ? raw.elements.filter(isElement) : [];
  const hint = typeof raw.name === "string" ? raw.name : "";
  return elementsToItem(elements, index, parentFiles, asFilePool(raw.files), hint, copyRecord(raw));
}

function elementsToItem(
  elements: ExcalidrawElement[],
  index: number,
  parentFiles: Record<string, unknown>,
  itemFiles: Record<string, unknown>,
  hint = "",
  base: Record<string, unknown> = {},
): SplitItem {
  if (elements.length === 0) {
    throw new LibraryError(`Library item ${index + 1} has no elements.`);
  }
  if (elements.length > MAX_ELEMENTS_PER_ITEM) {
    throw new LibraryError(
      `Library item ${index + 1} has more than ${MAX_ELEMENTS_PER_ITEM} elements.`,
    );
  }
  const name = (hint.trim() || inferName(elements, index)).replace(/\s+/g, " ").slice(0, 120);
  const files = collectFiles(elements, [itemFiles, parentFiles]);
  const libraryItem: Record<string, unknown> = {
    ...base,
    id: typeof base.id === "string" && base.id.trim() ? base.id : `item-${index + 1}`,
    status: base.status === "unpublished" ? "unpublished" : "published",
    created: typeof base.created === "number" ? base.created : Date.now(),
    name,
    elements,
  };
  delete libraryItem.library;
  delete libraryItem.libraryItems;
  if (Object.keys(files).length > 0) libraryItem.files = files;
  return { name, elements, files, libraryItem };
}

function inferName(elements: ExcalidrawElement[], index: number): string {
  const text = elements.find(
    (element) =>
      element.type === "text" &&
      !element.isDeleted &&
      typeof element.text === "string" &&
      element.text.trim().length > 0,
  );
  if (text?.text) {
    const line = text.text.split(/\r?\n/, 1)[0]?.trim() ?? "";
    if (line) return line.slice(0, 120);
  }
  return `Item ${index + 1}`;
}

function isElement(value: unknown): value is ExcalidrawElement {
  if (!isRecord(value)) return false;
  if (typeof value.type !== "string" || value.type.length === 0) return false;
  if (typeof value.x !== "number" || typeof value.y !== "number") return false;
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) return false;
  return true;
}

function asFilePool(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  return copyRecord(value);
}

function collectFiles(
  elements: ExcalidrawElement[],
  pools: Array<Record<string, unknown>>,
): Record<string, PreviewFile> {
  const ids = new Set<string>();
  for (const element of elements) {
    if (typeof element.fileId === "string" && element.fileId) ids.add(element.fileId);
  }
  const files: Record<string, PreviewFile> = {};
  for (const id of ids) {
    for (const pool of pools) {
      const entry = pool[id];
      if (!isRecord(entry)) continue;
      files[id] = {
        id: typeof entry.id === "string" ? entry.id : id,
        mimeType: typeof entry.mimeType === "string" ? entry.mimeType : undefined,
        dataURL: typeof entry.dataURL === "string" ? entry.dataURL : undefined,
      };
      break;
    }
  }
  return files;
}

function mergedFiles(items: SplitItem[]): Record<string, PreviewFile> | undefined {
  const files: Record<string, PreviewFile> = {};
  for (const item of items) Object.assign(files, item.files);
  return Object.keys(files).length > 0 ? files : undefined;
}

function copyRecord(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    out[key] = entry;
  }
  return out;
}
