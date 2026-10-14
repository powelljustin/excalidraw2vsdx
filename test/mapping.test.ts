import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  arrowheadIndex,
  connectionFraction,
  convertExcalidraw,
  cornerRadiusPx,
  linePattern,
  normalizeColor,
  visioFont,
  visioTransparency,
} from "../src/index.js";
import { assertWellFormed, convertScene, packageParts, packageText, pageXml } from "./helpers.js";

function shapeXml(xml: string, name: string): string {
  const match = xml.match(new RegExp(`<Shape ID="\\d+" NameU="${name}"[\\s\\S]*?</Shape>`));
  if (!match) throw new Error(`missing shape ${name}`);
  return match[0];
}

function cellIn(shape: string, name: string): string | undefined {
  return shape.match(new RegExp(`<Cell N="${name}" V="([^"]*)"`))?.[1];
}

const base = {
  strokeColor: "#111111",
  backgroundColor: "#eeeeee",
  fillStyle: "solid",
  strokeWidth: 0,
  strokeStyle: "solid",
  opacity: 100,
  roughness: 0,
  angle: 0,
  groupIds: [] as string[],
};

describe("style mapping", () => {
  it("normalizes colors and transparency", () => {
    expect(normalizeColor("#abc")).toBe("#aabbcc");
    expect(normalizeColor("#aabbcc")).toBe("#aabbcc");
    expect(normalizeColor("transparent")).toBeNull();
    expect(normalizeColor("#00000000")).toBeNull();
    expect(visioTransparency(100)).toBe(0);
    expect(visioTransparency(40)).toBe(0.6);
    expect(linePattern("dashed", "#000", 2)).toBe(2);
    expect(linePattern("dotted", "#000", 2)).toBe(3);
    expect(linePattern("solid", null, 2)).toBe(0);
    expect(arrowheadIndex("arrow")).toBe(5);
    expect(arrowheadIndex("diamond")).toBe(11);
    expect(arrowheadIndex(null)).toBe(0);
    expect(visioFont(1)).toBe("Segoe Print");
    expect(visioFont(3)).toBe("Consolas");
    expect(visioFont(2)).toBe("Arial");
  });

  it("uses Excalidraw's adaptive corner radius", () => {
    expect(cornerRadiusPx(200, 80, { type: 3 })).toBe(20);
    expect(cornerRadiusPx(400, 200, { type: 3 })).toBe(32);
    expect(cornerRadiusPx(100, 100, { type: 2 })).toBe(25);
    expect(cornerRadiusPx(100, 100, null)).toBe(0);
  });

  it("glues to the nearest side, with fixedPoint winning", () => {
    const target = { ...base, id: "box", type: "rectangle", x: 0, y: 0, width: 100, height: 80 };
    const right = connectionFraction(target, [100, 40], null, 0);
    expect(right.fx).toBe(1);
    expect(right.fy).toBeCloseTo(0.5);
    const fixed = connectionFraction(target, [0, 0], [0.25, 0.25], 0);
    expect(fixed.fx).toBeCloseTo(0.25);
    expect(fixed.fy).toBeCloseTo(0.75);
  });
});

