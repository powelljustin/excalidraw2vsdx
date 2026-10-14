import {
  arrowheadIndex,
  arrowheadSize,
  linePattern,
  normalizeColor,
  visioFont,
  visioTransparency,
} from "./color.js";
import {
  type Aabb,
  type PageSpace,
  almostClosed,
  connectionFraction,
  cornerRadiusPx,
  adjustedTextBox,
  textSlackPx,
  elementAabbPx,
  emptyAabb,
  isFiniteAabb,
  isLinear,
  linearPoints,
  makePageSpace,
  pxToIn,
  PX_PER_INCH,
  simplifyPoints,
  toPageInches,
  unionAabb,
} from "./geometry.js";
import { ConvertError, parseExcalidraw } from "./parse.js";
import type { ExcalidrawElement, ExcalidrawFileData } from "./types.js";
import { buildVsdxPackage, pageRelsXml } from "./visio/package.js";
import { cell, num, pageName, xmlEscape, xmlText } from "./xml.js";

const NS_MAIN = "http://schemas.microsoft.com/office/visio/2012/main";
const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

export interface ConvertOptions {
  /** Scene pixels per Visio inch. Default 96. */
  pxPerInch?: number;
  /** Blank margin around the drawing, in inches. Default 0.5. */
  marginInches?: number;
  /** Document title stored in the package properties. */
  title?: string;
  creator?: string;
}

export interface PageSummary {
  name: string;
  widthInches: number;
  heightInches: number;
  shapes: number;
  groups: number;
  connectors: number;
  gluedEndpoints: number;
  images: number;
  warnings: string[];
}

export interface ConvertResult {
  vsdx: Uint8Array;
  pages: PageSummary[];
  warnings: string[];
}

interface ConnPoint {
  fx: number;
  fy: number;
  dirX: number;
  dirY: number;
}

interface GlueRef {
  targetId: string;
  index: number;
}

interface SceneNode {
  kind: "element" | "group";
  element?: ExcalidrawElement;
  id?: string;
  children?: SceneNode[];
}

interface TextRun {
  text: string;
  fontSize: number;
  fontFamily: number;
  color: string | null;
  align: string;
  valign: string;
  opacity: number;
  lineHeight: number;
  /** Page-inch center of the original text box, used to place arrow labels. */
  centerX: number;
  centerY: number;
  widthIn: number;
  heightIn: number;
  angle: number;
}

interface PendingConnect {
  fromVisioId: number;
  fromCell: "BeginX" | "EndX";
  fromPart: number;
  toElementId: string;
  toIndex: number;
}

interface MediaItem {
  path: string;
  data: Uint8Array;
  extension: string;
  relId: string;
  target: string;
  compression: string;
}

const MIME_INFO: Record<string, { ext: string; compression: string }> = {
  "image/png": { ext: "png", compression: "PNG" },
  "image/jpeg": { ext: "jpg", compression: "JPEG" },
  "image/jpg": { ext: "jpg", compression: "JPEG" },
  "image/gif": { ext: "gif", compression: "GIF" },
  "image/bmp": { ext: "bmp", compression: "BMP" },
  "image/x-ms-bmp": { ext: "bmp", compression: "BMP" },
};

const SUPPORTED = new Set([
  "rectangle",
  "ellipse",
  "diamond",
  "text",
  "line",
  "arrow",
  "freedraw",
  "image",
  "frame",
  "magicframe",
  "embeddable",
  "iframe",
]);

export function convertExcalidraw(
  input: string | unknown,
  options: ConvertOptions = {},
): ConvertResult {
  const scenes = parseExcalidraw(input);
  const pxPerInch = options.pxPerInch ?? PX_PER_INCH;
  const marginInches = options.marginInches ?? 0.5;
  if (!(pxPerInch > 0)) throw new ConvertError("pxPerInch must be a positive number.");
  if (!(marginInches >= 0)) throw new ConvertError("marginInches cannot be negative.");

  const warnings: string[] = [];
  const pages: PageSummary[] = [];
  const pageParts: Array<{
    fileName: string;
    name: string;
    xml: string;
    relsXml?: string;
    widthIn: number;
    heightIn: number;
  }> = [];
  const media: MediaItem[] = [];
  let imageSerial = 1;

  scenes.forEach((scene, index) => {
    const built = buildPage(scene.elements, scene.files, {
      name: pageName(scene.name, index),
      fileName: `page${index + 1}.xml`,
      pxPerInch,
      marginInches,
      imageSerial,
      warnings,
    });
    imageSerial = built.nextImageSerial;
    media.push(...built.media);
    pages.push(built.summary);
    pageParts.push({
      fileName: built.fileName,
      name: built.summary.name,
      xml: built.xml,
      relsXml: pageRelsXml(built.media.map((item) => ({ relId: item.relId, target: item.target }))),
      widthIn: built.summary.widthInches,
      heightIn: built.summary.heightInches,
    });
  });

  if (!pageParts.length) {
    throw new ConvertError("Nothing to convert.");
  }

  const vsdx = buildVsdxPackage({
    pages: pageParts,
    media,
    title: options.title,
    creator: options.creator,
  });
  return { vsdx, pages, warnings };
}

interface BuildArgs {
  name: string;
  fileName: string;
  pxPerInch: number;
  marginInches: number;
  imageSerial: number;
  warnings: string[];
}

