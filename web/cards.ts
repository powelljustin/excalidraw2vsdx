import {
  apiJson,
  authHeaders,
  formatDate,
  safeFileName,
  saveUrl,
  setAdminToken,
  type ItemView,
  type LibraryView,
} from "./client.ts";

const objectUrls: string[] = [];

export function releasePreviews(): void {
  for (const url of objectUrls) URL.revokeObjectURL(url);
  objectUrls.length = 0;
}

export function renderLibraryCard(
  library: LibraryView,
  options: { editable: boolean; onTag?: (tag: string) => void; onReload?: () => void },
): HTMLElement {
  const card = document.createElement("article");
  card.className = "library-card";

  const head = document.createElement("div");
  head.className = "library-head";
  const titleBlock = document.createElement("div");
  const title = document.createElement("h2");
  title.textContent = library.name;
  const meta = document.createElement("p");
  meta.className = "file-meta";
  meta.textContent = `${library.itemCount} item${library.itemCount === 1 ? "" : "s"} · ${formatDate(library.createdAt)}`;
  titleBlock.append(title, meta);
  head.append(titleBlock, badge(library.access));

  const description = document.createElement("p");
  description.className = library.description ? "description" : "hint";
  description.textContent = library.description || "No description.";

  const tags = tagRow(library.tags, options.onTag);
  const actions = document.createElement("div");
  actions.className = "actions";
  if (!library.locked && library.downloadUrl) {
    actions.append(
      actionButton("Download library", () =>
        saveUrl(library.downloadUrl, safeFileName(library.filename || library.name, ".excalidrawlib")),
      ),
    );
  } else if (library.locked) {
    const note = document.createElement("p");
    note.className = "hint";
    note.textContent = "This library is marked paid. Previews and downloads stay hidden until a payment check allows them, or an admin sets it back to free.";
    actions.append(note);
  }

  card.append(head, description, tags, actions);

  if (options.editable && options.onReload) {
    card.append(editLibrary(library, options.onReload));
  }

  const grid = document.createElement("div");
  grid.className = "item-grid";
  for (const item of library.items) {
    grid.append(renderItem(library, item, options));
  }
  card.append(grid);
  return card;
}

function renderItem(
  library: LibraryView,
  item: ItemView,
  options: { editable: boolean; onTag?: (tag: string) => void; onReload?: () => void },
): HTMLElement {
  const card = document.createElement("article");
  card.className = "item-card";

  const frame = document.createElement("div");
  frame.className = "preview";
  if (item.locked || !item.previewUrl) {
    frame.classList.add("locked");
    const label = document.createElement("p");
    label.textContent = "Preview hidden";
    frame.append(label);
  } else {
    const image = document.createElement("img");
    image.alt = `Preview of ${item.name}`;
    image.decoding = "async";
    void loadPreview(image, item.previewUrl);
    frame.append(image);
  }

  const title = document.createElement("h3");
  title.textContent = item.name;
  const meta = document.createElement("p");
  meta.className = "file-meta";
  meta.textContent = `${item.elementCount} element${item.elementCount === 1 ? "" : "s"}`;
  const description = document.createElement("p");
  description.className = item.description ? "description" : "hint";
  description.textContent = item.description || "No description.";

  const actions = document.createElement("div");
  actions.className = "actions";
  if (!item.locked && item.downloadUrl && item.vsdxUrl) {
    actions.append(
      actionButton("Download .excalidrawlib", () =>
        saveUrl(item.downloadUrl, safeFileName(item.name, ".excalidrawlib")),
      ),
      actionButton(
        "Convert to Visio (.vsdx)",
        () => saveUrl(item.vsdxUrl, safeFileName(item.name, ".vsdx")),
        true,
      ),
    );
  }

  card.append(frame, title, meta, description, tagRow(item.tags, options.onTag), badge(item.access), actions);
  if (options.editable && options.onReload) card.append(editItem(library, item, options.onReload));
  return card;
}

async function loadPreview(image: HTMLImageElement, url: string): Promise<void> {
  try {
    const headers = authHeaders();
    if (!headers.has("x-admin-token")) {
      image.src = url;
      return;
    }
    const response = await fetch(url, { headers });
    if (!response.ok) {
      image.alt = "Preview unavailable";
      return;
    }
    const objectUrl = URL.createObjectURL(await response.blob());
    objectUrls.push(objectUrl);
    image.src = objectUrl;
  } catch {
    image.alt = "Preview unavailable";
  }
}