describe("geometry conversion", () => {
  it("maps a rectangle from y-down pixels to a y-up inch page", () => {
    const result = convertExcalidraw(
      {
        type: "excalidraw",
        elements: [
          {
            ...base,
            id: "r",
            type: "rectangle",
            x: 96,
            y: 96,
            width: 96,
            height: 96,
            backgroundColor: "#ff0000",
            strokeColor: "#000000",
            strokeWidth: 0,
          },
        ],
      },
      { pxPerInch: 96, marginInches: 0.5 },
    );
    const xml = pageXml(result);
    const pages = packageText(result, "visio/pages/pages.xml");
    expect(pages).toContain('N="PageWidth" V="2"');
    expect(pages).toContain('N="PageHeight" V="2"');
    expect(xml).toContain('N="PinX" V="1"');
    expect(xml).toContain('N="PinY" V="1"');
    expect(xml).toContain('N="Width" V="1"');
    expect(xml).toContain('N="Height" V="1"');
    expect(xml).toContain('N="FillForegnd" V="#ff0000"');
  });

  it("stores rotation as counterclockwise Visio radians", () => {
    const result = convertScene([
      { ...base, id: "r", type: "rectangle", x: 0, y: 0, width: 100, height: 40, angle: Math.PI / 2 },
    ]);
    const xml = pageXml(result);
    expect(xml).toContain('N="Angle" V="-1.570796"');
  });

  it("writes rounded rectangles, ellipses, diamonds, dashes, and opacity", () => {
    const result = convertScene([
      {
        ...base,
        id: "round",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 200,
        height: 80,
        strokeWidth: 2,
        roundness: { type: 3 },
        opacity: 40,
        strokeStyle: "dashed",
      },
      {
        ...base,
        id: "ell",
        type: "ellipse",
        x: 0,
        y: 100,
        width: 60,
        height: 40,
        strokeStyle: "dotted",
        strokeWidth: 2,
      },
      {
        ...base,
        id: "dia",
        type: "diamond",
        x: 80,
        y: 100,
        width: 50,
        height: 50,
        strokeWidth: 2,
      },
    ]);
    const xml = pageXml(result);
    expect(xml).toContain('T="EllipticalArcTo"');
    expect(xml).toContain('N="X" V="0.208333"');
    expect(xml).toContain('N="FillForegndTrans" V="0.6"');
    expect(xml).toContain('N="LinePattern" V="2"');
    expect(xml).toContain('N="LinePattern" V="3"');
    expect(xml).toContain('T="Ellipse"');
    expect(xml).toContain('T="RelMoveTo" IX="1"><Cell N="X" V="0.5"/><Cell N="Y" V="0"/>');
    const ell = shapeXml(xml, "ell");
    expect(Number(cellIn(ell, "Width"))).toBeCloseTo(60 / 96, 5);
    expect(Number(cellIn(ell, "Height"))).toBeCloseTo(40 / 96, 5);
    expect(Number(cellIn(ell, "X"))).toBeCloseTo(60 / 96 / 2, 5);
    expect(cellIn(ell, "A")).toBe(cellIn(ell, "Width"));
    expect(cellIn(ell, "D")).toBe(cellIn(ell, "Height"));
  });

  it("fits every ellipse to its source box, including inside a group", () => {
    const result = convertScene([
      {
        ...base,
        id: "dot",
        type: "ellipse",
        x: 520,
        y: 256,
        width: 7,
        height: 7,
        strokeWidth: 2,
        backgroundColor: "#fab005",
      },
      {
        ...base,
        id: "jack",
        type: "ellipse",
        x: 99,
        y: 325,
        width: 12,
        height: 14,
        strokeWidth: 2,
        backgroundColor: "#212529",
      },
      {
        ...base,
        id: "cab",
        type: "rectangle",
        x: 1760,
        y: 140,
        width: 120,
        height: 180,
        strokeWidth: 2,
        groupIds: ["spk"],
      },
      {
        ...base,
        id: "driver",
        type: "ellipse",
        x: 1785,
        y: 210,
        width: 70,
        height: 70,
        strokeWidth: 2,
        backgroundColor: "#495057",
        groupIds: ["spk"],
      },
      {
        ...base,
        id: "board",
        type: "rectangle",
        x: 430,
        y: 250,
        width: 220,
        height: 160,
        strokeWidth: 2,
      },
      {
        ...base,
        id: "gem",
        type: "diamond",
        x: 300,
        y: 300,
        width: 50,
        height: 40,
        strokeWidth: 2,
      },
      {
        id: "cable",
        type: "line",
        x: 410,
        y: 263,
        width: 165,
        height: 0,
        angle: 0,
        points: [
          [0, 0],
          [165, 0],
        ],
        strokeColor: "#2f9e44",
        backgroundColor: "transparent",
        strokeWidth: 4,
        strokeStyle: "solid",
        opacity: 100,
      },
    ]);
    const xml = pageXml(result);
    const expectBox = (name: string, widthPx: number, heightPx: number) => {
      const shape = shapeXml(xml, name);
      expect(Number(cellIn(shape, "Width"))).toBeCloseTo(widthPx / 96, 5);
      expect(Number(cellIn(shape, "Height"))).toBeCloseTo(heightPx / 96, 5);
      return shape;
    };
    const expectEllipse = (name: string, widthPx: number, heightPx: number) => {
      const shape = expectBox(name, widthPx, heightPx);
      const row = shape.match(/<Row T="Ellipse"[\s\S]*?<\/Row>/)?.[0] ?? "";
      const at = (cellName: string) => Number(new RegExp(`<Cell N="${cellName}" V="([^"]+)"`).exec(row)?.[1]);
      expect(at("X")).toBeCloseTo(widthPx / 96 / 2, 5);
      expect(at("Y")).toBeCloseTo(heightPx / 96 / 2, 5);
      expect(at("A")).toBeCloseTo(widthPx / 96, 5);
      expect(at("B")).toBeCloseTo(heightPx / 96 / 2, 5);
      expect(at("C")).toBeCloseTo(widthPx / 96 / 2, 5);
      expect(at("D")).toBeCloseTo(heightPx / 96, 5);
      expect(row).toContain('F="Width*0.5"');
      expect(row).toContain('F="Height*1"');
      expect(row).not.toContain('V="0.5"');
      expect(row).not.toContain('V="1"');
    };
    expectEllipse("dot", 7, 7);
    expectEllipse("jack", 12, 14);
    expectEllipse("driver", 70, 70);
    expect(xml).toContain('NameU="Group.spk"');
    expectBox("board", 220, 160);
    expectBox("gem", 50, 40);
    const cable = shapeXml(xml, "cable");
    expect(Number(cellIn(cable, "Width"))).toBeCloseTo(165 / 96, 5);
    expect(Number(cellIn(cable, "Height"))).toBeCloseTo(4 / 96, 5);
  });

  it("puts container text on the shape and keeps standalone text", () => {
    const result = convertScene([
      {
        ...base,
        id: "box",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 180,
        height: 80,
        strokeWidth: 2,
        backgroundColor: "#1c7ed6",
      },
      {
        id: "label",
        type: "text",
        x: 10,
        y: 20,
        width: 160,
        height: 40,
        angle: 0,
        text: "Schiit\nModi",
        fontSize: 24,
        fontFamily: 3,
        textAlign: "center",
        verticalAlign: "middle",
        strokeColor: "#ffffff",
        backgroundColor: "transparent",
        strokeWidth: 1,
        opacity: 100,
        containerId: "box",
        lineHeight: 1.25,
      },
      {
        id: "note",
        type: "text",
        x: 0,
        y: 100,
        width: 80,
        height: 20,
        text: "Standalone",
        fontSize: 16,
        fontFamily: 2,
        textAlign: "left",
        verticalAlign: "top",
        strokeColor: "#222222",
        backgroundColor: "transparent",
        strokeWidth: 1,
        opacity: 100,
        containerId: null,
      },
    ]);
    const xml = pageXml(result);
    expect(result.pages[0].shapes).toBe(2);
    expect(xml).toContain("Schiit&#10;Modi");
    expect(xml).toContain("Standalone");
    expect(xml).toContain('N="Font" V="Consolas"');
    expect(xml).toContain('N="Size" V="0.25"');
    expect(xml).toContain('N="HorzAlign" V="0"');
    expect(xml).toContain('N="SpLine" V="0.3125"');
    expect(xml).toContain('N="SpLine" V="0.208333"');
    expect(xml.match(/<Shape /g)?.length).toBe(2);
  });

  it("keeps container text on its own rectangle instead of centering it in the shape", () => {
    const result = convertScene([
      { ...base, id: "spk", type: "rectangle", x: 0, y: 0, width: 120, height: 180, strokeWidth: 2 },
      {
        id: "cap",
        type: "text",
        x: 30,
        y: 142,
        width: 60,
        height: 30,
        angle: 0,
        text: "Left\nSpeaker",
        fontSize: 15,
        fontFamily: 2,
        textAlign: "center",
        verticalAlign: "middle",
        strokeColor: "#ffffff",
        backgroundColor: "transparent",
        strokeWidth: 1,
        opacity: 100,
        containerId: "spk",
        lineHeight: 1.25,
      },
    ]);
    const xml = pageXml(result);
    const pin = Number(/N="TxtPinY" V="([^"]+)"/.exec(xml)?.[1]);
    expect(pin).toBeLessThan(0.4);
    expect(xml).toContain("Left&#10;Speaker");
  });

  it("leaves text with no fill, no line, and no text background", () => {
    const result = convertScene([
      {
        id: "note",
        type: "text",
        x: 0,
        y: 0,
        width: 90,
        height: 24,
        angle: 0,
        text: "Hello",
        fontSize: 18,
        fontFamily: 2,
        textAlign: "left",
        verticalAlign: "top",
        strokeColor: "#222222",
        backgroundColor: "transparent",
        strokeWidth: 1,
        opacity: 100,
        lineHeight: 1.25,
      },
      {
        id: "ghost",
        type: "rectangle",
        x: 0,
        y: 40,
        width: 80,
        height: 40,
        angle: 0,
        strokeColor: "#111111",
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: 2,
        strokeStyle: "solid",
        opacity: 100,
      },
      {
        id: "clear",
        type: "ellipse",
        x: 100,
        y: 40,
        width: 50,
        height: 40,
        angle: 0,
        strokeColor: "#111111",
        backgroundColor: "#00000000",
        fillStyle: "solid",
        strokeWidth: 1,
        strokeStyle: "solid",
        opacity: 100,
      },
      {
        ...base,
        id: "box",
        type: "rectangle",
        x: 200,
        y: 0,
        width: 140,
        height: 70,
        strokeWidth: 2,
        backgroundColor: "#1c7ed6",
      },
      {
        id: "cap",
        type: "text",
        x: 210,
        y: 20,
        width: 120,
        height: 28,
        angle: 0,
        text: "Bound",
        fontSize: 16,
        fontFamily: 2,
        textAlign: "center",
        verticalAlign: "middle",
        strokeColor: "#ffffff",
        backgroundColor: "transparent",
        strokeWidth: 1,
        opacity: 100,
        containerId: "box",
        lineHeight: 1.25,
      },
      {
        id: "wire",
        type: "arrow",
        x: 0,
        y: 120,
        width: 160,
        height: 0,
        angle: 0,
        points: [
          [0, 0],
          [160, 0],
        ],
        strokeColor: "#e03131",
        backgroundColor: "transparent",
        strokeWidth: 2,
        strokeStyle: "solid",
        opacity: 100,
        endArrowhead: "arrow",
      },
      {
        id: "wlab",
        type: "text",
        x: 40,
        y: 96,
        width: 80,
        height: 20,
        angle: 0,
        text: "USB",
        fontSize: 14,
        fontFamily: 2,
        textAlign: "center",
        verticalAlign: "top",
        strokeColor: "#e03131",
        backgroundColor: "transparent",
        strokeWidth: 1,
        opacity: 100,
        containerId: "wire",
        lineHeight: 1.25,
      },
    ]);
    const xml = pageXml(result);
    expect(xml).not.toContain('N="TextBkgnd"');

    const note = shapeXml(xml, "note");
    expect(cellIn(note, "FillPattern")).toBe("0");
    expect(cellIn(note, "LinePattern")).toBe("0");
    expect(cellIn(note, "FillForegnd")).toBeUndefined();
    expect(note).toContain('N="NoFill" V="1"');
    expect(note).toContain('N="NoLine" V="1"');
    expect(note).toContain("Hello");

    const ghost = shapeXml(xml, "ghost");
    expect(cellIn(ghost, "FillPattern")).toBe("0");
    expect(ghost).toContain('N="NoFill" V="1"');
    expect(cellIn(ghost, "LinePattern")).toBe("1");

    const clear = shapeXml(xml, "clear");
    expect(cellIn(clear, "FillPattern")).toBe("0");
    expect(clear).toContain('N="NoFill" V="1"');

    const box = shapeXml(xml, "box");
    expect(cellIn(box, "FillPattern")).toBe("1");
    expect(cellIn(box, "FillForegnd")).toBe("#1c7ed6");
    expect(box).toContain('N="NoFill" V="0"');
    expect(box).toContain("Bound");

    const wire = shapeXml(xml, "wire");
    expect(cellIn(wire, "FillPattern")).toBe("0");
    expect(wire).toContain('N="NoFill" V="1"');
    expect(cellIn(wire, "LinePattern")).toBe("1");
    expect(wire).toContain("USB");
  });

  it("gives standalone text extra width and no inset so short labels stay on one line", () => {
    const result = convertScene([
      {
        id: "port",
        type: "text",
        x: 0,
        y: 0,
        width: 26.4,
        height: 20,
        angle: 0,
        text: "P25",
        fontSize: 16,
        fontFamily: 2,
        textAlign: "left",
        verticalAlign: "top",
        strokeColor: "#111111",
        backgroundColor: "transparent",
        strokeWidth: 1,
        opacity: 100,
        lineHeight: 1.25,
      },
    ]);
    const xml = pageXml(result);
    expect(xml).toContain("P25");
    expect(xml).toContain('N="LeftMargin" V="0"');
    expect(xml).toContain('N="RightMargin" V="0"');
    const width = Number(/<Cell N="Width" V="([^"]+)"/.exec(xml)?.[1]);
    expect(width).toBeGreaterThan(26.4 / 96 + 0.05);
  });

  it("glues arrow ends to connection points", () => {
    const result = convertScene([
      { ...base, id: "a", type: "rectangle", x: 0, y: 0, width: 100, height: 100, strokeWidth: 2 },
      { ...base, id: "b", type: "ellipse", x: 200, y: 0, width: 100, height: 100, strokeWidth: 2 },
      {
        id: "edge",
        type: "arrow",
        x: 100,
        y: 50,
        width: 100,
        height: 0,
        angle: 0,
        points: [
          [0, 0],
          [100, 0],
        ],
        strokeColor: "#e03131",
        backgroundColor: "transparent",
        strokeWidth: 3,
        strokeStyle: "solid",
        opacity: 100,
        startBinding: { elementId: "a", focus: 0, gap: 4 },
        endBinding: { elementId: "b", focus: 0, gap: 4 },
        startArrowhead: null,
        endArrowhead: "arrow",
      },
    ]);
    const xml = pageXml(result);
    expect(result.pages[0].connectors).toBe(1);
    expect(result.pages[0].gluedEndpoints).toBe(2);
    expect(xml).toContain("PAR(PNT(Sheet.");
    expect(xml).toContain('FromCell="BeginX"');
    expect(xml).toContain('FromCell="EndX"');
    expect(xml).toContain('ToCell="Connections.X');
    expect(xml).toContain('N="EndArrow" V="5"');
    expect(xml).toContain('N="BeginArrow" V="0"');
    expect(xml).not.toContain("SHEETREF(");
    const begin = xml.match(/N="BeginX" V="([^"]*)" F="([^"]*)"/);
    expect(begin?.[2]).toMatch(/PAR\(PNT\(Sheet\.\d+!Connections\.X\d+,Sheet\.\d+!Connections\.Y\d+\)\)/);
  });

  it("turns groups, freedraw, and images into Visio groups, polylines, and foreign data", () => {
    const png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const result = convertExcalidraw({
      type: "excalidraw",
      elements: [
        { ...base, id: "g1", type: "rectangle", x: 0, y: 0, width: 40, height: 20, strokeWidth: 2, groupIds: ["g"] },
        { ...base, id: "g2", type: "rectangle", x: 50, y: 0, width: 40, height: 20, strokeWidth: 2, groupIds: ["g"] },
        {
          id: "ink",
          type: "freedraw",
          x: 0,
          y: 40,
          width: 30,
          height: 10,
          angle: 0,
          points: [
            [0, 0],
            [5, 4],
            [10, 1],
            [20, 8],
            [30, 2],
          ],
          strokeColor: "#222",
          backgroundColor: "transparent",
          strokeWidth: 2,
          strokeStyle: "solid",
          opacity: 100,
          pressures: [],
        },
        {
          id: "pic",
          type: "image",
          x: 0,
          y: 80,
          width: 32,
          height: 32,
          angle: 0,
          fileId: "file1",
          status: "saved",
          strokeColor: "transparent",
          backgroundColor: "transparent",
          strokeWidth: 0,
          opacity: 100,
        },
        {
          id: "zig",
          type: "line",
          x: 10,
          y: 130,
          width: 40,
          height: 20,
          points: [
            [0, 0],
            [20, 20],
            [40, 0],
          ],
          strokeColor: "#0b7285",
          backgroundColor: "transparent",
          strokeWidth: 2,
          strokeStyle: "solid",
          opacity: 100,
          startArrowhead: null,
          endArrowhead: "diamond",
        },
      ],
      files: {
        file1: { id: "file1", mimeType: "image/png", dataURL: png },
      },
    }, { marginInches: 0 });
    const xml = pageXml(result);
    expect(result.pages[0].groups).toBe(1);
    expect(xml).toContain('Type="Group"');
    expect(xml).toContain('Type="Foreign"');
    expect(xml).toContain('CompressionType="PNG"');
    expect(xml).toContain('N="EndArrow" V="11"');
    expect(packageParts(result).some((part) => part.startsWith("visio/media/image"))).toBe(true);
    expect(packageText(result, "visio/pages/_rels/page1.xml.rels")).toContain("relationships/image");
  });

  it("lays a library out as one page per item and skips deleted elements", () => {
    const result = convertExcalidraw({
      type: "excalidrawlib",
      version: 2,
      libraryItems: [
        {
          id: "one",
          name: "Alpha",
          elements: [
            { ...base, id: "a", type: "rectangle", x: 0, y: 0, width: 10, height: 10, strokeWidth: 1 },
            { ...base, id: "gone", type: "rectangle", x: 0, y: 0, width: 10, height: 10, isDeleted: true },
          ],
        },
        {
          id: "two",
          name: "Beta",
          elements: [
            { ...base, id: "b", type: "ellipse", x: 0, y: 0, width: 10, height: 10, strokeWidth: 1 },
          ],
        },
      ],
    });
    expect(result.pages.map((page) => page.name)).toEqual(["Alpha", "Beta"]);
    expect(result.pages[0].shapes).toBe(1);
    expect(packageParts(result)).toEqual(
      expect.arrayContaining([
        "[Content_Types].xml",
        "_rels/.rels",
        "docProps/app.xml",
        "docProps/core.xml",
        "docProps/custom.xml",
        "visio/document.xml",
        "visio/_rels/document.xml.rels",
        "visio/pages/pages.xml",
        "visio/pages/_rels/pages.xml.rels",
        "visio/pages/page1.xml",
        "visio/pages/page2.xml",
        "visio/windows.xml",
      ]),
    );
    for (const part of [
      "[Content_Types].xml",
      "visio/document.xml",
      "visio/pages/pages.xml",
      "visio/pages/page1.xml",
      "visio/pages/page2.xml",
    ]) {
      assertWellFormed(packageText(result, part), part);
    }
    expect(packageText(result, "[Content_Types].xml")).toContain(
      "application/vnd.ms-visio.drawing.main+xml",
    );
  });

  it("rejects input that is not Excalidraw JSON", () => {
    expect(() => convertExcalidraw("not json")).toThrow(/JSON/);
    expect(() => convertExcalidraw("{")).toThrow(/JSON/);
  });
});

