import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { PNG } from "pngjs";
import { afterEach, describe, expect, it } from "vitest";
import { createAccessPolicy, type AccessPolicy } from "../src/library/access.js";
import { createApp } from "../src/server/app.js";

const widgetDocument = JSON.parse(readFileSync("test/fixtures/widgets.excalidrawlib", "utf8"));
const servers: Array<{ close: () => Promise<void>; dataDir: string }> = [];

afterEach(async () => {
  while (servers.length) {
    const running = servers.pop();
    if (!running) break;
    await running.close();
    rmSync(running.dataDir, { recursive: true, force: true });
  }
});

describe("library API", () => {
  it("uploads a library, serves previews, downloads, converts, and searches", async () => {
    const { base, dataDir } = await start();
    const created = await upload(base, {
      filename: "../../etc/passwd.excalidrawlib",
      name: "Network widgets",
      description: "Small shapes",
      tags: ["network", "demo"],
      document: widgetDocument,
    });
    expect(created.response.status).toBe(201);
    const library = created.body.library;
    expect(library.filename).toBe("passwd.excalidrawlib");
    expect(library.access).toBe("free");
    expect(library.tags).toEqual(["network", "demo"]);
    expect(library.items.map((item: { name: string }) => item.name)).toEqual(["Router", "Database", "Choice"]);
    expect(library.items[0].tags).toEqual(["network", "demo"]);

    for (const file of walk(dataDir)) {
      expect(file.startsWith(dataDir.endsWith(sep) ? dataDir : dataDir + sep) || file === dataDir).toBe(true);
    }
    expect(walk(dataDir).some((file) => file.endsWith(".png"))).toBe(true);

    const listed = await json(base, "/api/libraries?q=router");
    expect(listed.libraries).toHaveLength(1);
    expect(listed.libraries[0].items).toHaveLength(1);
    expect(listed.libraries[0].items[0].name).toBe("Router");
    const byTag = await json(base, "/api/libraries?tag=network");
    expect(byTag.libraries[0].items).toHaveLength(3);
    const missed = await json(base, "/api/libraries?q=zzzz-no-such-shape");
    expect(missed.libraries).toEqual([]);

    const router = library.items[0];
    const preview = await fetch(`${base}${router.previewUrl}`);
    expect(preview.status).toBe(200);
    expect(preview.headers.get("content-type")).toBe("image/png");
    const png = PNG.sync.read(Buffer.from(await preview.arrayBuffer()));
    let warmPixels = 0;
    for (let i = 0; i < png.data.length; i += 4) {
      if (png.data[i] > 220 && png.data[i + 1] > 180 && png.data[i + 2] < 210) warmPixels += 1;
    }
    expect(warmPixels).toBeGreaterThan(50);

    const whole = await fetch(`${base}${library.downloadUrl}`);
    expect(whole.headers.get("content-disposition")).toContain("passwd.excalidrawlib");
    const wholeJson = await whole.json();
    expect(wholeJson.type).toBe("excalidrawlib");
    expect(wholeJson.libraryItems).toHaveLength(3);

    const one = await fetch(`${base}${router.downloadUrl}`);
    const oneJson = await one.json();
    expect(oneJson.libraryItems).toHaveLength(1);
    expect(oneJson.libraryItems[0].name).toBe("Router");

    const vsdx = await fetch(`${base}${router.vsdxUrl}`);
    expect(vsdx.status).toBe(200);
    expect(vsdx.headers.get("content-type")).toContain("visio");
    const bytes = Buffer.from(await vsdx.arrayBuffer());
    expect(bytes.subarray(0, 2).toString()).toBe("PK");

    const renamed = await json(base, `/api/libraries/${library.id}/items/${router.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Edge router", description: "Sits at the edge", tags: ["edge"] }),
    });
    expect(renamed.library.items[0].name).toBe("Edge router");
    const renamedFile = await fetch(`${base}${router.downloadUrl}`);
    const renamedJson = await renamedFile.json();
    expect(renamedJson.libraryItems[0].name).toBe("Edge router");

    const removed = await json(base, `/api/libraries/${library.id}`, { method: "DELETE" });
    expect(removed.ok).toBe(true);
    const after = await fetch(`${base}/api/libraries/${library.id}`);
    expect(after.status).toBe(404);
  });

  it("accepts a raw .excalidraw body and a scene from the sample drawings", async () => {
    const { base } = await start();
    const scene = JSON.parse(readFileSync("test/fixtures/home-network.excalidraw", "utf8"));
    const response = await fetch(`${base}/api/libraries`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-filename": "home-network.excalidraw",
        "x-library-name": "Home network",
        "x-library-tags": "sample",
      },
      body: JSON.stringify(scene),
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.library.items).toHaveLength(1);
    expect(body.library.name).toBe("Home network");
    const preview = await fetch(`${base}${body.library.items[0].previewUrl}`);
    expect(preview.headers.get("content-type")).toBe("image/png");
    expect((await preview.arrayBuffer()).byteLength).toBeGreaterThan(500);
  });

  it("rejects bad uploads and path traversal in ids", async () => {
    const { base, webRoot } = await start({ maxUploadBytes: 800, withWeb: true });
    const badType = await fetch(`${base}/api/libraries`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    });
    expect(badType.status).toBe(415);

    const badJson = await upload(base, { filename: "a.excalidraw", document: { type: "excalidraw", elements: [] } });
    expect(badJson.response.status).toBe(400);

    const notDrawing = await upload(base, { filename: "a.excalidraw", document: { hello: true } });
    expect(notDrawing.response.status).toBe(400);

    const escaped = await upload(base, {
      filename: "foo.excalidraw/../../etc/passwd",
      document: {
        type: "excalidraw",
        elements: [{ id: "box", type: "rectangle", x: 0, y: 0, width: 20, height: 10 }],
      },
    });
    expect(escaped.response.status).toBe(400);

    const huge = await fetch(`${base}/api/libraries`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filename: "a.excalidrawlib", document: { pad: "x".repeat(2000) } }),
    });
    expect(huge.status).toBe(413);

    expect((await fetch(`${base}/api/libraries/../index.json`)).status).toBe(404);
    expect((await fetch(`${base}/api/libraries/%2e%2e/%2e%2e/index.json`)).status).toBe(404);
    expect((await fetch(`${base}/%2e%2e%2fpackage.json`)).status).toBe(404);
    const page = await fetch(`${base}/library.html`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("library-page");
    expect(webRoot).toBeTruthy();
  });

  it("requires the admin token when one is configured, and hides paid libraries", async () => {
    const open = await start();
    const paid = await upload(open.base, {
      filename: "paid.excalidrawlib",
      name: "Paid set",
      access: "paid",
      document: widgetDocument,
    });
    expect(paid.response.status).toBe(201);
    const hidden = await json(open.base, "/api/libraries");
    expect(hidden.libraries).toHaveLength(1);
    expect(hidden.libraries[0].locked).toBe(true);
    expect(hidden.libraries[0].downloadUrl).toBe("");
    expect(hidden.libraries[0].items[0].previewUrl).toBe("");
    const paidItem = paid.body.library.items[0];
    const denied = await fetch(`${open.base}/api/libraries/${paid.body.library.id}/items/${paidItem.id}/preview.png`);
    expect(denied.status).toBe(402);
    const deniedFile = await fetch(`${open.base}/api/libraries/${paid.body.library.id}/download`);
    expect(deniedFile.status).toBe(402);
    const fixed = await json(open.base, `/api/libraries/${paid.body.library.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ access: "free" }),
    });
    expect(fixed.library.access).toBe("free");

    const locked = await start({ adminToken: "s3cret" });
    const noToken = await upload(locked.base, { filename: "widgets.excalidrawlib", document: widgetDocument });
    expect(noToken.response.status).toBe(401);
    const withToken = await upload(
      locked.base,
      { filename: "widgets.excalidrawlib", name: "Private", access: "paid", document: widgetDocument },
      { "x-admin-token": "s3cret" },
    );
    expect(withToken.response.status).toBe(201);
    const asBearer = await fetch(`${locked.base}/api/libraries`, {
      headers: { authorization: "Bearer s3cret" },
    });
    const bearerBody = await asBearer.json();
    expect(bearerBody.libraries).toHaveLength(1);
    const publicList = await json(locked.base, "/api/libraries");
    expect(publicList.libraries).toHaveLength(1);
    expect(publicList.libraries[0].locked).toBe(true);

    const unlocked = await start({ allowPaid: () => true });
    const visible = await upload(unlocked.base, {
      filename: "paid.excalidrawlib",
      access: "paid",
      document: widgetDocument,
    });
    const list = await json(unlocked.base, "/api/libraries");
    expect(list.libraries).toHaveLength(1);
    expect(list.libraries[0].locked).toBe(false);
    expect(visible.body.library.access).toBe("paid");
    expect(visible.body.library.locked).toBe(false);
  });
});

