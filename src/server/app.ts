import type { IncomingHttpHeaders, IncomingMessage, RequestListener, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { convertExcalidraw } from "../convert.js";
import { ConvertError } from "../parse.js";
import { assertAllowed, type AccessContext, type AccessPolicy } from "../library/access.js";
import { LibraryError } from "../library/errors.js";
import { filterLibraries } from "../library/filter.js";
import {
  nameFromFilename,
  normalizeAccess,
  normalizeDescription,
  normalizeName,
  normalizeTags,
  isRecord,
} from "../library/fields.js";
import { assertItemId, assertLibraryId, downloadFilename, assertUploadFilename } from "../library/paths.js";
import { renderPreviewPng } from "../library/preview.js";
import { splitLibraryDocument } from "../library/split.js";
import { LibraryStore, type LibraryPatch, type StoredLibrary } from "../library/store.js";
import { toLibraryView, type ItemView, type LibraryView } from "../library/view.js";
import { serveStatic } from "./static.js";

export const DEFAULT_MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const LIBRARY_COLLECTION = /^\/api\/libraries$/;
const LIBRARY_ONE = /^\/api\/libraries\/(lib_[a-f0-9]{16})$/;
const LIBRARY_DOWNLOAD = /^\/api\/libraries\/(lib_[a-f0-9]{16})\/download$/;
const ITEM_ONE = /^\/api\/libraries\/(lib_[a-f0-9]{16})\/items\/(item_[a-f0-9]{16})$/;
const ITEM_PREVIEW = /^\/api\/libraries\/(lib_[a-f0-9]{16})\/items\/(item_[a-f0-9]{16})\/preview\.png$/;
const ITEM_DOWNLOAD = /^\/api\/libraries\/(lib_[a-f0-9]{16})\/items\/(item_[a-f0-9]{16})\/download$/;
const ITEM_VSDX = /^\/api\/libraries\/(lib_[a-f0-9]{16})\/items\/(item_[a-f0-9]{16})\/vsdx$/;

export interface AppOptions {
  dataDir: string;
  webRoot?: string | null;
  policy: AccessPolicy;
  maxUploadBytes?: number;
}

export function createApp(options: AppOptions): RequestListener {
  const store = new LibraryStore(options.dataDir);
  const policy = options.policy;
  const maxUploadBytes = options.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES;
  const webRoot = options.webRoot ? resolve(options.webRoot) : null;

  return (req, res) => {
    void handle(req, res).catch((error: unknown) => {
      if (error instanceof LibraryError) {
        sendJson(res, error.status, { error: error.message });
        return;
      }
      if (error instanceof ConvertError) {
        sendJson(res, 400, { error: error.message });
        return;
      }
      console.error(error);
      const message = error instanceof Error && error.message ? error.message : "Internal error.";
      sendJson(res, 500, { error: message.slice(0, 300) });
    });
  };

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    if (!webRoot) {
      sendText(res, 404, "Not found");
      return;
    }
    serveStatic(req, res, webRoot);
  }

  async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const ctx = accessContext(req);
    const path = url.pathname;
    const method = req.method || "GET";

    if (LIBRARY_COLLECTION.test(path)) {
      if (method === "GET") {
        const libraries = filterLibraries(visibleLibraries(ctx), {
          q: url.searchParams.get("q") ?? "",
          tag: url.searchParams.get("tag") ?? "",
        });
        sendJson(res, 200, { libraries });
        return;
      }
      if (method === "POST") {
        assertAllowed(policy.canUpload(ctx));
        const upload = await readUpload(req, url);
        const split = splitLibraryDocument(upload.document);
        const previews = split.items.map((item) => {
          try {
            return renderPreviewPng(item.elements, item.files).png;
          } catch (error) {
            const detail = error instanceof Error ? error.message : "render failed";
            throw new LibraryError(
              `Could not draw a preview for "${item.name}": ${detail.slice(0, 180)}`,
              500,
            );
          }
        });
        const stored = store.add({
          filename: upload.filename,
          name: upload.name,
          description: upload.description,
          tags: upload.tags,
          access: upload.access,
          sourceJson: upload.sourceJson,
          items: split.items,
          previews,
        });
        sendJson(res, 201, { library: visibleView(stored, ctx) });
        return;
      }
      sendText(res, 405, "Method not allowed");
      return;
    }

    const libraryDownload = LIBRARY_DOWNLOAD.exec(path);
    if (libraryDownload) {
      if (method !== "GET") return sendText(res, 405, "Method not allowed");
      const { stored } = requireLibrary(libraryDownload[1], ctx);
      const filename = stored.filename.toLowerCase().endsWith(".excalidrawlib")
        ? stored.filename
        : downloadFilename(stored.name, ".excalidrawlib");
      sendBytes(
        res,
        readStored(() => store.readLibraryFile(stored.id)),
        "application/json; charset=utf-8",
        filename,
      );
      return;
    }

    const preview = ITEM_PREVIEW.exec(path);
    if (preview) {
      if (method !== "GET") return sendText(res, 405, "Method not allowed");
      const { item } = requireItem(preview[1], preview[2], ctx);
      sendBytes(
        res,
        readStored(() => store.readPreview(preview[1], item.id)),
        "image/png",
        undefined,
        "public, max-age=86400",
      );
      return;
    }

    const itemDownload = ITEM_DOWNLOAD.exec(path);
    if (itemDownload) {
      if (method !== "GET") return sendText(res, 405, "Method not allowed");
      const { item } = requireItem(itemDownload[1], itemDownload[2], ctx);
      sendBytes(
        res,
        readStored(() => store.readItemFile(itemDownload[1], item.id)),
        "application/json; charset=utf-8",
        downloadFilename(item.name, ".excalidrawlib"),
      );
      return;
    }

    const vsdx = ITEM_VSDX.exec(path);
    if (vsdx) {
      if (method !== "GET") return sendText(res, 405, "Method not allowed");
      const { item } = requireItem(vsdx[1], vsdx[2], ctx);
      const json = readStored(() => store.readItemFile(vsdx[1], item.id)).toString("utf8");
      const result = convertExcalidraw(json, { title: item.name });
      sendBytes(
        res,
        Buffer.from(result.vsdx),
        "application/vnd.ms-visio.drawing",
        downloadFilename(item.name, ".vsdx"),
      );
      return;
    }

    const itemOne = ITEM_ONE.exec(path);
    if (itemOne) {
      if (method !== "PATCH") return sendText(res, 405, "Method not allowed");
      assertAllowed(policy.canWrite(ctx));
      const stored = store.get(itemOne[1]);
      if (!stored) throw new LibraryError("Library not found.", 404);
      if (!stored.items.some((item) => item.id === itemOne[2])) {
        throw new LibraryError("Item not found.", 404);
      }
      const patch = await readPatch(req);
      const updated = store.updateItem(itemOne[1], itemOne[2], patch);
      sendJson(res, 200, { library: visibleView(updated, ctx) });
      return;
    }

    const libraryOne = LIBRARY_ONE.exec(path);
    if (libraryOne) {
      if (method === "GET") {
        const stored = store.get(libraryOne[1]);
        if (!stored) throw new LibraryError("Library not found.", 404);
        sendJson(res, 200, { library: visibleView(stored, ctx) });
        return;
      }
      if (method === "PATCH") {
        assertAllowed(policy.canWrite(ctx));
        if (!store.get(libraryOne[1])) throw new LibraryError("Library not found.", 404);
        const patch = await readPatch(req);
        const updated = store.updateLibrary(libraryOne[1], patch);
        sendJson(res, 200, { library: visibleView(updated, ctx) });
        return;
      }
      if (method === "DELETE") {
        assertAllowed(policy.canWrite(ctx));
        if (!store.get(libraryOne[1])) throw new LibraryError("Library not found.", 404);
        store.remove(libraryOne[1]);
        sendJson(res, 200, { ok: true });
        return;
      }
      sendText(res, 405, "Method not allowed");
      return;
    }

    if (path.startsWith("/api/libraries/")) {
      sendJson(res, 404, { error: "Library not found." });
      return;
    }
    sendJson(res, 404, { error: "Not found." });
  }

  function visibleLibraries(ctx: AccessContext): LibraryView[] {
    return store.list().map((library) => visibleView(library, ctx));
  }

  function visibleView(library: StoredLibrary, ctx: AccessContext): LibraryView {
    const view = toLibraryView(library);
    const libraryOpen = policy.canRead({ access: library.access }, ctx).allowed;
    if (!libraryOpen) {
      view.locked = true;
      view.downloadUrl = "";
    }
    view.items = view.items.map((item) => {
      if (libraryOpen && policy.canRead({ access: item.access }, ctx).allowed) return item;
      return { ...item, locked: true, previewUrl: "", downloadUrl: "", vsdxUrl: "" };
    });
    return view;
  }

  function requireLibrary(id: string, ctx: AccessContext): { stored: StoredLibrary } {
    assertLibraryId(id);
    const stored = store.get(id);
    if (!stored) throw new LibraryError("Library not found.", 404);
    assertAllowed(policy.canRead({ access: stored.access }, ctx));
    return { stored };
  }

  function requireItem(libraryId: string, itemId: string, ctx: AccessContext): { item: ItemView } {
    assertItemId(itemId);
    const { stored } = requireLibrary(libraryId, ctx);
    const item = toLibraryView(stored).items.find((entry) => entry.id === itemId);
    if (!item) throw new LibraryError("Item not found.", 404);
    assertAllowed(policy.canRead({ access: item.access }, ctx));
    return { item };
  }

  async function readUpload(req: IncomingMessage, url: URL): Promise<ResolvedUpload> {
    assertJson(req);
    const raw = (await readBody(req, maxUploadBytes)).toString("utf8");
    return resolveUpload(raw, req.headers, url);
  }

  async function readPatch(req: IncomingMessage): Promise<LibraryPatch> {
    assertJson(req);
    const raw = (await readBody(req, 64 * 1024)).toString("utf8");
    let body: unknown;
    try {
      body = JSON.parse(raw.replace(/^\uFEFF/, ""));
    } catch {
      throw new LibraryError("The request body is not valid JSON.");
    }
    if (!isRecord(body)) throw new LibraryError("The request body must be a JSON object.");
    return body;
  }
}