function editLibrary(library: LibraryView, onReload: () => void): HTMLElement {
  const details = document.createElement("details");
  details.className = "editor";
  const summary = document.createElement("summary");
  summary.textContent = "Edit library";
  const form = document.createElement("form");
  form.className = "stack compact";
  const name = labeledInput("Name", library.name);
  const description = labeledArea("Description", library.description);
  const tags = labeledInput("Tags", library.tags.join(", "));
  const access = labeledSelect(library.access);
  const remove = actionButton("Delete library", async () => {
    if (!confirm(`Delete “${library.name}”? This removes its items and previews.`)) return;
    await apiJson(`/api/libraries/${library.id}`, { method: "DELETE" });
    onReload();
  });
  remove.classList.add("danger");
  form.append(name.label, description.label, tags.label, access.label, saveRow(async () => {
    await apiJson(`/api/libraries/${library.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: name.input.value,
        description: description.input.value,
        tags: splitTags(tags.input.value),
        access: access.select.value,
      }),
    });
    onReload();
  }), remove);
  form.addEventListener("submit", (event) => event.preventDefault());
  details.append(summary, form);
  return details;
}

function editItem(library: LibraryView, item: ItemView, onReload: () => void): HTMLElement {
  const details = document.createElement("details");
  details.className = "editor";
  const summary = document.createElement("summary");
  summary.textContent = "Edit item";
  const form = document.createElement("form");
  form.className = "stack compact";
  const name = labeledInput("Name", item.name);
  const description = labeledArea("Description", item.description);
  const tags = labeledInput("Tags", item.tags.join(", "));
  const access = labeledSelect(item.access);
  form.append(name.label, description.label, tags.label, access.label, saveRow(async () => {
    await apiJson(`/api/libraries/${library.id}/items/${item.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: name.input.value,
        description: description.input.value,
        tags: splitTags(tags.input.value),
        access: access.select.value,
      }),
    });
    onReload();
  }));
  form.addEventListener("submit", (event) => event.preventDefault());
  details.append(summary, form);
  return details;
}

function saveRow(save: () => Promise<void>): HTMLButtonElement {
  return actionButton("Save", save, true);
}

function actionButton(label: string, run: () => Promise<void>, primary = false): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  if (!primary) button.classList.add("secondary");
  button.addEventListener("click", () => {
    button.disabled = true;
    void run()
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        window.alert(message);
      })
      .finally(() => {
        button.disabled = false;
      });
  });
  return button;
}

function tagRow(tags: string[], onTag?: (tag: string) => void): HTMLElement {
  const row = document.createElement("div");
  row.className = "tags";
  for (const tag of tags) {
    if (!onTag) {
      const chip = document.createElement("span");
      chip.className = "tag";
      chip.textContent = tag;
      row.append(chip);
      continue;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tag";
    button.textContent = tag;
    button.addEventListener("click", () => onTag(tag));
    row.append(button);
  }
  return row;
}

function badge(access: "free" | "paid"): HTMLElement {
  const node = document.createElement("span");
  node.className = access === "paid" ? "badge paid" : "badge";
  node.textContent = access;
  return node;
}

function labeledInput(labelText: string, value: string): { label: HTMLLabelElement; input: HTMLInputElement } {
  const label = document.createElement("label");
  label.textContent = labelText;
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  label.append(input);
  return { label, input };
}

function labeledArea(labelText: string, value: string): { label: HTMLLabelElement; input: HTMLTextAreaElement } {
  const label = document.createElement("label");
  label.textContent = labelText;
  const input = document.createElement("textarea");
  input.rows = 3;
  input.value = value;
  label.append(input);
  return { label, input };
}

function labeledSelect(value: "free" | "paid"): { label: HTMLLabelElement; select: HTMLSelectElement } {
  const label = document.createElement("label");
  label.textContent = "Access";
  const select = document.createElement("select");
  for (const optionValue of ["free", "paid"] as const) {
    const option = document.createElement("option");
    option.value = optionValue;
    option.textContent = optionValue === "free" ? "Free" : "Paid";
    if (optionValue === value) option.selected = true;
    select.append(option);
  }
  label.append(select);
  return { label, select };
}

function splitTags(value: string): string[] {
  return value.split(",").map((tag) => tag.trim()).filter(Boolean);
}

export function rememberToken(input: HTMLInputElement): void {
  const save = () => setAdminToken(input.value);
  input.addEventListener("input", save);
  input.addEventListener("change", save);
}
