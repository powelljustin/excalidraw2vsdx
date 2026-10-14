const NAMED: Record<string, string> = {
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
  transparent: "",
  none: "",
};

/** Return #rrggbb, or null when the color should not be painted. */
export function normalizeColor(input: string | undefined | null): string | null {
  if (input == null) return null;
  const raw = input.trim().toLowerCase();
  if (!raw || raw === "transparent" || raw === "none") return null;
  const named = NAMED[raw];
  if (named !== undefined) return named || null;
  if (/^#[0-9a-f]{3}$/.test(raw)) {
    return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`;
  }
  if (/^#[0-9a-f]{4}$/.test(raw)) {
    const a = parseInt(raw[4] + raw[4], 16);
    if (a === 0) return null;
    return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`;
  }
  if (/^#[0-9a-f]{6}$/.test(raw)) return raw;
  if (/^#[0-9a-f]{8}$/.test(raw)) {
    const a = parseInt(raw.slice(7, 9), 16);
    if (a === 0) return null;
    return raw.slice(0, 7);
  }
  return null;
}

/** Visio transparency is 0 (opaque) to 1 (clear). Excalidraw opacity is 0–100. */
export function visioTransparency(opacity: number | undefined): number {
  const o = opacity == null || Number.isNaN(opacity) ? 100 : opacity;
  const clamped = Math.min(100, Math.max(0, o));
  return Math.round((1 - clamped / 100) * 1e6) / 1e6;
}

/**
 * Visio line-pattern index.
 * 0 none, 1 solid, 2 dashed, 3 dotted.
 */
export function linePattern(
  strokeStyle: string | undefined,
  strokeColor: string | null,
  strokeWidth: number | undefined,
): number {
  if (!strokeColor) return 0;
  if (strokeWidth != null && strokeWidth <= 0) return 0;
  if (strokeStyle === "dashed") return 2;
  if (strokeStyle === "dotted") return 3;
  return 1;
}

/**
 * Visio arrowhead index. Values follow the Line dialog and the mapping
 * used by draw.io's VSDX export for the closest filled/open shape.
 */
export function arrowheadIndex(name: string | null | undefined): number {
  if (!name) return 0;
  switch (name) {
    case "arrow":
      return 5;
    case "triangle":
      return 4;
    case "triangle_outline":
      return 14;
    case "bar":
      return 23;
    case "dot":
    case "circle":
      return 10;
    case "circle_outline":
      return 20;
    case "diamond":
      return 11;
    case "diamond_outline":
      return 22;
    case "crowfoot_one":
      return 24;
    case "crowfoot_many":
      return 27;
    case "crowfoot_one_or_many":
      return 28;
    default:
      return 5;
  }
}

/** Visio arrow size index: 0 very small … 4 extra large. */
export function arrowheadSize(strokeWidth: number | undefined): number {
  const w = strokeWidth ?? 2;
  if (w <= 1) return 1;
  if (w <= 2) return 2;
  if (w <= 4) return 3;
  return 4;
}

const FONT_BY_FAMILY: Record<number, string> = {
  1: "Segoe Print",
  2: "Arial",
  3: "Consolas",
  5: "Segoe Print",
  6: "Arial",
  7: "Arial",
  8: "Comic Sans MS",
  9: "Arial",
  10: "Arial",
};

/** Map an Excalidraw fontFamily id to a face installed with Visio / Windows. */
export function visioFont(fontFamily: number | undefined): string {
  if (fontFamily == null) return "Arial";
  return FONT_BY_FAMILY[fontFamily] ?? "Arial";
}

export const VISIO_FACE_NAMES = [
  "Calibri",
  "Arial",
  "Consolas",
  "Courier New",
  "Segoe UI",
  "Segoe Print",
  "Comic Sans MS",
];
