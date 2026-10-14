import { strToU8, zipSync } from "fflate";
import { VISIO_FACE_NAMES } from "../color.js";
import { BUILTIN_STYLE_SHEETS } from "./builtinStyles.js";
import { cell, num, xmlEscape } from "../xml.js";

const NS_MAIN = "http://schemas.microsoft.com/office/visio/2012/main";
const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";

export interface VsdxPagePart {
  fileName: string;
  name: string;
  xml: string;
  relsXml?: string;
  widthIn: number;
  heightIn: number;
}

export interface VsdxMedia {
  /** Path inside the package, e.g. visio/media/image1.png */
  path: string;
  data: Uint8Array;
  extension: string;
}

export interface VsdxPackageInput {
  pages: VsdxPagePart[];
  media: VsdxMedia[];
  title?: string;
  creator?: string;
}

const IMAGE_CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
};

export function buildVsdxPackage(input: VsdxPackageInput): Uint8Array {
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const title = input.title?.trim() || "Excalidraw drawing";
  const creator = input.creator ?? "excalidraw2vsdx";
  const parts = new Map<string, Uint8Array | string>();

  parts.set("visio/document.xml", documentXml());
  parts.set("visio/_rels/document.xml.rels", documentRels());
  parts.set("visio/pages/pages.xml", pagesXml(input.pages));
  parts.set("visio/pages/_rels/pages.xml.rels", pagesRels(input.pages));
  parts.set("visio/windows.xml", windowsXml(input.pages[0]));
  parts.set("docProps/core.xml", coreXml(title, creator, now));
  parts.set("docProps/app.xml", appXml(input.pages.map((page) => page.name)));
  parts.set("docProps/custom.xml", customXml(now));
  parts.set("_rels/.rels", packageRels());

  for (const page of input.pages) {
    parts.set(`visio/pages/${page.fileName}`, page.xml);
    if (page.relsXml) {
      parts.set(`visio/pages/_rels/${page.fileName}.rels`, page.relsXml);
    }
  }
  for (const media of input.media) {
    parts.set(media.path, media.data);
  }

  const extensions = new Set(input.media.map((media) => media.extension.toLowerCase()));
  parts.set("[Content_Types].xml", contentTypesXml(input.pages, extensions));

  const files: Record<string, Uint8Array> = {};
  for (const [name, body] of parts) {
    files[name] = typeof body === "string" ? strToU8(body) : body;
  }
  return zipSync(files, { level: 6 });
}

function documentXml(): string {
  const faces = VISIO_FACE_NAMES.map(
    (name) => `<FaceName NameU="${xmlEscape(name)}" Name="${xmlEscape(name)}" Flags="325"/>`,
  ).join("");
  return `<?xml version="1.0" encoding="utf-8"?>
<VisioDocument xmlns="${NS_MAIN}" xmlns:r="${NS_REL}" xml:space="preserve"><DocumentSettings TopPage="0" DefaultTextStyle="0" DefaultLineStyle="0" DefaultFillStyle="0" DefaultGuideStyle="4"><GlueSettings>9</GlueSettings><SnapSettings>65847</SnapSettings><SnapExtensions>34</SnapExtensions><DynamicGridEnabled>1</DynamicGridEnabled><ProtectStyles>0</ProtectStyles><ProtectShapes>0</ProtectShapes><ProtectMasters>0</ProtectMasters><ProtectBkgnds>0</ProtectBkgnds></DocumentSettings><Colors><ColorEntry IX="24" RGB="#7F7F7F"/><ColorEntry IX="25" RGB="#FFFFFF"/></Colors><FaceNames>${faces}</FaceNames>${BUILTIN_STYLE_SHEETS}<DocumentSheet NameU="TheDoc" Name="TheDoc" LineStyle="0" FillStyle="0" TextStyle="0">${cell("OutputFormat", 0)}${cell("LockPreview", 0)}${cell("AddMarkup", 0)}${cell("ViewMarkup", 0)}${cell("PreviewQuality", 0)}${cell("PreviewScope", 0)}${cell("DocLangID", 1033)}</DocumentSheet></VisioDocument>`;
}

function documentRels(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${NS_PKG_REL}"><Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/pages" Target="pages/pages.xml"/><Relationship Id="rId2" Type="http://schemas.microsoft.com/visio/2010/relationships/windows" Target="windows.xml"/></Relationships>`;
}

function packageRels(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${NS_PKG_REL}"><Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/document" Target="visio/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" Target="docProps/custom.xml"/></Relationships>`;
}

