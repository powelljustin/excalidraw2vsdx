import { existsSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import { normalizeColor } from "../color.js";
import {
  almostClosed,
  elementAabbPx,
  emptyAabb,
  isFiniteAabb,
  isLinear,
  linearPoints,
  cornerRadiusPx,
  unionAabb,
  type Aabb,
} from "../geometry.js";
import type { ExcalidrawElement } from "../types.js";
import { num, xmlEscape } from "../xml.js";
import type { PreviewFile } from "./split.js";

const FONT_CANDIDATES = [
  "/usr/share/fonts/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/ttf-dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/dejavu/DejaVuSansMono.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
];

const MAX_EDGE = 640;
const MIN_EDGE = 180;
const MAX_SCALE = 6;
const PADDING = 24;

export interface PreviewImage {
  png: Buffer;
  svg: string;
  width: number;
  height: number;
}

/**
 * Draw Excalidraw elements as a clean SVG (roughness is dropped, the same
 * way the Visio converter drops it) and rasterize that SVG with resvg.
 * No browser is involved, so the same code runs on Alpine amd64 and arm64.
 */
export function renderPreviewPng(
  elements: ExcalidrawElement[],
  files: Record<string, PreviewFile> = {},
): PreviewImage {
  const svg = renderElementsToSvg(elements, files);
  const width = Number(svg.match(/\bwidth="(\d+)"/)?.[1] ?? 320);
  const height = Number(svg.match(/\bheight="(\d+)"/)?.[1] ?? 180);
  const fonts = FONT_CANDIDATES.filter((path) => existsSync(path));
  const resvg = new Resvg(svg, {
    font: {
      loadSystemFonts: true,
      defaultFontFamily: "DejaVu Sans",
      fontFiles: fonts,
      sansSerifFamily: "DejaVu Sans",
      monospaceFamily: "DejaVu Sans Mono",
    },
    shapeRendering: 2,
    textRendering: 1,
  });
  const png = Buffer.from(resvg.render().asPng());
  return { png, svg, width, height };
}

export function renderElementsToSvg(
  elements: ExcalidrawElement[],
  files: Record<string, PreviewFile> = {},
): string {
  const visible = elements.filter((element) => !element.isDeleted && element.type !== "selection");
  const bounds = boundsOf(visible);
  if (!isFiniteAabb(bounds)) return placeholderSvg("Empty item");

  const viewW = Math.max(bounds.maxX - bounds.minX, 1) + PADDING * 2;
  const viewH = Math.max(bounds.maxY - bounds.minY, 1) + PADDING * 2;
  const long = Math.max(viewW, viewH);
  let scale = 1;
  if (long > MAX_EDGE) scale = MAX_EDGE / long;
  else if (long < MIN_EDGE) scale = Math.min(MIN_EDGE / long, MAX_SCALE);
  const outW = Math.max(1, Math.round(viewW * scale));
  const outH = Math.max(1, Math.round(viewH * scale));
  const minX = bounds.minX - PADDING;
  const minY = bounds.minY - PADDING;

  const defs: string[] = [];
  const body: string[] = [];
  let seq = 0;
  const nextId = () => `m${seq++}`;
  for (const element of visible) {
    body.push(drawElement(element, files, defs, nextId));
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${outW}" height="${outH}" viewBox="${num(minX)} ${num(minY)} ${num(viewW)} ${num(viewH)}">`,
    `<rect x="${num(minX)}" y="${num(minY)}" width="${num(viewW)}" height="${num(viewH)}" fill="#ffffff"/>`,
    defs.length ? `<defs>${defs.join("")}</defs>` : "",
    body.join(""),
    "</svg>",
  ].join("");
}

function placeholderSvg(label: string): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">`,
    `<rect width="320" height="180" fill="#ffffff"/>`,
    `<text x="160" y="96" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="16" fill="#5e574c">${xmlEscape(label)}</text>`,
    `</svg>`,
  ].join("");
}

