import type {
  ExcalidrawElement,
  ExcalidrawFileData,
  ExcalidrawScene,
  LibraryItem,
} from "./types.js";

export class ConvertError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConvertError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isElement(value: unknown): value is ExcalidrawElement {
  if (!isRecord(value)) return false;
  return (
    typeof value.type === "string" &&
    typeof value.id === "string" &&
    typeof value.x === "number" &&
    typeof value.y === "number"
  );
}

function asFiles(value: unknown): Record<string, ExcalidrawFileData> {
  if (!isRecord(value)) return {};
  const files: Record<string, ExcalidrawFileData> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isRecord(entry)) continue;
    files[key] = {
      id: typeof entry.id === "string" ? entry.id : key,
      mimeType: typeof entry.mimeType === "string" ? entry.mimeType : undefined,
      dataURL: typeof entry.dataURL === "string" ? entry.dataURL : undefined,
    };
  }
  return files;
}

function sceneFromElements(
  name: string,
  elements: ExcalidrawElement[],
  files: Record<string, ExcalidrawFileData>,
): ExcalidrawScene {
  return { name, elements, files };
}

/**
 * Accept an Excalidraw scene, an `.excalidrawlib` library (v1 or v2),
 * a bare element array, or a legacy library (array of element arrays).
 * Each library item becomes its own Visio page.
 */
export function parseExcalidraw(input: string | unknown): ExcalidrawScene[] {
  let data: unknown = input;
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) throw new ConvertError("The Excalidraw file is empty.");
    try {
      data = JSON.parse(trimmed);
    } catch {
      throw new ConvertError("The file is not valid JSON.");
    }
  }

  if (Array.isArray(data)) {
    if (data.length === 0) {
      return [sceneFromElements("Page-1", [], {})];
    }
    if (data.every(isElement)) {
      return [sceneFromElements("Page-1", data, {})];
    }
    if (data.every((item) => Array.isArray(item))) {
      return data.map((item, index) =>
        sceneFromElements(
          `Item ${index + 1}`,
          (item as unknown[]).filter(isElement),
          {},
        ),
      );
    }
    return data.map((item, index) => libraryItemToScene(item, index, {}));
  }

  if (!isRecord(data)) {
    throw new ConvertError("Expected an Excalidraw JSON object or array.");
  }

  const files = asFiles(data.files);
  const type = typeof data.type === "string" ? data.type : "";

  if (type === "excalidrawlib" || Array.isArray(data.libraryItems) || Array.isArray(data.library)) {
    const items = (data.libraryItems ?? data.library) as unknown;
    if (!Array.isArray(items)) {
      throw new ConvertError("Library file has no libraryItems array.");
    }
    if (items.length === 0) return [sceneFromElements("Library", [], files)];
    return items.map((item, index) => libraryItemToScene(item, index, files));
  }

  if (Array.isArray(data.elements)) {
    const elements = data.elements.filter(isElement);
    return [sceneFromElements("Page-1", elements, files)];
  }

  throw new ConvertError(
    "Unrecognized Excalidraw JSON. Expected a scene with elements, or an .excalidrawlib library.",
  );
}

function libraryItemToScene(
  item: unknown,
  index: number,
  parentFiles: Record<string, ExcalidrawFileData>,
): ExcalidrawScene {
  if (Array.isArray(item)) {
    return sceneFromElements(
      `Item ${index + 1}`,
      item.filter(isElement),
      parentFiles,
    );
  }
  if (!isRecord(item)) {
    return sceneFromElements(`Item ${index + 1}`, [], parentFiles);
  }
  const lib = item as LibraryItem & Record<string, unknown>;
  const elements = Array.isArray(lib.elements) ? lib.elements.filter(isElement) : [];
  const name =
    typeof lib.name === "string" && lib.name.trim()
      ? lib.name.trim()
      : `Item ${index + 1}`;
  const files = { ...parentFiles, ...asFiles(lib.files) };
  return sceneFromElements(name, elements, files);
}
