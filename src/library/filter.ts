import type { LibraryView } from "./view.js";

export interface LibraryQuery {
  q?: string;
  tag?: string;
}

/**
 * Keep a library when its name, description, or tags match, or when any item does.
 * A tag on the library applies to every item in it. A tag on an item applies to that item.
 */
export function filterLibraries(libraries: LibraryView[], query: LibraryQuery): LibraryView[] {
  const q = (query.q ?? "").trim().toLowerCase();
  const tag = (query.tag ?? "").trim().toLowerCase();
  if (!q && !tag) return libraries;

  const matched: LibraryView[] = [];
  for (const library of libraries) {
    const libraryText = matchesText(library, q);
    const libraryTag = !tag || hasTag(library.tags, tag);
    const items = library.items.filter((item) => {
      const textOk = !q || libraryText || matchesText(item, q);
      const tagOk = !tag || libraryTag || hasTag(item.tags, tag);
      return textOk && tagOk;
    });
    const showEmpty = library.items.length === 0 && libraryText && libraryTag;
    if (items.length === 0 && !showEmpty) continue;
    matched.push({ ...library, items, itemCount: items.length });
  }
  return matched;
}

function matchesText(
  entry: { name: string; description: string; tags: string[] },
  q: string,
): boolean {
  if (!q) return true;
  const haystack = `${entry.name}\n${entry.description}\n${entry.tags.join("\n")}`.toLowerCase();
  return haystack.includes(q);
}

function hasTag(tags: string[], tag: string): boolean {
  return tags.some((value) => value.toLowerCase() === tag);
}