function boundsOf(elements: ExcalidrawElement[]): Aabb {
  let box = emptyAabb();
  for (const element of elements) {
    const next = elementAabbPx(element);
    if (!isFiniteAabb(next)) continue;
    box = isFiniteAabb(box) ? unionAabb(box, next) : next;
  }
  return box;
}

function drawElement(
  element: ExcalidrawElement,
  files: Record<string, PreviewFile>,
  defs: string[],
  nextId: () => string,
): string {
  const opacity = element.opacity == null ? 100 : element.opacity;
  if (opacity <= 0) return "";
  const inner = drawShape(element, files, defs, nextId);
  if (!inner) return "";
  const attrs: string[] = [];
  if (opacity < 100) attrs.push(`opacity="${num(opacity / 100)}"`);
  const angle = element.angle ?? 0;
  if (angle) {
    const [cx, cy] = centerOf(element);
    const degrees = (angle * 180) / Math.PI;
    attrs.push(`transform="rotate(${num(degrees)} ${num(cx)} ${num(cy)})"`);
  }
  if (attrs.length === 0) return inner;
  return `<g ${attrs.join(" ")}>${inner}</g>`;
}

function drawShape(
  element: ExcalidrawElement,
  files: Record<string, PreviewFile>,
  defs: string[],
  nextId: () => string,
): string {
  switch (element.type) {
    case "rectangle":
    case "frame":
    case "magicframe":
    case "embeddable":
    case "iframe":
      return drawRectangle(element);
    case "ellipse":
      return drawEllipse(element);
    case "diamond":
      return drawDiamond(element);
    case "text":
      return drawText(element);
    case "line":
    case "arrow":
    case "freedraw":
      return drawLinear(element, defs, nextId);
    case "image":
      return drawImage(element, files);
    default:
      return element.width > 0 && element.height > 0 ? drawRectangle(element) : "";
  }
}

function drawRectangle(element: ExcalidrawElement): string {
  const radius = element.type === "rectangle"
    ? cornerRadiusPx(element.width, element.height, element.roundness)
    : 8;
  const dashed = element.type === "rectangle" ? element.strokeStyle : "dashed";
  const label = element.type === "text"
    ? ""
    : frameLabel(element);
  const shape = `<rect x="${num(element.x)}" y="${num(element.y)}" width="${num(Math.abs(element.width))}" height="${num(Math.abs(element.height))}" rx="${num(radius)}" ry="${num(radius)}" ${paintAttrs(element, dashed)}/>`;
  return label ? `${shape}${label}` : shape;
}

function frameLabel(element: ExcalidrawElement): string {
  if (element.type === "rectangle" || element.type === "ellipse" || element.type === "diamond") {
    return "";
  }
  const name = element.name?.trim();
  if (!name) return "";
  return `<text x="${num(element.x + 8)}" y="${num(element.y + 18)}" font-family="${fontFamily(element.fontFamily)}" font-size="14" fill="#5e574c">${xmlEscape(name)}</text>`;
}

function drawEllipse(element: ExcalidrawElement): string {
  const rx = Math.abs(element.width) / 2;
  const ry = Math.abs(element.height) / 2;
  return `<ellipse cx="${num(element.x + rx)}" cy="${num(element.y + ry)}" rx="${num(rx)}" ry="${num(ry)}" ${paintAttrs(element)}/>`;
}

function drawDiamond(element: ExcalidrawElement): string {
  const w = Math.abs(element.width);
  const h = Math.abs(element.height);
  const points = [
    [element.x + w / 2, element.y],
    [element.x + w, element.y + h / 2],
    [element.x + w / 2, element.y + h],
    [element.x, element.y + h / 2],
  ];
  return `<polygon points="${points.map(([x, y]) => `${num(x)},${num(y)}`).join(" ")}" ${paintAttrs(element)}/>`;
}

