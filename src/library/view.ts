import type { AccessLevel } from "./access.js";
import type { StoredItem, StoredLibrary } from "./store.js";

export interface ItemView {
  id: string;
  name: string;
  description: string;
  tags: string[];
  access: AccessLevel;
  /** True when this caller may not download or preview the item. */
  locked: boolean;
  elementCount: number;
  previewUrl: string;
  downloadUrl: string;
  vsdxUrl: string;
}

export interface LibraryView {
  id: string;
  name: string;
  description: string;
  tags: string[];
  access: AccessLevel;
  /** True when this caller may not download the library or its files. */
  locked: boolean;
  filename: string;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
  downloadUrl: string;
  items: ItemView[];
}

export function toLibraryView(library: StoredLibrary): LibraryView {
  return {
    id: library.id,
    name: library.name,
    description: library.description,
    tags: library.tags,
    access: library.access,
    filename: library.filename,
    createdAt: library.createdAt,
    updatedAt: library.updatedAt,
    itemCount: library.items.length,
    locked: false,
    downloadUrl: `/api/libraries/${library.id}/download`,
    items: library.items.map((item) => toItemView(library.id, item)),
  };
}

function toItemView(libraryId: string, item: StoredItem): ItemView {
  const base = `/api/libraries/${libraryId}/items/${item.id}`;
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    tags: item.tags,
    access: item.access,
    locked: false,
    elementCount: item.elementCount,
    previewUrl: `${base}/preview.png`,
    downloadUrl: `${base}/download`,
    vsdxUrl: `${base}/vsdx`,
  };
}
