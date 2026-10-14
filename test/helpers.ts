import { strFromU8, unzipSync } from "fflate";
import { DOMParser } from "@xmldom/xmldom";
import { convertExcalidraw, type ConvertResult } from "../src/index.js";

export function pageXml(result: ConvertResult, index = 0): string {
  const files = unzipSync(result.vsdx);
  const name = `visio/pages/page${index + 1}.xml`;
  const data = files[name];
  if (!data) throw new Error(`Missing ${name}. Parts: ${Object.keys(files).join(", ")}`);
  return strFromU8(data);
}

export function packageText(result: ConvertResult, path: string): string {
  const files = unzipSync(result.vsdx);
  const data = files[path];
  if (!data) throw new Error(`Missing ${path}. Parts: ${Object.keys(files).join(", ")}`);
  return strFromU8(data);
}

export function packageParts(result: ConvertResult): string[] {
  return Object.keys(unzipSync(result.vsdx)).sort();
}

export function assertWellFormed(xml: string, label: string): void {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const errors = doc.getElementsByTagName("parsererror");
  if (errors.length > 0) {
    throw new Error(`${label} is not well-formed XML: ${errors[0].textContent}`);
  }
}

export function cellValue(xml: string, shapeId: string, cellName: string): string | undefined {
  const shape = xml.match(new RegExp(`<Shape ID="${shapeId}"[\\s\\S]*?</Shape>`));
  if (!shape) return undefined;
  const cell = shape[0].match(new RegExp(`<Cell N="${cellName}" V="([^"]*)"`));
  return cell?.[1];
}

export function convertScene(
  elements: unknown[],
  options?: Parameters<typeof convertExcalidraw>[1],
): ConvertResult {
  return convertExcalidraw(
    { type: "excalidraw", version: 2, elements, files: {} },
    { marginInches: 0, ...options },
  );
}