interface ResolvedUpload {
  filename: string;
  name: string;
  description: string;
  tags: string[];
  access: ReturnType<typeof normalizeAccess>;
  document: unknown;
  sourceJson: string;
}

export function resolveUpload(raw: string, headers: IncomingHttpHeaders, url: URL): ResolvedUpload {
  const text = raw.replace(/^\uFEFF/, "").trim();
  if (!text) throw new LibraryError("The request body is empty.");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new LibraryError("The request body is not valid JSON.");
  }
  if (isRawExcalidraw(body)) {
    const filename = assertUploadFilename(meta(headers, url, "x-filename", "filename") || "library.excalidrawlib");
    return {
      filename,
      name: normalizeName(meta(headers, url, "x-library-name", "name"), nameFromFilename(filename)),
      description: normalizeDescription(meta(headers, url, "x-library-description", "description") ?? ""),
      tags: normalizeTags(meta(headers, url, "x-library-tags", "tags") ?? ""),
      access: normalizeAccess(meta(headers, url, "x-library-access", "access")),
      document: body,
      sourceJson: text.endsWith("\n") ? text : `${text}\n`,
    };
  }
  if (!isRecord(body)) throw new LibraryError("The request body must be a JSON object.");
  const filename = assertUploadFilename(
    typeof body.filename === "string" ? body.filename : meta(headers, url, "x-filename", "filename") || "",
  );
  if (!("document" in body)) throw new LibraryError("The upload must include the Excalidraw document.");
  const documentText = `${JSON.stringify(body.document, null, 2)}\n`;
  return {
    filename,
    name: normalizeName(body.name, nameFromFilename(filename)),
    description: normalizeDescription(body.description ?? ""),
    tags: normalizeTags(body.tags ?? ""),
    access: normalizeAccess(body.access),
    document: body.document,
    sourceJson: documentText,
  };
}