function drawText(element: ExcalidrawElement): string {
  const text = element.text ?? "";
  if (!text.trim()) return "";
  const lines = text.split(/\r\n|\r|\n/);
  const fontSize = Math.max(element.fontSize ?? 16, 1);
  const lineHeight = fontSize * (element.lineHeight ?? 1.25);
  const boxH = Math.abs(element.height) || lineHeight * lines.length;
  const blockH = lineHeight * lines.length;
  const align = element.verticalAlign ?? "top";
  let top = element.y;
  if (align === "middle") top += Math.max(0, (boxH - blockH) / 2);
  else if (align === "bottom") top += Math.max(0, boxH - blockH);
  const anchor = textAnchor(element.textAlign);
  const x = anchor === "middle"
    ? element.x + Math.abs(element.width) / 2
    : anchor === "end"
      ? element.x + Math.abs(element.width)
      : element.x;
  const color = normalizeColor(element.strokeColor) ?? "#1e1e1e";
  const tspans = lines.map((line, index) => {
    const y = top + fontSize * 0.85 + index * lineHeight;
    return `<tspan x="${num(x)}" y="${num(y)}">${xmlEscape(line) || " "}</tspan>`;
  });
  return `<text text-anchor="${anchor}" font-family="${fontFamily(element.fontFamily)}" font-size="${num(fontSize)}" fill="${color}">${tspans.join("")}</text>`;
}

function drawLinear(
  element: ExcalidrawElement,
  defs: string[],
  nextId: () => string,
): string {
  const points = linearPoints(element);
  if (points.length === 0) return "";
  const pointList = points.map(([x, y]) => `${num(x)},${num(y)}`).join(" ");
  const closed = element.type === "line" && (element.polygon || almostClosed(points));
  const stroke = normalizeColor(element.strokeColor) ?? (element.type === "freedraw" ? "#1e1e1e" : "#1e1e1e");
  const width = element.strokeWidth ?? (element.type === "freedraw" ? 1 : 2);
  const dash = dashArray(element.strokeStyle, width);
  const attrs = [
    `stroke="${stroke ?? "none"}"`,
    `stroke-width="${width > 0 && stroke ? num(width) : 0}"`,
    `stroke-linejoin="round"`,
    `stroke-linecap="round"`,
  ];
  if (dash && stroke && width > 0) attrs.push(`stroke-dasharray="${dash}"`);
  if (closed) {
    const fill = normalizeColor(element.backgroundColor);
    attrs.push(`fill="${fill ?? "none"}"`);
    return `<polygon points="${pointList}" ${attrs.join(" ")}/>`;
  }
  attrs.push(`fill="none"`);
  const markers = arrowMarkers(element, stroke, defs, nextId);
  if (markers.start) attrs.push(`marker-start="url(#${markers.start})"`);
  if (markers.end) attrs.push(`marker-end="url(#${markers.end})"`);
  return `<polyline points="${pointList}" ${attrs.join(" ")}/>`;
}

function drawImage(element: ExcalidrawElement, files: Record<string, PreviewFile>): string {
  const file = element.fileId ? files[element.fileId] : undefined;
  const href = imageHref(file?.dataURL);
  const w = Math.abs(element.width);
  const h = Math.abs(element.height);
  if (!href || w <= 0 || h <= 0) {
    return `<rect x="${num(element.x)}" y="${num(element.y)}" width="${num(w)}" height="${num(h)}" fill="#f3efe4" stroke="#cfc6b4" stroke-width="1"/>`;
  }
  return `<image href="${xmlEscape(href)}" x="${num(element.x)}" y="${num(element.y)}" width="${num(w)}" height="${num(h)}" preserveAspectRatio="none"/>`;
}

function imageHref(dataURL: string | undefined): string | null {
  if (!dataURL) return null;
  const match = /^data:image\/(png|jpeg|jpg);base64,([a-z0-9+/=\s]+)$/i.exec(dataURL.trim());
  if (!match) return null;
  const payload = match[2].replace(/\s+/g, "");
  if (payload.length === 0 || payload.length > 8_000_000) return null;
  const type = match[1].toLowerCase() === "jpg" ? "jpeg" : match[1].toLowerCase();
  return `data:image/${type};base64,${payload}`;
}