async function start(options: {
  adminToken?: string;
  allowPaid?: () => boolean;
  maxUploadBytes?: number;
  withWeb?: boolean;
} = {}): Promise<{ base: string; dataDir: string; webRoot: string | null }> {
  const dataDir = mkdtempSync(join(tmpdir(), "excalidraw-lib-"));
  let webRoot: string | null = null;
  if (options.withWeb) {
    webRoot = mkdtempSync(join(tmpdir(), "excalidraw-web-"));
    writeFileSync(join(webRoot, "library.html"), "<p>library-page</p>");
  }
  const policy: AccessPolicy = createAccessPolicy({
    adminToken: options.adminToken,
    allowPaid: options.allowPaid,
  });
  const server = createServer(createApp({
    dataDir,
    webRoot,
    policy,
    maxUploadBytes: options.maxUploadBytes,
  }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  servers.push({
    dataDir,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  });
  if (webRoot) {
    servers.push({
      dataDir: webRoot,
      close: async () => {},
    });
  }
  return { base: `http://127.0.0.1:${port}`, dataDir, webRoot };
}

async function upload(
  base: string,
  fields: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<{ response: Response; body: { library: LibraryBody } }> {
  const response = await fetch(`${base}/api/libraries`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ filename: "widgets.excalidrawlib", ...fields }),
  });
  const body = await response.json() as { library: LibraryBody };
  return { response, body };
}

async function json(base: string, path: string, init?: RequestInit): Promise<Record<string, any>> {
  const response = await fetch(`${base}${path}`, init);
  expect(response.ok, `${init?.method ?? "GET"} ${path} -> ${response.status} ${await response.clone().text()}`).toBe(true);
  return response.json() as Promise<Record<string, any>>;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

interface LibraryBody {
  id: string;
  filename: string;
  access: string;
  tags: string[];
  items: Array<{ id: string; name: string; tags: string[]; previewUrl: string; downloadUrl: string; vsdxUrl: string }>;
}
