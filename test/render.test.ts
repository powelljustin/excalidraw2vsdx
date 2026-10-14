import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { convertExcalidraw } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "../tmp/render");

function sofficeAvailable(): boolean {
  try {
    execFileSync("soffice", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function renderVsdx(name: string, bytes: Uint8Array): string {
  mkdirSync(outDir, { recursive: true });
  const vsdx = resolve(outDir, `${name}.vsdx`);
  writeFileSync(vsdx, bytes);
  execFileSync(
    "soffice",
    [
      "-env:UserInstallation=file:///tmp/lo-profile",
      "--headless",
      "--norestore",
      "--convert-to",
      "pdf",
      "--outdir",
      outDir,
      vsdx,
    ],
    { stdio: "pipe", timeout: 120000 },
  );
  const pdf = resolve(outDir, `${name}.pdf`);
  execFileSync("pdftoppm", ["-png", "-r", "110", pdf, resolve(outDir, name)], {
    stdio: "pipe",
  });
  return resolve(outDir, `${name}-1.png`);
}

function featuresScene(): string {
  const box = (
    id: string,
    type: string,
    x: number,
    y: number,
    w: number,
    h: number,
    extra: Record<string, unknown> = {},
  ) => ({
    id,
    type,
    x,
    y,
    width: w,
    height: h,
    angle: 0,
    strokeColor: "#1d4e89",
    backgroundColor: "#d0ebff",
    strokeWidth: 2,
    strokeStyle: "solid",
    fillStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    ...extra,
  });
  return JSON.stringify({
    type: "excalidraw",
    elements: [
      box("r", "rectangle", 20, 20, 140, 70, { roundness: { type: 3 } }),
      box("rt", "text", 30, 40, 120, 28, {
        text: "Rounded",
        fontSize: 20,
        fontFamily: 2,
        textAlign: "center",
        backgroundColor: "transparent",
        containerId: "r",
        strokeWidth: 1,
      }),
      box("e", "ellipse", 190, 20, 120, 70),
      box("et", "text", 200, 40, 100, 28, {
        text: "Ellipse",
        fontSize: 20,
        fontFamily: 2,
        textAlign: "center",
        backgroundColor: "transparent",
        containerId: "e",
        strokeWidth: 1,
      }),
      box("d", "diamond", 340, 16, 110, 78, { backgroundColor: "#ffd8a8", strokeColor: "#d9480f" }),
      box("dt", "text", 355, 42, 80, 24, {
        text: "Diamond",
        fontSize: 16,
        fontFamily: 2,
        textAlign: "center",
        backgroundColor: "transparent",
        containerId: "d",
        strokeColor: "#d9480f",
        strokeWidth: 1,
      }),
      box("a", "arrow", 20, 140, 160, 0, {
        points: [
          [0, 0],
          [160, 0],
        ],
        endArrowhead: "arrow",
        strokeStyle: "dashed",
        backgroundColor: "transparent",
      }),
      box("note", "text", 20, 160, 150, 24, {
        text: "Standalone note",
        fontSize: 18,
        fontFamily: 2,
        textAlign: "left",
        backgroundColor: "transparent",
        strokeColor: "#1c1915",
        strokeWidth: 1,
      }),
      box("rot", "text", 220, 150, 90, 24, {
        text: "Rotated",
        fontSize: 18,
        fontFamily: 2,
        textAlign: "left",
        backgroundColor: "transparent",
        strokeColor: "#1c1915",
        strokeWidth: 1,
        angle: -0.4,
      }),
    ],
  });
}

describe("LibreOffice render", () => {
  const canRender = sofficeAvailable();

  it.skipIf(!canRender)("renders both sample diagrams to PNG", () => {
    const pi = readFileSync(resolve(here, "fixtures/pi-audio-chain.excalidraw"), "utf8");
    const home = readFileSync(resolve(here, "fixtures/home-network.excalidraw"), "utf8");
    const piPng = renderVsdx("pi-audio-chain", convertExcalidraw(pi, { title: "pi" }).vsdx);
    const homePng = renderVsdx("home-network", convertExcalidraw(home, { title: "home" }).vsdx);
    const featuresPng = renderVsdx("features", convertExcalidraw(featuresScene()).vsdx);
    expect(statSync(piPng).size).toBeGreaterThan(8000);
    expect(statSync(homePng).size).toBeGreaterThan(4000);
    expect(statSync(featuresPng).size).toBeGreaterThan(4000);
  });
});