function paintAttrs(element: ExcalidrawElement, strokeStyle?: string): string {
  const fill = normalizeColor(element.backgroundColor);
  const stroke = normalizeColor(element.strokeColor) ?? "#1e1e1e";
  const width = element.strokeWidth ?? 1;
  const parts = [
    `fill="${fill ?? "none"}"`,
    `stroke="${stroke}"`,
    `stroke-width="${width > 0 ? num(width) : 0}"`,
    `stroke-linejoin="round"`,
  ];
  const dash = dashArray(strokeStyle ?? element.strokeStyle, width);
  if (dash && width > 0) parts.push(`stroke-dasharray="${dash}"`);
  return parts.join(" ");
}

function dashArray(style: string | undefined, width: number): string | null {
  if (style === "dashed") return `${num(Math.max(width, 1) * 4)} ${num(Math.max(width, 1) * 3)}`;
  if (style === "dotted") return `${num(Math.max(width, 1))} ${num(Math.max(width, 1) * 2.4)}`;
  return null;
}

function arrowMarkers(
  element: ExcalidrawElement,
  stroke: string | null,
  defs: string[],
  nextId: () => string,
): { start?: string; end?: string } {
  if (!stroke || element.type === "freedraw") return {};
  const startName = element.startArrowhead ?? null;
  const endName = element.endArrowhead === undefined && element.type === "arrow"
    ? "arrow"
    : element.endArrowhead ?? null;
  const out: { start?: string; end?: string } = {};
  if (startName) out.start = addMarker(defs, nextId, startName, stroke);
  if (endName) out.end = addMarker(defs, nextId, endName, stroke);
  return out;
}

function addMarker(defs: string[], nextId: () => string, name: string, color: string): string {
  const id = nextId();
  const safe = xmlEscape(color);
  defs.push(
    `<marker id="${id}" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse" markerUnits="strokeWidth">${markerShape(name, safe)}</marker>`,
  );
  return id;
}

function markerShape(name: string, color: string): string {
  switch (name) {
    case "bar":
      return `<path d="M9,0 L9,10" stroke="${color}" stroke-width="1.6" fill="none"/>`;
    case "dot":
    case "circle":
      return `<circle cx="6" cy="5" r="3" fill="${color}"/>`;
    case "circle_outline":
      return `<circle cx="6" cy="5" r="3" fill="none" stroke="${color}" stroke-width="1.4"/>`;
    case "diamond":
      return `<polygon points="10,5 6,2 2,5 6,8" fill="${color}"/>`;
    case "diamond_outline":
      return `<polygon points="10,5 6,2 2,5 6,8" fill="none" stroke="${color}" stroke-width="1.2"/>`;
    case "triangle_outline":
      return `<path d="M0,0 L10,5 L0,10 Z" fill="none" stroke="${color}" stroke-width="1.2"/>`;
    case "crowfoot_one":
      return `<path d="M2,0 L2,10 M2,5 L10,5" stroke="${color}" stroke-width="1.3" fill="none"/>`;
    case "crowfoot_many":
      return `<path d="M0,5 L10,0 M0,5 L10,5 M0,5 L10,10" stroke="${color}" stroke-width="1.3" fill="none"/>`;
    case "crowfoot_one_or_many":
      return `<path d="M0,5 L8,0 M0,5 L8,5 M0,5 L8,10 M9,0 L9,10" stroke="${color}" stroke-width="1.2" fill="none"/>`;
    case "arrow":
    case "triangle":
    default:
      return `<path d="M0,0 L10,5 L0,10 Z" fill="${color}"/>`;
  }
}

function centerOf(element: ExcalidrawElement): [number, number] {
  if (isLinear(element)) {
    const points = linearPoints(element);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of points) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    if (Number.isFinite(minX)) return [(minX + maxX) / 2, (minY + maxY) / 2];
  }
  return [element.x + (element.width || 0) / 2, element.y + (element.height || 0) / 2];
}

function textAnchor(align: string | undefined): "start" | "middle" | "end" {
  if (align === "center") return "middle";
  if (align === "right") return "end";
  return "start";
}

function fontFamily(family: number | undefined): string {
  if (family === 3) return "DejaVu Sans Mono, Liberation Mono, monospace";
  return "DejaVu Sans, Liberation Sans, sans-serif";
}