function pagesXml(pages: VsdxPagePart[]): string {
  const body = pages
    .map((page, index) => {
      const orient = page.widthIn >= page.heightIn ? 2 : 1;
      return `<Page ID="${index}" NameU="${xmlEscape(page.name)}" Name="${xmlEscape(page.name)}" ViewScale="1" ViewCenterX="${num(page.widthIn / 2)}" ViewCenterY="${num(page.heightIn / 2)}"><PageSheet LineStyle="0" FillStyle="0" TextStyle="0">${cell("PageWidth", page.widthIn)}${cell("PageHeight", page.heightIn)}${cell("ShdwOffsetX", 0.125)}${cell("ShdwOffsetY", -0.125)}${cell("PageScale", 1, undefined, "IN")}${cell("DrawingScale", 1, undefined, "IN")}${cell("DrawingSizeType", 0)}${cell("DrawingScaleType", 0)}${cell("InhibitSnap", 0)}${cell("PageLockReplace", 0, undefined, "BOOL")}${cell("PageLockDuplicate", 0, undefined, "BOOL")}${cell("UIVisibility", 0)}${cell("ShdwType", 0)}${cell("ShdwObliqueAngle", 0)}${cell("ShdwScaleFactor", 1)}${cell("DrawingResizeType", 1)}${cell("PrintPageOrientation", orient)}</PageSheet><Rel r:id="rId${index + 1}"/></Page>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="utf-8"?>
<Pages xmlns="${NS_MAIN}" xmlns:r="${NS_REL}" xml:space="preserve">${body}</Pages>`;
}

function pagesRels(pages: VsdxPagePart[]): string {
  const rels = pages
    .map(
      (page, index) =>
        `<Relationship Id="rId${index + 1}" Type="http://schemas.microsoft.com/visio/2010/relationships/page" Target="${page.fileName}"/>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${NS_PKG_REL}">${rels}</Relationships>`;
}

function windowsXml(page: VsdxPagePart | undefined): string {
  const cx = page ? page.widthIn / 2 : 4.25;
  const cy = page ? page.heightIn / 2 : 5.5;
  return `<?xml version="1.0" encoding="utf-8"?>
<Windows ClientWidth="1600" ClientHeight="900" xmlns="${NS_MAIN}" xmlns:r="${NS_REL}" xml:space="preserve"><Window ID="0" WindowType="Drawing" WindowState="1073741824" WindowLeft="0" WindowTop="0" WindowWidth="1600" WindowHeight="900" ContainerType="Page" Page="0" ViewScale="1" ViewCenterX="${num(cx)}" ViewCenterY="${num(cy)}"><ShowRulers>1</ShowRulers><ShowGrid>0</ShowGrid><ShowPageBreaks>0</ShowPageBreaks><ShowGuides>1</ShowGuides><ShowConnectionPoints>1</ShowConnectionPoints><GlueSettings>9</GlueSettings><SnapSettings>65847</SnapSettings><SnapExtensions>34</SnapExtensions><DynamicGridEnabled>0</DynamicGridEnabled><TabSplitterPos>0.5</TabSplitterPos></Window></Windows>`;
}

function coreXml(title: string, creator: string, now: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEscape(title)}</dc:title><dc:subject>Converted from Excalidraw</dc:subject><dc:creator>${xmlEscape(creator)}</dc:creator><cp:lastModifiedBy>${xmlEscape(creator)}</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
}

function appXml(pageNames: string[]): string {
  const names = pageNames.length ? pageNames : ["Page-1"];
  const titles = names.map((name) => `<vt:lpstr>${xmlEscape(name)}</vt:lpstr>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>excalidraw2vsdx</Application><AppVersion>1.0</AppVersion><HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Pages</vt:lpstr></vt:variant><vt:variant><vt:i4>${names.length}</vt:i4></vt:variant></vt:vector></HeadingPairs><TitlesOfParts><vt:vector size="${names.length}" baseType="lpstr">${titles}</vt:vector></TitlesOfParts></Properties>`;
}

function customXml(now: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="IsMetric"><vt:bool>false</vt:bool></property><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="3" name="Generator"><vt:lpwstr>excalidraw2vsdx</vt:lpwstr></property><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="4" name="TimeConverted"><vt:filetime>${now}</vt:filetime></property></Properties>`;
}

function contentTypesXml(pages: VsdxPagePart[], extensions: Set<string>): string {
  const defaults = [
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`,
    `<Default Extension="xml" ContentType="application/xml"/>`,
  ];
  for (const ext of [...extensions].sort()) {
    const type = IMAGE_CONTENT_TYPES[ext];
    if (type) defaults.push(`<Default Extension="${ext}" ContentType="${type}"/>`);
  }
  const overrides = [
    `<Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.drawing.main+xml"/>`,
    `<Override PartName="/visio/pages/pages.xml" ContentType="application/vnd.ms-visio.pages+xml"/>`,
    ...pages.map(
      (page) =>
        `<Override PartName="/visio/pages/${page.fileName}" ContentType="application/vnd.ms-visio.page+xml"/>`,
    ),
    `<Override PartName="/visio/windows.xml" ContentType="application/vnd.ms-visio.windows+xml"/>`,
    `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>`,
    `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>`,
    `<Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/>`,
  ];
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${defaults.join("")}${overrides.join("")}</Types>`;
}

export function pageRelsXml(
  images: Array<{ relId: string; target: string }>,
): string | undefined {
  if (!images.length) return undefined;
  const rels = images
    .map(
      (image) =>
        `<Relationship Id="${image.relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${xmlEscape(image.target)}"/>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${NS_PKG_REL}">${rels}</Relationships>`;
}
