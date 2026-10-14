import type { ExcalidrawElement, ExcalidrawRoundness } from "./types.js";

/** CSS pixels per Visio inch. 96 matches the CSS pixel. */
export const PX_PER_INCH = 96;

/** Excalidraw adaptive corner radius, in pixels. */
export const DEFAULT_ADAPTIVE_RADIUS = 32;
export const DEFAULT_PROPORTIONAL_RADIUS = 0.25;

export interface Aabb {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function emptyAabb(): Aabb {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

export function unionAabb(a: Aabb, b: Aabb): Aabb {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

export function isFiniteAabb(a: Aabb): boolean {
  return (
    Number.isFinite(a.minX) &&
    Number.isFinite(a.minY) &&
    Number.isFinite(a.maxX) &&
    Number.isFinite(a.maxY) &&
    a.maxX >= a.minX &&
    a.maxY >= a.minY
  );
}

export function expandAabb(a: Aabb, pad: number): Aabb {
  return {
    minX: a.minX - pad,
    minY: a.minY - pad,
    maxX: a.maxX + pad,
    maxY: a.maxY + pad,
  };
}

export function isLinear(element: ExcalidrawElement): boolean {
  return (
    element.type === "line" ||
    element.type === "arrow" ||
    element.type === "freedraw"
  );
}

/** Absolute scene points for a linear element. `x`/`y` is the origin of `points`. */
export function linearPoints(element: ExcalidrawElement): Array<[number, number]> {
  const pts = element.points?.length ? element.points : [[0, 0]];
  return pts.map(([px, py]) => [element.x + px, element.y + py]);
}

/**
 * Excalidraw angle is clockwise radians in a y-down scene.
 * The same matrix Excalidraw uses, so a positive angle looks clockwise on screen.
 */
export function rotateExcalidraw(
  x: number,
  y: number,
  cx: number,
  cy: number,
  angle: number,
): [number, number] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = x - cx;
  const dy = y - cy;
  return [dx * cos - dy * sin + cx, dx * sin + dy * cos + cy];
}

export function inverseRotateExcalidraw(
  x: number,
  y: number,
  cx: number,
  cy: number,
  angle: number,
): [number, number] {
  return rotateExcalidraw(x, y, cx, cy, -angle);
}

/** Axis-aligned bounds of a rotated rectangle. Angle is Excalidraw clockwise radians. */
export function rotatedRectAabb(
  x: number,
  y: number,
  width: number,
  height: number,
  angle: number,
): Aabb {
  const w = Math.abs(width);
  const h = Math.abs(height);
  if (!angle) {
    return { minX: x, minY: y, maxX: x + w, maxY: y + h };
  }
  const cx = x + w / 2;
  const cy = y + h / 2;
  const corners: Array<[number, number]> = [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
  const box = emptyAabb();
  for (const [px, py] of corners) {
    const [rx, ry] = rotateExcalidraw(px, py, cx, cy, angle);
    box.minX = Math.min(box.minX, rx);
    box.minY = Math.min(box.minY, ry);
    box.maxX = Math.max(box.maxX, rx);
    box.maxY = Math.max(box.maxY, ry);
  }
  return box;
}

export interface TextBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Extra width so Arial / Arimo / Segoe Print can hold a label Excalidraw
 * measured with its own face. Short strings of wide capitals need the most.
 */
export function textSlackPx(width: number, fontSize: number): number {
  return Math.max(Math.abs(width) * 0.18, Math.max(fontSize, 1) * 0.5, 8);
}

/**
 * Standalone text is measured by Excalidraw against its own face.
 * Pad the box and keep the alignment anchor so the label stays intact.
 */
export function adjustedTextBox(element: ExcalidrawElement): TextBox | null {
  if (element.type !== "text") return null;
  const font = Math.max(element.fontSize ?? 16, 1);
  const width = Math.abs(element.width) || 1;
  const height = Math.abs(element.height) || font * (element.lineHeight ?? 1.25);
  const padX = textSlackPx(width, font);
  const padY = Math.max(font * 0.15, 1);
  const align = element.textAlign ?? "left";
  const valign = element.verticalAlign ?? "top";
  let x = element.x;
  let y = element.y;
  if (align === "center") x -= padX / 2;
  else if (align === "right") x -= padX;
  if (valign === "middle") y -= padY / 2;
  else if (valign === "bottom") y -= padY;
  return { x, y, width: width + padX, height: height + padY };
}

export function elementAabbPx(element: ExcalidrawElement): Aabb {
  if (isLinear(element)) {
    const box = emptyAabb();
    for (const [px, py] of linearPoints(element)) {
      box.minX = Math.min(box.minX, px);
      box.minY = Math.min(box.minY, py);
      box.maxX = Math.max(box.maxX, px);
      box.maxY = Math.max(box.maxY, py);
    }
    const pad = Math.max(element.strokeWidth ?? 1, 1) / 2;
    const arrowPad =
      element.type === "arrow" || element.startArrowhead || element.endArrowhead
        ? Math.max(element.strokeWidth ?? 2, 1) * 4
        : 0;
    return expandAabb(box, pad + arrowPad);
  }
  const textBox = adjustedTextBox(element);
  const box = rotatedRectAabb(
    textBox?.x ?? element.x,
    textBox?.y ?? element.y,
    textBox?.width ?? (element.width || 0),
    textBox?.height ?? (element.height || 0),
    element.angle ?? 0,
  );
  const pad = (element.strokeWidth ?? 0) / 2;
  return pad ? expandAabb(box, pad) : box;
}

/**
 * Corner radius in pixels, matching Excalidraw's getCornerRadius for rectangles
 * (the input length is the smaller side).
 */
export function cornerRadiusPx(
  width: number,
  height: number,
  roundness: ExcalidrawRoundness | null | undefined,
): number {
  if (!roundness?.type) return 0;
  const x = Math.min(Math.abs(width), Math.abs(height));
  if (roundness.type === 1 || roundness.type === 2) {
    return x * DEFAULT_PROPORTIONAL_RADIUS;
  }
  if (roundness.type === 3) {
    const fixed = roundness.value ?? DEFAULT_ADAPTIVE_RADIUS;
    const cutoff = fixed / DEFAULT_PROPORTIONAL_RADIUS;
    if (x <= cutoff) return x * DEFAULT_PROPORTIONAL_RADIUS;
    return fixed;
  }
  return 0;
}

export interface PageSpace {
  pxPerInch: number;
  minX: number;
  minY: number;
  marginPx: number;
  pageWidthPx: number;
  pageHeightPx: number;
  pageWidthIn: number;
  pageHeightIn: number;
}

export function makePageSpace(
  bounds: Aabb,
  pxPerInch: number,
  marginInches: number,
): PageSpace {
  const marginPx = marginInches * pxPerInch;
  const contentW = Math.max(bounds.maxX - bounds.minX, 1);
  const contentH = Math.max(bounds.maxY - bounds.minY, 1);
  const pageWidthPx = contentW + marginPx * 2;
  const pageHeightPx = contentH + marginPx * 2;
  return {
    pxPerInch,
    minX: bounds.minX,
    minY: bounds.minY,
    marginPx,
    pageWidthPx,
    pageHeightPx,
    pageWidthIn: pageWidthPx / pxPerInch,
    pageHeightIn: pageHeightPx / pxPerInch,
  };
}

/** Scene pixels (y down) to page inches (y up, origin at the page bottom-left). */
export function toPageInches(
  space: PageSpace,
  px: number,
  py: number,
): { x: number; y: number } {
  const x = (px - space.minX + space.marginPx) / space.pxPerInch;
  const y =
    space.pageHeightIn - (py - space.minY + space.marginPx) / space.pxPerInch;
  return { x, y };
}

export function pxToIn(space: PageSpace, px: number): number {
  return px / space.pxPerInch;
}

/**
 * Where an arrow endpoint should glue on a shape.
 * Returns fractions of the shape's local box: fx from the left, fy from the
 * bottom (Visio's y-up local system).
 */
export function connectionFraction(
  target: ExcalidrawElement,
  endpoint: [number, number],
  fixedPoint: [number, number] | null | undefined,
  focus: number | undefined,
): { fx: number; fy: number; dirX: number; dirY: number } {
  if (
    fixedPoint &&
    Number.isFinite(fixedPoint[0]) &&
    Number.isFinite(fixedPoint[1])
  ) {
    const fx = clamp01(fixedPoint[0]);
    const fy = clamp01(1 - fixedPoint[1]);
    return { fx, fy, dirX: 0, dirY: 0 };
  }

  const w = Math.abs(target.width) || 1;
  const h = Math.abs(target.height) || 1;
  const cx = target.x + w / 2;
  const cy = target.y + h / 2;
  const angle = target.angle ?? 0;
  const [lx, ly] = inverseRotateExcalidraw(endpoint[0], endpoint[1], cx, cy, angle);
  const relX = clamp01((lx - target.x) / w);
  const relY = clamp01((ly - target.y) / h);
  const dLeft = relX;
  const dRight = 1 - relX;
  const dTop = relY;
  const dBottom = 1 - relY;
  const nearest = Math.min(dLeft, dRight, dTop, dBottom);
  const f = clamp((focus ?? 0) * 0.5, -0.5, 0.5);

  if (nearest === dLeft) {
    const fyTop = clamp01(0.5 + f);
    return { fx: 0, fy: 1 - fyTop, dirX: -1, dirY: 0 };
  }
  if (nearest === dRight) {
    const fyTop = clamp01(0.5 + f);
    return { fx: 1, fy: 1 - fyTop, dirX: 1, dirY: 0 };
  }
  if (nearest === dTop) {
    const fx = clamp01(0.5 + f);
    return { fx, fy: 1, dirX: 0, dirY: 1 };
  }
  const fx = clamp01(0.5 + f);
  return { fx, fy: 0, dirX: 0, dirY: -1 };
}

export function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function almostClosed(points: Array<[number, number]>): boolean {
  if (points.length < 3) return false;
  const a = points[0];
  const b = points[points.length - 1];
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy <= 1;
}

/** Drop freedraw samples that sit on top of the previous kept point. */
export function simplifyPoints(
  points: Array<[number, number]>,
  minDist: number,
): Array<[number, number]> {
  if (points.length <= 2) return points;
  const kept: Array<[number, number]> = [points[0]];
  const min2 = minDist * minDist;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = kept[kept.length - 1];
    const dx = points[i][0] - prev[0];
    const dy = points[i][1] - prev[1];
    if (dx * dx + dy * dy >= min2) kept.push(points[i]);
  }
  kept.push(points[points.length - 1]);
  return kept;
}
