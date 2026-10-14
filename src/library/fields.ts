import type { AccessLevel } from "./access.js";
import { LibraryError } from "./errors.js";

const MAX_NAME = 120;
const MAX_DESCRIPTION = 2000;
const MAX_TAGS = 24;
const MAX_TAG = 40;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeName(input: unknown, fallback: string): string {
  const raw = typeof input === "string" && input.trim() ? input : fallback;
  const name = raw.replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
  if (!name) throw new LibraryError("A name is required.");
  return name;
}

export function normalizeDescription(input: unknown): string {
  if (input == null) return "";
  if (typeof input !== "string") throw new LibraryError("Description must be text.");
  const description = input.replace(/\r\n/g, "\n").trim();
  if (description.length > MAX_DESCRIPTION) {
    throw new LibraryError(`Description must be ${MAX_DESCRIPTION} characters or fewer.`);
  }
  return description;
}

export function normalizeTags(input: unknown): string[] {
  const parts = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(",")
      : input == null
        ? []
        : null;
  if (!parts) throw new LibraryError("Tags must be a list or a comma-separated string.");
  const tags: string[] = [];
  for (const part of parts) {
    if (typeof part !== "string") throw new LibraryError("Each tag must be text.");
    const tag = part.trim().replace(/\s+/g, " ");
    if (!tag) continue;
    if (tag.length > MAX_TAG) {
      throw new LibraryError(`Tags must be ${MAX_TAG} characters or fewer.`);
    }
    if (tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())) continue;
    tags.push(tag);
    if (tags.length > MAX_TAGS) {
      throw new LibraryError(`Use at most ${MAX_TAGS} tags.`);
    }
  }
  return tags;
}

export function normalizeAccess(input: unknown): AccessLevel {
  if (input == null || input === "") return "free";
  if (input === "free" || input === "paid") return input;
  throw new LibraryError("Access must be free or paid.");
}

export function nameFromFilename(filename: string): string {
  const base = filename.replace(/\.(excalidrawlib|excalidraw|json)$/i, "");
  const name = base.replace(/[_-]+/g, " ").trim();
  return name || "Library";
}