function buildPage(
  elements: ExcalidrawElement[],
  files: Record<string, ExcalidrawFileData>,
  args: BuildArgs,
) {
  const pageWarnings: string[] = [];
  const live = elements.filter((element) => !element.isDeleted);
  const byId = new Map(live.map((element) => [element.id, element]));
  const boundText = new Map<string, ExcalidrawElement[]>();
  const consumed = new Set<string>();

  for (const element of live) {
    if (element.type !== "text" || !element.containerId) continue;
    if (!byId.has(element.containerId)) continue;
    const list = boundText.get(element.containerId) ?? [];
    list.push(element);
    boundText.set(element.containerId, list);
    consumed.add(element.id);
  }

  let sawRoughness = false;
  let sawPatternFill = false;
  for (const element of live) {
    if ((element.roughness ?? 0) > 0) sawRoughness = true;
    if (element.fillStyle && element.fillStyle !== "solid") sawPatternFill = true;
    if (!SUPPORTED.has(element.type) && !consumed.has(element.id)) {
      pageWarnings.push(`Skipped unsupported element "${element.id}" of type "${element.type}".`);
    }
  }
  if (sawRoughness) {
    pageWarnings.push("Hand-drawn roughness is drawn as clean geometry.");
  }
  if (sawPatternFill) {
    pageWarnings.push("Hachure, cross-hatch, and zigzag fills are drawn as solid colors.");
  }

  const roots = buildTree(live.filter((element) => !consumed.has(element.id)));
  const bounds = boundsOf(live);
  const space = isFiniteAabb(bounds)
    ? makePageSpace(bounds, args.pxPerInch, args.marginInches)
    : makePageSpace({ minX: 0, minY: 0, maxX: 8.5 * args.pxPerInch, maxY: 11 * args.pxPerInch }, args.pxPerInch, 0);

  const connPoints = new Map<string, ConnPoint[]>();
  const glue = new Map<string, { start?: GlueRef; end?: GlueRef }>();
  for (const element of live) {
    if (element.type !== "arrow" && element.type !== "line") continue;
    if (consumed.has(element.id)) continue;
    const pts = linearPoints(element);
    if (pts.length < 2 || isClosedLinear(element)) continue;
    const record: { start?: GlueRef; end?: GlueRef } = {};
    if (element.startBinding?.elementId) {
      const ref = bindEndpoint(element.startBinding, pts[0], byId, connPoints, pageWarnings);
      if (ref) record.start = ref;
    }
    if (element.endBinding?.elementId) {
      const ref = bindEndpoint(
        element.endBinding,
        pts[pts.length - 1],
        byId,
        connPoints,
        pageWarnings,
      );
      if (ref) record.end = ref;
    }
    if (record.start || record.end) glue.set(element.id, record);
  }

  const ids = new Map<string, number>();
  const connects: PendingConnect[] = [];
  const media: MediaItem[] = [];
  let nextId = 1;
  let imageSerial = args.imageSerial;
  const counts = { shapes: 0, groups: 0, connectors: 0, gluedEndpoints: 0, images: 0 };

  const shapeXmlRaw = roots
    .map((node) =>
      emitNode(node, {
        space,
        parentOriginX: 0,
        parentOriginY: 0,
        boundText,
        connPoints,
        glue,
        ids,
        connects,
        files,
        media,
        warnings: pageWarnings,
        counts,
        nextId: () => nextId++,
        nextImage: () => {
          const serial = imageSerial++;
          return serial;
        },
      }),
    )
    .join("");
  const shapeXml = resolveSheetRefs(shapeXmlRaw, ids);

  const connectXml = connects
    .map((item) => {
      const toId = ids.get(item.toElementId);
      if (toId == null) return "";
      const n = item.toIndex + 1;
      const toPart = 100 + item.toIndex;
      return `<Connect FromSheet="${item.fromVisioId}" FromCell="${item.fromCell}" FromPart="${item.fromPart}" ToSheet="${toId}" ToCell="Connections.X${n}" ToPart="${toPart}"/>`;
    })
    .join("");

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<PageContents xmlns="${NS_MAIN}" xmlns:r="${NS_REL}" xml:space="preserve"><Shapes>${shapeXml}</Shapes>${connectXml ? `<Connects>${connectXml}</Connects>` : ""}</PageContents>`;

  args.warnings.push(...pageWarnings.map((warning) => `${args.name}: ${warning}`));

  return {
    fileName: args.fileName,
    xml,
    media,
    nextImageSerial: imageSerial,
    summary: {
      name: args.name,
      widthInches: round6(space.pageWidthIn),
      heightInches: round6(space.pageHeightIn),
      shapes: counts.shapes,
      groups: counts.groups,
      connectors: counts.connectors,
      gluedEndpoints: counts.gluedEndpoints,
      images: counts.images,
      warnings: pageWarnings,
    } satisfies PageSummary,
  };
}

function bindEndpoint(
  binding: NonNullable<ExcalidrawElement["startBinding"]>,
  endpoint: [number, number],
  byId: Map<string, ExcalidrawElement>,
  connPoints: Map<string, ConnPoint[]>,
  warnings: string[],
): GlueRef | undefined {
  const target = byId.get(binding.elementId);
  if (!target || target.isDeleted) {
    warnings.push(`Binding to missing element "${binding.elementId}" was dropped.`);
    return undefined;
  }
  if (isLinear(target)) {
    warnings.push(`Binding to linear element "${binding.elementId}" is not glued.`);
    return undefined;
  }
  const fraction = connectionFraction(target, endpoint, binding.fixedPoint, binding.focus);
  const list = connPoints.get(target.id) ?? [];
  let index = list.findIndex(
    (point) => Math.abs(point.fx - fraction.fx) < 0.02 && Math.abs(point.fy - fraction.fy) < 0.02,
  );
  if (index < 0) {
    list.push(fraction);
    index = list.length - 1;
    connPoints.set(target.id, list);
  }
  return { targetId: target.id, index };
}

function buildTree(elements: ExcalidrawElement[]): SceneNode[] {
  const roots: SceneNode[] = [];
  const groups = new Map<string, SceneNode>();
  for (const element of elements) {
    if (!SUPPORTED.has(element.type)) continue;
    let list = roots;
    const chain = element.groupIds ?? [];
    for (let i = chain.length - 1; i >= 0; i--) {
      const id = chain[i];
      let group = groups.get(id);
      if (!group) {
        group = { kind: "group", id, children: [] };
        groups.set(id, group);
        list.push(group);
      }
      list = group.children ?? [];
    }
    list.push({ kind: "element", element });
  }
  return roots;
}

function boundsOf(elements: ExcalidrawElement[]): Aabb {
  let box = emptyAabb();
  for (const element of elements) {
    if (!SUPPORTED.has(element.type)) continue;
    box = unionAabb(box, elementAabbPx(element));
  }
  return box;
}

interface EmitEnv {
  space: PageSpace;
  parentOriginX: number;
  parentOriginY: number;
  boundText: Map<string, ExcalidrawElement[]>;
  connPoints: Map<string, ConnPoint[]>;
  glue: Map<string, { start?: GlueRef; end?: GlueRef }>;
  ids: Map<string, number>;
  connects: PendingConnect[];
  files: Record<string, ExcalidrawFileData>;
  media: MediaItem[];
  warnings: string[];
  counts: { shapes: number; groups: number; connectors: number; gluedEndpoints: number; images: number };
  nextId: () => number;
  nextImage: () => number;
}

function emitNode(node: SceneNode, env: EmitEnv): string {
  if (node.kind === "group" && node.children && node.id) {
    return emitGroup(node.id, node.children, env);
  }
  if (node.kind === "element" && node.element) {
    return emitElement(node.element, env);
  }
  return "";
}

function emitGroup(id: string, children: SceneNode[], env: EmitEnv): string {
  const box = nodeAabb(children, env.space);
  const minX = box.minX;
  const minY = box.minY;
  const width = Math.max(box.maxX - box.minX, 0.01);
  const height = Math.max(box.maxY - box.minY, 0.01);
  const pinX = minX + width / 2 - env.parentOriginX;
  const pinY = minY + height / 2 - env.parentOriginY;
  const visioId = env.nextId();
  env.counts.groups += 1;
  env.counts.shapes += 1;
  const childEnv: EmitEnv = { ...env, parentOriginX: minX, parentOriginY: minY };
  const inner = children.map((child) => emitNode(child, childEnv)).join("");
  return `<Shape ID="${visioId}" NameU="Group.${xmlEscape(id)}" Name="Group.${xmlEscape(id)}" Type="Group" LineStyle="0" FillStyle="0" TextStyle="0">${xform(pinX, pinY, width, height, 0)}${cell("FillPattern", 0)}${cell("LinePattern", 0)}${userRow(id)}<Shapes>${inner}</Shapes></Shape>`;
}

function nodeAabb(nodes: SceneNode[], space: PageSpace): Aabb {
  let box = emptyAabb();
  for (const node of nodes) {
    if (node.kind === "element" && node.element) {
      box = unionAabb(box, elementAabbInches(node.element, space));
    } else if (node.kind === "group" && node.children) {
      box = unionAabb(box, nodeAabb(node.children, space));
    }
  }
  if (!isFiniteAabb(box)) return { minX: 0, minY: 0, maxX: 0.5, maxY: 0.5 };
  return box;
}

function elementAabbInches(element: ExcalidrawElement, space: PageSpace): Aabb {
  const px = elementAabbPx(element);
  const a = toPageInches(space, px.minX, px.maxY);
  const b = toPageInches(space, px.maxX, px.minY);
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  };
}

function emitElement(element: ExcalidrawElement, env: EmitEnv): string {
  if (element.type === "freedraw") return emitFreedraw(element, env);
  if (element.type === "line" || element.type === "arrow") {
    if (isClosedLinear(element)) return emitPolygon(element, env);
    if (useConnector(element, env)) return emitConnector(element, env);
    return emitPolyline(element, env);
  }
  if (element.type === "image") return emitImage(element, env);
  return emitBox(element, env);
}

function useConnector(element: ExcalidrawElement, env: EmitEnv): boolean {
  if (element.type === "arrow") return true;
  if (element.startArrowhead || element.endArrowhead) return true;
  if (env.glue.has(element.id)) return true;
  const pts = element.points ?? [];
  return pts.length > 2;
}

function isClosedLinear(element: ExcalidrawElement): boolean {
  if (element.type === "freedraw" || element.type === "arrow") return false;
  if (element.polygon) return true;
  return almostClosed(element.points ?? []);
}

function emitBox(element: ExcalidrawElement, env: EmitEnv): string {
  const placed = placeBox(element, env);
  const texts = textsFor(element, env);
  const visioId = env.nextId();
  env.ids.set(element.id, visioId);
  env.counts.shapes += 1;
  const standaloneText = element.type === "text";
  const fill = standaloneText
    ? normalizeColor(element.backgroundColor)
    : normalizeColor(element.backgroundColor);
  const stroke = standaloneText ? null : normalizeColor(element.strokeColor);
  const radiusPx =
    element.type === "rectangle" ||
    element.type === "diamond" ||
    element.type === "frame" ||
    element.type === "magicframe"
      ? cornerRadiusPx(element.width, element.height, element.roundness)
      : 0;
  const geometry =
    element.type === "ellipse" || element.type === "diamond"
      ? element.type === "ellipse"
        ? ellipseGeometry(fill == null, placed.width, placed.height)
        : diamondGeometry(fill == null)
      : element.type === "text"
        ? rectGeometry(fill == null, true)
        : roundedRectGeometry(fill == null, false, placed.width, placed.height, radiusPx / env.space.pxPerInch);
  const label =
    texts ??
    (element.name && (element.type === "frame" || element.type === "magicframe")
      ? plainLabel(element.name, element, env)
      : element.type === "embeddable" || element.type === "iframe"
        ? plainLabel(element.link || element.name || "Embed", element, env)
        : null);
  const textCells = label
    ? textFrameAt(label, placed, env.parentOriginX, env.parentOriginY, env.space.pxPerInch)
    : "";
  return `<Shape ID="${visioId}" NameU="${shapeName(element)}" Name="${shapeName(element)}" Type="Shape" LineStyle="0" FillStyle="0" TextStyle="0">${xform(placed.pinX, placed.pinY, placed.width, placed.height, placed.angle)}${styleCells(element, fill, stroke, 0, false, env.space.pxPerInch)}${textCells}${connectionSection(env.connPoints.get(element.id))}${userRow(element.id)}${hyperlink(element.link)}${label ? characterSection(label, env.space.pxPerInch) : ""}${geometry}${label ? textElement(label) : ""}</Shape>`;
}

function emitImage(element: ExcalidrawElement, env: EmitEnv): string {
  const decoded = decodeImage(element, env.files);
  if (!decoded) {
    env.warnings.push(`Image "${element.id}" has no embeddable bitmap; a placeholder rectangle was used.`);
    const placeholder: ExcalidrawElement = {
      ...element,
      type: "embeddable",
      name: "Image",
      link: element.link ?? null,
    };
    return emitBox(placeholder, env);
  }
  const serial = env.nextImage();
  const relId = `rId${env.media.length + 1}`;
  const path = `visio/media/image${serial}.${decoded.ext}`;
  env.media.push({
    path,
    data: decoded.bytes,
    extension: decoded.ext,
    relId,
    target: `../media/image${serial}.${decoded.ext}`,
    compression: decoded.compression,
  });
  env.counts.images += 1;
  const placed = placeBox(element, env);
  const visioId = env.nextId();
  env.ids.set(element.id, visioId);
  env.counts.shapes += 1;
  const texts = textsFor(element, env);
  return `<Shape ID="${visioId}" NameU="${shapeName(element)}" Name="${shapeName(element)}" Type="Foreign" LineStyle="0" FillStyle="0" TextStyle="0">${xform(placed.pinX, placed.pinY, placed.width, placed.height, placed.angle)}${cell("ImgOffsetX", 0)}${cell("ImgOffsetY", 0)}${cell("ImgWidth", placed.width, "Width*1")}${cell("ImgHeight", placed.height, "Height*1")}${styleCells(element, null, normalizeColor(element.strokeColor), 0, false, env.space.pxPerInch)}${texts ? textFrameAt(texts, placed, env.parentOriginX, env.parentOriginY, env.space.pxPerInch) : ""}${connectionSection(env.connPoints.get(element.id))}${userRow(element.id)}${texts ? characterSection(texts, env.space.pxPerInch) : ""}<ForeignData ForeignType="Bitmap" CompressionType="${decoded.compression}" ObjectType="2" MappingMode="8" ExtentX="${num(placed.width)}" ExtentY="${num(placed.height)}"><Rel r:id="${relId}"/></ForeignData>${texts ? textElement(texts) : ""}</Shape>`;
}

function emitFreedraw(element: ExcalidrawElement, env: EmitEnv): string {
  const absolute = linearPoints(element);
  const simplified = simplifyPoints(absolute, 1.25);
  if (
    simplified.length < absolute.length &&
    !env.warnings.some((warning) => warning.startsWith("Freedraw strokes"))
  ) {
    env.warnings.push("Freedraw strokes were slightly simplified to polylines.");
  }
  return emitPolyline(element, env, simplified);
}

function emitPolyline(
  element: ExcalidrawElement,
  env: EmitEnv,
  absolute?: Array<[number, number]>,
): string {
  const pts = absolute ?? linearPoints(element);
  const box = emptyAabb();
  for (const [x, y] of pts) {
    box.minX = Math.min(box.minX, x);
    box.minY = Math.min(box.minY, y);
    box.maxX = Math.max(box.maxX, x);
    box.maxY = Math.max(box.maxY, y);
  }
  const pad = Math.max(pxToIn(env.space, element.strokeWidth ?? 1), 0.01);
  let minXpx = box.minX;
  let minYpx = box.minY;
  let maxXpx = box.maxX;
  let maxYpx = box.maxY;
  if (maxXpx - minXpx < 1) {
    minXpx -= 0.5;
    maxXpx += 0.5;
  }
  if (maxYpx - minYpx < 1) {
    minYpx -= 0.5;
    maxYpx += 0.5;
  }
  const topLeft = toPageInches(env.space, minXpx, minYpx);
  const bottomRight = toPageInches(env.space, maxXpx, maxYpx);
  const pageMinX = Math.min(topLeft.x, bottomRight.x);
  const pageMinY = Math.min(topLeft.y, bottomRight.y);
  const width = Math.max(Math.abs(bottomRight.x - topLeft.x), pad);
  const height = Math.max(Math.abs(bottomRight.y - topLeft.y), pad);
  const pinX = pageMinX + width / 2 - env.parentOriginX;
  const pinY = pageMinY + height / 2 - env.parentOriginY;
  const visioId = env.nextId();
  env.ids.set(element.id, visioId);
  env.counts.shapes += 1;
  const rows = pts.map((point, index) => {
    const page = toPageInches(env.space, point[0], point[1]);
    const lx = page.x - pageMinX;
    const ly = page.y - pageMinY;
    const tag = index === 0 ? "MoveTo" : "LineTo";
    return `<Row T="${tag}" IX="${index + 1}">${cell("X", lx)}${cell("Y", ly)}</Row>`;
  });
  const fill = element.type === "line" ? normalizeColor(element.backgroundColor) : null;
  return `<Shape ID="${visioId}" NameU="${shapeName(element)}" Name="${shapeName(element)}" Type="Shape" LineStyle="0" FillStyle="0" TextStyle="0">${xform(pinX, pinY, width, height, 0)}${styleCells(element, fill, normalizeColor(element.strokeColor), 0, false, env.space.pxPerInch)}${userRow(element.id)}${geometrySection(rows, !fill)}</Shape>`;
}

function emitPolygon(element: ExcalidrawElement, env: EmitEnv): string {
  const pts = linearPoints(element);
  const first = pts[0];
  const last = pts[pts.length - 1];
  const closed =
    first && last && (first[0] !== last[0] || first[1] !== last[1]) ? [...pts, first] : pts;
  return emitPolyline(element, env, closed);
}

function emitConnector(element: ExcalidrawElement, env: EmitEnv): string {
  const pts = linearPoints(element);
  const pagePts = pts.map((point) => {
    const page = toPageInches(env.space, point[0], point[1]);
    return { x: page.x - env.parentOriginX, y: page.y - env.parentOriginY };
  });
  const beginX = pagePts[0]?.x ?? 0;
  const beginY = pagePts[0]?.y ?? 0;
  const endX = pagePts[pagePts.length - 1]?.x ?? beginX;
  const endY = pagePts[pagePts.length - 1]?.y ?? beginY;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of pagePts) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  const label = textsFor(element, env);
  if (label) {
    const cx = label.centerX - env.parentOriginX;
    const cy = label.centerY - env.parentOriginY;
    const slack = pxToIn(env.space, textSlackPx(label.widthIn * env.space.pxPerInch, label.fontSize));
    minX = Math.min(minX, cx - label.widthIn / 2 - slack);
    maxX = Math.max(maxX, cx + label.widthIn / 2 + slack);
    minY = Math.min(minY, cy - label.heightIn / 2);
    maxY = Math.max(maxY, cy + label.heightIn / 2);
  }
  const strokeIn = Math.max(pxToIn(env.space, element.strokeWidth ?? 1), 0.01);
  const hasHead = Boolean(
    element.startArrowhead ||
      element.endArrowhead ||
      (element.endArrowhead === undefined && element.type === "arrow"),
  );
  const pad = strokeIn * (hasHead ? 6 : 1.5);
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;
  if (maxX - minX < strokeIn) {
    const mid = (minX + maxX) / 2;
    minX = mid - strokeIn;
    maxX = mid + strokeIn;
  }
  if (maxY - minY < strokeIn) {
    const mid = (minY + maxY) / 2;
    minY = mid - strokeIn;
    maxY = mid + strokeIn;
  }
  const width = maxX - minX;
  const height = maxY - minY;
  const pinX = minX + width / 2;
  const pinY = minY + height / 2;
  const placed = { pinX, pinY, width, height, angle: 0 };

  const visioId = env.nextId();
  env.ids.set(element.id, visioId);
  env.counts.shapes += 1;
  env.counts.connectors += 1;

  const binding = env.glue.get(element.id);
  const beginFormulaX = binding?.start ? glueFormula(binding.start, "X") : undefined;
  const beginFormulaY = binding?.start ? glueFormula(binding.start, "Y") : undefined;
  const endFormulaX = binding?.end ? glueFormula(binding.end, "X") : undefined;
  const endFormulaY = binding?.end ? glueFormula(binding.end, "Y") : undefined;
  if (binding?.start) {
    env.counts.gluedEndpoints += 1;
    env.connects.push({
      fromVisioId: visioId,
      fromCell: "BeginX",
      fromPart: 9,
      toElementId: binding.start.targetId,
      toIndex: binding.start.index,
    });
  }
  if (binding?.end) {
    env.counts.gluedEndpoints += 1;
    env.connects.push({
      fromVisioId: visioId,
      fromCell: "EndX",
      fromPart: 12,
      toElementId: binding.end.targetId,
      toIndex: binding.end.index,
    });
  }

  const rows = pagePts.map((point, index) => {
    const tag = index === 0 ? "MoveTo" : "LineTo";
    return `<Row T="${tag}" IX="${index + 1}">${cell("X", point.x - minX)}${cell("Y", point.y - minY)}</Row>`;
  });

  const endHead =
    element.endArrowhead === undefined && element.type === "arrow"
      ? "arrow"
      : element.endArrowhead;
  const arrows = `${cell("BeginArrow", arrowheadIndex(element.startArrowhead))}${cell("EndArrow", arrowheadIndex(endHead))}${cell("BeginArrowSize", arrowheadSize(element.strokeWidth))}${cell("EndArrowSize", arrowheadSize(element.strokeWidth))}`;
  const textCells = label
    ? textFrameAt(label, placed, env.parentOriginX, env.parentOriginY, env.space.pxPerInch)
    : "";

  return `<Shape ID="${visioId}" NameU="${shapeName(element)}" Name="${shapeName(element)}" Type="Shape" LineStyle="0" FillStyle="0" TextStyle="0">${xform(pinX, pinY, width, height, 0)}${cell("BeginX", beginX, beginFormulaX)}${cell("BeginY", beginY, beginFormulaY)}${cell("EndX", endX, endFormulaX)}${cell("EndY", endY, endFormulaY)}${styleCells(element, null, normalizeColor(element.strokeColor), 0, true, env.space.pxPerInch)}${arrows}${textCells}${userRow(element.id)}${label ? characterSection(label, env.space.pxPerInch) : ""}${geometrySection(rows, true)}${label ? textElement(label) : ""}</Shape>`;
}

function glueFormula(ref: GlueRef, axis: "X" | "Y"): string {
  const n = ref.index + 1;
  const sheet = `SHEETREF(${ref.targetId})`;
  if (axis === "X") {
    return `PAR(PNT(${sheet}!Connections.X${n},${sheet}!Connections.Y${n}))`;
  }
  return `PAR(PNT(${sheet}!Connections.Y${n},${sheet}!Connections.X${n}))`;
}

function resolveSheetRefs(xml: string, ids: Map<string, number>): string {
  let resolved = xml;
  const entries = [...ids.entries()].sort((a, b) => b[0].length - a[0].length);
  for (const [elementId, visioId] of entries) {
    resolved = resolved.split(xmlEscape(`SHEETREF(${elementId})`)).join(`Sheet.${visioId}`);
  }
  return resolved;
}

function placeBox(element: ExcalidrawElement, env: EmitEnv) {
  const textBox = adjustedTextBox(element);
  const x = textBox?.x ?? element.x;
  const y = textBox?.y ?? element.y;
  const w = Math.max(textBox?.width ?? (Math.abs(element.width) || 1), 1);
  const h = Math.max(textBox?.height ?? (Math.abs(element.height) || 1), 1);
  const center = toPageInches(env.space, x + w / 2, y + h / 2);
  return {
    pinX: center.x - env.parentOriginX,
    pinY: center.y - env.parentOriginY,
    width: pxToIn(env.space, w),
    height: pxToIn(env.space, h),
    angle: -(element.angle ?? 0),
  };
}

function xform(pinX: number, pinY: number, width: number, height: number, angle: number): string {
  const locX = width * 0.5;
  const locY = height * 0.5;
  return `${cell("PinX", pinX)}${cell("PinY", pinY)}${cell("Width", width)}${cell("Height", height)}${cell("LocPinX", locX, "Width*0.5")}${cell("LocPinY", locY, "Height*0.5")}${cell("Angle", angle)}${cell("FlipX", 0)}${cell("FlipY", 0)}${cell("ResizeMode", 0)}`;
}

function styleCells(
  element: ExcalidrawElement,
  fill: string | null,
  stroke: string | null,
  radiusPx: number,
  suppressArrows = false,
  pxPerInch = PX_PER_INCH,
): string {
  const trans = visioTransparency(element.opacity);
  const pattern = linePattern(element.strokeStyle, stroke, element.strokeWidth);
  const weight = Math.max((element.strokeWidth ?? 1) / pxPerInch, 0.003);
  const parts = [
    cell("FillPattern", fill ? 1 : 0),
    fill ? cell("FillForegnd", fill) : "",
    cell("FillForegndTrans", fill ? trans : 0),
    cell("LinePattern", pattern),
    stroke ? cell("LineColor", stroke) : "",
    cell("LineWeight", pattern ? weight : 0),
    cell("LineColorTrans", trans),
    cell("LineCap", 0),
    cell("Rounding", radiusPx / pxPerInch),
  ];
  if (!suppressArrows) {
    parts.push(
      cell("BeginArrow", 0),
      cell("EndArrow", 0),
      cell("BeginArrowSize", 2),
      cell("EndArrowSize", 2),
    );
  }
  return parts.join("");
}

function textsFor(element: ExcalidrawElement, env: EmitEnv): TextRun | null {
  const list = env.boundText.get(element.id);
  if (list?.length) return joinTexts(list, env.space);
  if (element.type === "text" && element.text) return joinTexts([element], env.space);
  return null;
}

function joinTexts(list: ExcalidrawElement[], space: PageSpace): TextRun {
  const first = list[0];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const text of list) {
    minX = Math.min(minX, text.x);
    minY = Math.min(minY, text.y);
    maxX = Math.max(maxX, text.x + (text.width || 0));
    maxY = Math.max(maxY, text.y + (text.height || 0));
  }
  const center = toPageInches(space, (minX + maxX) / 2, (minY + maxY) / 2);
  return {
    text: list.map((item) => item.text ?? "").join("\n"),
    fontSize: first.fontSize ?? 20,
    fontFamily: first.fontFamily ?? 2,
    color: normalizeColor(first.strokeColor) ?? "#1e1e1e",
    align: first.textAlign ?? "center",
    valign: first.verticalAlign ?? "top",
    opacity: first.opacity ?? 100,
    lineHeight: first.lineHeight ?? 1.25,
    centerX: center.x,
    centerY: center.y,
    widthIn: Math.max(pxToIn(space, maxX - minX), 0.05),
    heightIn: Math.max(pxToIn(space, maxY - minY), 0.05),
    angle: first.angle ?? 0,
  };
}

function plainLabel(text: string, element: ExcalidrawElement, env: EmitEnv): TextRun {
  const center = toPageInches(env.space, element.x + element.width / 2, element.y + element.height / 2);
  return {
    text,
    fontSize: 16,
    fontFamily: 2,
    color: normalizeColor(element.strokeColor) ?? "#1e1e1e",
    align: "center",
    valign: "middle",
    opacity: element.opacity ?? 100,
    lineHeight: 1.25,
    centerX: center.x,
    centerY: center.y,
    widthIn: pxToIn(env.space, element.width || 40),
    heightIn: pxToIn(env.space, Math.max(element.height || 20, 16)),
    angle: 0,
  };
}

/**
 * Put the text block on the original Excalidraw text rectangle, in the
 * shape's local coordinates. Container labels are not stretched across the
 * whole shape, so a caption that sits at the bottom of a box stays there.
 */
function textFrameAt(
  label: TextRun,
  placed: { pinX: number; pinY: number; width: number; height: number },
  parentOriginX: number,
  parentOriginY: number,
  pxPerInch: number,
): string {
  const left = placed.pinX - placed.width / 2;
  const bottom = placed.pinY - placed.height / 2;
  let localX = label.centerX - parentOriginX - left;
  let localY = label.centerY - parentOriginY - bottom;
  let tw = Math.max(label.widthIn, 0.05);
  const th = Math.max(label.heightIn, 0.05);
  const extra = textSlackPx(label.widthIn * pxPerInch, label.fontSize) / pxPerInch;
  if (label.align === "left") {
    tw += extra;
    localX += extra / 2;
  } else if (label.align === "right") {
    tw += extra;
    localX -= extra / 2;
  } else {
    tw += extra;
  }
  // Do not emit TextBkgnd. Visio treats 0 as "no text background", but
  // LibreOffice paints a shape-level TextBkgnd of 0 as palette black behind
  // the text block. Omitting the cell leaves the block transparent in both.
  // The stylesheet still says 0, which Visio reads as none and LibreOffice
  // does not paint when the shape does not repeat the cell.
  return `${cell("VerticalAlign", valignIndex(label.valign))}${cell("LeftMargin", 0)}${cell("RightMargin", 0)}${cell("TopMargin", 0)}${cell("BottomMargin", 0)}${cell("TxtPinX", localX)}${cell("TxtPinY", localY)}${cell("TxtWidth", tw)}${cell("TxtHeight", th)}${cell("TxtLocPinX", tw / 2, "TxtWidth*0.5")}${cell("TxtLocPinY", th / 2, "TxtHeight*0.5")}${cell("TxtAngle", 0)}`;
}

function characterSection(label: TextRun, pxPerInch = PX_PER_INCH): string {
  const paragraphs = Math.max(label.text.split("\n").length, 1);
  const align = alignIndex(label.align);
  // Absolute line pitch, in inches. Matches Excalidraw's fontSize * lineHeight
  // and is what LibreOffice uses for a positive SpLine value.
  const linePitch =
    (Math.max(label.fontSize, 1) * Math.min(Math.max(label.lineHeight || 1.25, 0.8), 3)) /
    pxPerInch;
  const para = Array.from({ length: paragraphs }, (_, index) => {
    return `<Row IX="${index}">${cell("IndFirst", 0)}${cell("IndLeft", 0)}${cell("IndRight", 0)}${cell("SpLine", linePitch)}${cell("SpBefore", 0)}${cell("SpAfter", 0)}${cell("HorzAlign", align)}${cell("Flags", 0)}</Row>`;
  }).join("");
  const size = Math.max(label.fontSize, 1) / pxPerInch;
  return `<Section N="Character"><Row IX="0">${cell("Font", visioFont(label.fontFamily))}${cell("Color", label.color ?? "#1e1e1e")}${cell("Style", 0)}${cell("Size", size)}${cell("ColorTrans", visioTransparency(label.opacity))}${cell("FontScale", 1)}${cell("LangID", "en-US")}</Row></Section><Section N="Paragraph">${para}</Section>`;
}

function textElement(label: TextRun): string {
  return `<Text><cp IX="0"/>${xmlText(label.text)}</Text>`;
}

function connectionSection(points: ConnPoint[] | undefined): string {
  if (!points?.length) return "";
  const rows = points
    .map((point, index) => {
      return `<Row T="Connection" IX="${index}">${cell("X", point.fx, `Width*${num(point.fx)}`)}${cell("Y", point.fy, `Height*${num(point.fy)}`)}${cell("DirX", point.dirX)}${cell("DirY", point.dirY)}${cell("Type", 0)}${cell("AutoGen", 0)}</Row>`;
    })
    .join("");
  return `<Section N="Connection">${rows}</Section>`;
}

function userRow(id: string): string {
  return `<Section N="User"><Row N="excalidrawId">${cell("Value", id, undefined, "STR")}${cell("Prompt", "", "No Formula")}</Row></Section>`;
}

function hyperlink(link: string | null | undefined): string {
  if (!link) return "";
  return `<Section N="Hyperlink"><Row IX="0">${cell("Description", "")}${cell("Address", link)}${cell("SubAddress", "")}${cell("ExtraInfo", "")}${cell("Frame", "")}</Row></Section>`;
}

function geometrySection(rows: string[], noFill: boolean): string {
  return `<Section N="Geometry" IX="0">${cell("NoFill", noFill ? 1 : 0)}${cell("NoLine", 0)}${cell("NoShow", 0)}${cell("NoSnap", 0)}${cell("NoQuickDrag", 0)}${rows.join("")}</Section>`;
}

function rectGeometry(noFill: boolean, noLine: boolean): string {
  return `<Section N="Geometry" IX="0">${cell("NoFill", noFill ? 1 : 0)}${cell("NoLine", noLine ? 1 : 0)}${cell("NoShow", 0)}${cell("NoSnap", 0)}${cell("NoQuickDrag", 0)}<Row T="RelMoveTo" IX="1">${cell("X", 0)}${cell("Y", 0)}</Row><Row T="RelLineTo" IX="2">${cell("X", 1)}${cell("Y", 0)}</Row><Row T="RelLineTo" IX="3">${cell("X", 1)}${cell("Y", 1)}</Row><Row T="RelLineTo" IX="4">${cell("X", 0)}${cell("Y", 1)}</Row><Row T="RelLineTo" IX="5">${cell("X", 0)}${cell("Y", 0)}</Row></Section>`;
}

/**
 * Quarter-circle corners as EllipticalArcTo rows. The Rounding cell is ignored
 * by LibreOffice Draw, so the radius has to be real geometry.
 */
function roundedRectGeometry(
  noFill: boolean,
  noLine: boolean,
  width: number,
  height: number,
  radius: number,
): string {
  const r = Math.min(radius, width / 2, height / 2);
  if (!(r > 0.002) || !(width > 0) || !(height > 0)) return rectGeometry(noFill, noLine);
  const w = width;
  const h = height;
  const m = r * (1 - Math.SQRT2 / 2);
  const arc = (ix: number, x: number, y: number, a: number, b: number) =>
    `<Row T="EllipticalArcTo" IX="${ix}">${cell("X", x)}${cell("Y", y)}${cell("A", a)}${cell("B", b)}${cell("C", 0)}${cell("D", 1)}</Row>`;
  const line = (ix: number, x: number, y: number) =>
    `<Row T="LineTo" IX="${ix}">${cell("X", x)}${cell("Y", y)}</Row>`;
  return `<Section N="Geometry" IX="0">${cell("NoFill", noFill ? 1 : 0)}${cell("NoLine", noLine ? 1 : 0)}${cell("NoShow", 0)}${cell("NoSnap", 0)}${cell("NoQuickDrag", 0)}<Row T="MoveTo" IX="1">${cell("X", r)}${cell("Y", 0)}</Row>${line(2, w - r, 0)}${arc(3, w, r, w - m, m)}${line(4, w, h - r)}${arc(5, w - r, h, w - m, h - m)}${line(6, r, h)}${arc(7, 0, h - r, m, h - m)}${line(8, 0, r)}${arc(9, r, 0, m, m)}</Section>`;
}

/**
 * Visio ellipse: center (X, Y), a point on the width axis (A, B), and a point
 * on the height axis (C, D). The formulas keep the ellipse fitted if the shape
 * is resized. The cached values have to be the evaluated inches: LibreOffice
 * draws those numbers as absolute coordinates and ignores Width* / Height*.
 * Caching 0.5 and 1 made every ellipse a 1-inch circle.
 */
function ellipseGeometry(noFill: boolean, width: number, height: number): string {
  const cx = width / 2;
  const cy = height / 2;
  return `<Section N="Geometry" IX="0">${cell("NoFill", noFill ? 1 : 0)}${cell("NoLine", 0)}${cell("NoShow", 0)}${cell("NoSnap", 0)}${cell("NoQuickDrag", 0)}<Row T="Ellipse" IX="1">${cell("X", cx, "Width*0.5")}${cell("Y", cy, "Height*0.5")}${cell("A", width, "Width*1")}${cell("B", cy, "Height*0.5")}${cell("C", cx, "Width*0.5")}${cell("D", height, "Height*1")}</Row></Section>`;
}

function diamondGeometry(noFill: boolean): string {
  return `<Section N="Geometry" IX="0">${cell("NoFill", noFill ? 1 : 0)}${cell("NoLine", 0)}${cell("NoShow", 0)}${cell("NoSnap", 0)}${cell("NoQuickDrag", 0)}<Row T="RelMoveTo" IX="1">${cell("X", 0.5)}${cell("Y", 0)}</Row><Row T="RelLineTo" IX="2">${cell("X", 1)}${cell("Y", 0.5)}</Row><Row T="RelLineTo" IX="3">${cell("X", 0.5)}${cell("Y", 1)}</Row><Row T="RelLineTo" IX="4">${cell("X", 0)}${cell("Y", 0.5)}</Row><Row T="RelLineTo" IX="5">${cell("X", 0.5)}${cell("Y", 0)}</Row></Section>`;
}

function shapeName(element: ExcalidrawElement): string {
  const safe = element.id.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 40);
  return xmlEscape(safe || "Shape");
}

function alignIndex(align: string): number {
  if (align === "left") return 0;
  if (align === "right") return 2;
  if (align === "justify") return 3;
  return 1;
}

function valignIndex(align: string): number {
  if (align === "top") return 0;
  if (align === "bottom") return 2;
  return 1;
}

function decodeImage(
  element: ExcalidrawElement,
  files: Record<string, ExcalidrawFileData>,
): { bytes: Uint8Array; ext: string; compression: string } | null {
  if (!element.fileId) return null;
  const file = files[element.fileId];
  if (!file?.dataURL) return null;
  const parsed = parseDataUrl(file.dataURL);
  if (!parsed) return null;
  const info = MIME_INFO[parsed.mime];
  if (!info) return null;
  return { bytes: parsed.bytes, ext: info.ext, compression: info.compression };
}

function parseDataUrl(dataURL: string): { mime: string; bytes: Uint8Array } | null {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataURL);
  if (!match) return null;
  const mime = (match[1] || "application/octet-stream").toLowerCase();
  const payload = match[3] ?? "";
  try {
    if (match[2]) {
      const cleaned = payload.replace(/\s/g, "");
      const binary = globalThis.atob(cleaned);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return { mime, bytes };
    }
    return null;
  } catch {
    return null;
  }
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