describe("sample diagrams", () => {
  const pi = readFileSync(new URL("./fixtures/pi-audio-chain.excalidraw", import.meta.url), "utf8");
  const home = readFileSync(new URL("./fixtures/home-network.excalidraw", import.meta.url), "utf8");

  it("converts the Raspberry Pi audio chain", () => {
    const result = convertExcalidraw(pi, { title: "Raspberry Pi 3 Audio Setup" });
    const xml = pageXml(result);
    assertWellFormed(xml, "pi page");
    assertWellFormed(packageText(result, "visio/document.xml"), "document");
    expect(result.pages[0].connectors).toBe(7);
    expect(result.pages[0].gluedEndpoints).toBe(14);
    expect(result.pages[0].groups).toBe(0);
    expect(result.pages[0].shapes).toBe(45);
    expect(xml).toContain("Raspberry Pi 3");
    expect(xml).toContain("Schiit&#10;Modi 3E DAC");
    expect(xml).toContain("USB power supply&#10;5V 2.5A, micro-USB");
    expect(xml).toContain('N="LinePattern" V="2"');
    expect(xml).toContain("PAR(PNT(Sheet.");
    expect(result.pages[0].widthInches).toBeGreaterThan(15);
    expect(result.pages[0].heightInches).toBeGreaterThan(5);
  });

  it("converts the home network diagram, including groups, bindings, and a bent arrow", () => {
    const result = convertExcalidraw(home, { title: "Home network" });
    const xml = pageXml(result);
    assertWellFormed(xml, "home page");
    expect(result.pages[0].groups).toBe(3);
    expect(result.pages[0].shapes).toBe(21);
    expect(result.pages[0].connectors).toBe(6);
    expect(result.pages[0].gluedEndpoints).toBe(12);
    expect(xml).toContain("Modem");
    expect(xml).toContain("Router");
    expect(xml).toContain("Wi-Fi?");
    expect(xml).toContain("Switch");
    expect(xml).toContain("Laptop");
    expect(xml).toContain("Printer");
    expect(xml).toContain("Guest");
    expect(xml).toContain('N="LinePattern" V="2"');
    expect(xml).toContain("PAR(PNT(Sheet.");
    expect(xml.match(/Type="Group"/g)?.length).toBe(3);
    const bend = shapeXml(xml, "to-printer");
    expect(bend.match(/T="LineTo"/g)?.length).toBe(2);
    expect(bend).toContain('N="EndArrow" V="5"');
  });
});
