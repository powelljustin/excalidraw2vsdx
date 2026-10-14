import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import type { ExcalidrawElement } from "../src/types.js";
import { renderElementsToSvg, renderPreviewPng } from "../src/library/preview.js";

const box: ExcalidrawElement = {
  id: "box",
  type: "rectangle",
  x: 0,
  y: 0,
  width: 200,
  height: 120,
  strokeColor: "#1e1e1e",
  backgroundColor: "#e03131",
  fillStyle: "solid",
  strokeWidth: 2,
  strokeStyle: "solid",
  roughness: 1,
  opacity: 100,
  roundness: { type: 3 },
};

describe("preview rendering", () => {
  it("draws a rectangle, an ellipse, and an arrow into SVG", () => {
    const svg = renderElementsToSvg([
      box,
      { ...box, id: "disk", type: "ellipse", backgroundColor: "#d0ebff", x: 0, y: 140 },
      {
        ...box,
        id: "link",
        type: "arrow",
        x: 0,
        y: 320,
        width: 80,
        height: 0,
        points: [[0, 0], [80, 0]],
        endArrowhead: "arrow",
        backgroundColor: "transparent",
      },
      { ...box, id: "gone", isDeleted: true, x: 500, y: 500 },
    ]);
    expect(svg).toContain("<rect");
    expect(svg).toContain('fill="#e03131"');
    expect(svg).toContain("<ellipse");
    expect(svg).toContain("<polyline");
    expect(svg).toContain("<marker");
    expect(svg).not.toContain('x="500"');
  });

  it("rasterizes the SVG to a PNG whose center is the shape color", () => {
    const preview = renderPreviewPng([box]);
    expect(preview.png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(preview.width).toBeGreaterThan(100);
    expect(preview.height).toBeGreaterThan(80);
    const png = PNG.sync.read(preview.png);
    const x = Math.floor(png.width / 2);
    const y = Math.floor(png.height / 2);
    const index = (y * png.width + x) * 4;
    expect(png.data[index]).toBeGreaterThan(180);
    expect(png.data[index + 1]).toBeLessThan(100);
    expect(png.data[index + 2]).toBeLessThan(100);
  });

  it("still returns a PNG when the item has nothing to draw", () => {
    const preview = renderPreviewPng([{ ...box, id: "blank", isDeleted: true }]);
    expect(preview.svg).toContain("Empty item");
    expect(preview.png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  });
});
