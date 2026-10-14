#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { convertExcalidraw } from "../src/index.js";
import { ConvertError } from "../src/parse.js";

interface Flags {
  input?: string;
  output?: string;
  pxPerInch?: number;
  margin?: number;
  help?: boolean;
}

function printHelp(): void {
  console.log(`excalidraw2vsdx — convert an Excalidraw file to a Visio .vsdx drawing

Usage
  excalidraw2vsdx <input.excalidraw> [-o out.vsdx] [options]
  excalidraw2vsdx <input.excalidrawlib> [-o out.vsdx]

Options
  -o, --output <file>     Output .vsdx path. Default: input name with .vsdx
      --px-per-inch <n>   Scene pixels per inch (default 96)
      --margin <inches>   Page margin around the drawing (default 0.5)
  -h, --help              Show this help

Library files (.excalidrawlib) become one Visio page per item.
`);
}

function parseArgs(argv: string[]): Flags {
  const flags: Flags = {};
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      flags.help = true;
    } else if (arg === "-o" || arg === "--output") {
      flags.output = argv[++i];
      if (!flags.output) throw new ConvertError("Missing value for --output.");
    } else if (arg === "--px-per-inch") {
      flags.pxPerInch = Number(argv[++i]);
      if (!Number.isFinite(flags.pxPerInch)) throw new ConvertError("--px-per-inch must be a number.");
    } else if (arg === "--margin") {
      flags.margin = Number(argv[++i]);
      if (!Number.isFinite(flags.margin)) throw new ConvertError("--margin must be a number.");
    } else if (arg.startsWith("-")) {
      throw new ConvertError(`Unknown option "${arg}".`);
    } else {
      positionals.push(arg);
    }
  }
  if (positionals.length > 1) throw new ConvertError("Pass one input file.");
  flags.input = positionals[0];
  return flags;
}

function defaultOutput(input: string): string {
  const base = basename(input).replace(/\.(excalidrawlib|excalidraw|json)$/i, "");
  return resolve(process.cwd(), `${base}.vsdx`);
}

function main(): void {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help || !flags.input) {
    printHelp();
    process.exit(flags.help ? 0 : 1);
  }
  const inputPath = resolve(flags.input);
  const outputPath = flags.output ? resolve(flags.output) : defaultOutput(inputPath);
  const json = readFileSync(inputPath, "utf8");
  const result = convertExcalidraw(json, {
    pxPerInch: flags.pxPerInch,
    marginInches: flags.margin,
    title: basename(inputPath),
  });
  writeFileSync(outputPath, result.vsdx);
  console.log(`Wrote ${outputPath}`);
  for (const page of result.pages) {
    console.log(
      `  ${page.name}: ${page.widthInches.toFixed(2)} × ${page.heightInches.toFixed(2)} in, ` +
        `${page.shapes} shapes, ${page.groups} groups, ${page.connectors} connectors, ` +
        `${page.gluedEndpoints} glued endpoints, ${page.images} images`,
    );
    for (const warning of page.warnings) console.log(`    note: ${warning}`);
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`excalidraw2vsdx: ${message}`);
  process.exit(1);
}