function isRawExcalidraw(body: unknown): boolean {
  if (Array.isArray(body)) return true;
  if (!isRecord(body) || "document" in body) return false;
  const type = typeof body.type === "string" ? body.type : "";
  return (
    type === "excalidraw" ||
    type === "excalidrawlib" ||
    Array.isArray(body.elements) ||
    Array.isArray(body.libraryItems) ||
    Array.isArray(body.library)
  );
}

function meta(headers: IncomingHttpHeaders, url: URL, headerName: string, queryName: string): string | null {
  const header = headers[headerName];
  if (typeof header === "string" && header.trim()) return header.trim();
  if (Array.isArray(header) && header[0]?.trim()) return header[0].trim();
  const query = url.searchParams.get(queryName);
  return query?.trim() ? query.trim() : null;
}

function accessContext(req: IncomingMessage): AccessContext {
  const header = req.headers["x-admin-token"];
  if (typeof header === "string" && header.trim()) return { adminToken: header.trim() };
  const authorization = req.headers.authorization;
  if (typeof authorization === "string" && /^bearer\s+/i.test(authorization)) {
    const token = authorization.replace(/^bearer\s+/i, "").trim();
    if (token) return { adminToken: token };
  }
  return { adminToken: null };
}

function assertJson(req: IncomingMessage): void {
  const header = req.headers["content-type"];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value || !value.toLowerCase().startsWith("application/json")) {
    throw new LibraryError("Send the request as application/json.", 415);
  }
}

