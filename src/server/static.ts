import { createReadStream, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, resolve, sep } from "node:path";

const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".map": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

/** Serve a file from `root`, or 404. Refuses paths that escape `root`. */
export function serveStatic(req: IncomingMessage, res: ServerResponse, root: string): void {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "content-type": "text/plain; charset=utf-8", allow: "GET, HEAD" });
    res.end("Method not allowed");
    return;
  }
  const file = resolveFile(root, req.url || "/");
  if (!file) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  res.writeHead(200, {
    "content-type": types[extname(file).toLowerCase()] || "application/octet-stream",
    "cache-control": "no-cache",
    "x-content-type-options": "nosniff",
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
}

function resolveFile(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0] ?? "/");
  } catch {
    return null;
  }
  const relative = decoded.replace(/^[/\\]+/, "");
  const rootResolved = resolve(root);
  const full = resolve(rootResolved, relative);
  const rootPrefix = rootResolved.endsWith(sep) ? rootResolved : rootResolved + sep;
  if (full !== rootResolved && !full.startsWith(rootPrefix)) return null;
  try {
    const stat = statSync(full);
    const file = stat.isDirectory() ? join(full, "index.html") : full;
    if (!statSync(file).isFile()) return null;
    const fileResolved = resolve(file);
    if (fileResolved !== rootResolved && !fileResolved.startsWith(rootPrefix)) return null;
    return fileResolved;
  } catch {
    return null;
  }
}
