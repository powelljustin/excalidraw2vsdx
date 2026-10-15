import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createAccessPolicy } from "../library/access.js";
import { createApp, DEFAULT_MAX_UPLOAD_BYTES } from "./app.js";

export interface RunningServer {
  port: number;
  close: () => Promise<void>;
}

export function startServerFromEnv(): Promise<RunningServer> {
  const port = Number(process.env.PORT || 8080);
  const host = process.env.HOST || "0.0.0.0";
  const webRoot = resolve(process.env.WEB_ROOT || "dist-web");
  const dataDir = resolve(process.env.DATA_DIR || "data/library");
  const adminToken = process.env.ADMIN_TOKEN?.trim() || null;
  const maxUploadBytes = process.env.MAX_UPLOAD_BYTES
    ? Number(process.env.MAX_UPLOAD_BYTES)
    : DEFAULT_MAX_UPLOAD_BYTES;
  if (!Number.isFinite(port) || port <= 0) throw new Error("PORT must be a positive number.");
  if (!Number.isFinite(maxUploadBytes) || maxUploadBytes <= 0) {
    throw new Error("MAX_UPLOAD_BYTES must be a positive number.");
  }
  return startServer({ port, host, webRoot, dataDir, adminToken, maxUploadBytes });
}

export function startServer(options: {
  port: number;
  host: string;
  webRoot: string;
  dataDir: string;
  adminToken: string | null;
  maxUploadBytes: number;
}): Promise<RunningServer> {
  const server = createServer(createApp({
    dataDir: options.dataDir,
    webRoot: options.webRoot,
    maxUploadBytes: options.maxUploadBytes,
    policy: createAccessPolicy({ adminToken: options.adminToken }),
  }));
  return new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : options.port;
      console.log(`excalidraw2vsdx listening on http://${options.host}:${port}`);
      console.log(`library data: ${options.dataDir}`);
      if (options.adminToken) console.log("uploads require an admin token");
      resolveListen({
        port,
        close: () => new Promise((done, fail) => {
          server.close((error) => (error ? fail(error) : done()));
        }),
      });
    });
  });
}

const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === entry) {
  startServerFromEnv().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