function readBody(req: IncomingMessage, max: number): Promise<Buffer> {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (Number.isFinite(declared) && declared > max) {
    req.resume();
    return Promise.reject(new LibraryError("Upload is too large.", 413));
  }
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let failed = false;
    req.on("data", (chunk: Buffer) => {
      if (failed) return;
      total += chunk.length;
      if (total > max) {
        failed = true;
        req.pause();
        reject(new LibraryError("Upload is too large.", 413));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!failed) resolveBody(Buffer.concat(chunks));
    });
    req.on("error", (error) => {
      if (!failed) reject(error);
    });
  });
}

function readStored(read: () => Buffer): Buffer {
  try {
    return read();
  } catch (error) {
    const code = isRecord(error) && typeof error.code === "string" ? error.code : "";
    if (code === "ENOENT") throw new LibraryError("File not found.", 404);
    throw error;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.writableEnded || res.headersSent) return;
  const raw = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(raw.length),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(raw);
}

function sendText(res: ServerResponse, status: number, message: string): void {
  if (res.writableEnded || res.headersSent) return;
  const raw = Buffer.from(message);
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "content-length": String(raw.length),
    "x-content-type-options": "nosniff",
  });
  res.end(raw);
}

function sendBytes(
  res: ServerResponse,
  body: Buffer,
  contentType: string,
  filename?: string,
  cache = "no-store",
): void {
  if (res.writableEnded || res.headersSent) return;
  const headers: Record<string, string | number> = {
    "content-type": contentType,
    "content-length": body.length,
    "cache-control": cache,
    "x-content-type-options": "nosniff",
  };
  if (filename) headers["content-disposition"] = contentDisposition(filename);
  res.writeHead(200, headers);
  res.end(body);
}

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
  return `attachment; filename="${ascii}"`;
}
