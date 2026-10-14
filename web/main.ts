import { convertExcalidraw, type ConvertResult } from "../src/index.ts";

const drop = document.querySelector<HTMLElement>("#drop")!;
const fileInput = document.querySelector<HTMLInputElement>("#file")!;
const resultEl = document.querySelector<HTMLElement>("#result")!;
const errorEl = document.querySelector<HTMLElement>("#error")!;
const fileNameEl = document.querySelector<HTMLElement>("#file-name")!;
const fileMetaEl = document.querySelector<HTMLElement>("#file-meta")!;
const pagesEl = document.querySelector<HTMLElement>("#pages")!;
const notesEl = document.querySelector<HTMLElement>("#notes")!;
const downloadBtn = document.querySelector<HTMLButtonElement>("#download")!;

let latest: { name: string; result: ConvertResult } | null = null;

drop.addEventListener("click", () => fileInput.click());
drop.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    fileInput.click();
  }
});

["dragenter", "dragover"].forEach((type) => {
  drop.addEventListener(type, (event) => {
    event.preventDefault();
    drop.classList.add("over");
  });
});

["dragleave", "drop"].forEach((type) => {
  drop.addEventListener(type, (event) => {
    event.preventDefault();
    drop.classList.remove("over");
  });
});

drop.addEventListener("drop", (event) => {
  const file = event.dataTransfer?.files?.[0];
  if (file) void loadFile(file);
});

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) void loadFile(file);
});

downloadBtn.addEventListener("click", () => {
  if (!latest) return;
  const blob = new Blob([latest.result.vsdx], {
    type: "application/vnd.ms-visio.drawing",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = latest.name.replace(/\.(excalidrawlib|excalidraw|json)$/i, "") + ".vsdx";
  link.click();
  URL.revokeObjectURL(url);
});

async function loadFile(file: File): Promise<void> {
  errorEl.hidden = true;
  resultEl.hidden = true;
  try {
    const text = await file.text();
    const result = convertExcalidraw(text, { title: file.name });
    latest = { name: file.name, result };
    render(file.name, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errorEl.hidden = false;
    errorEl.textContent = message;
  }
}

function render(name: string, result: ConvertResult): void {
  const shapes = result.pages.reduce((sum, page) => sum + page.shapes, 0);
  const glued = result.pages.reduce((sum, page) => sum + page.gluedEndpoints, 0);
  fileNameEl.textContent = name;
  fileMetaEl.textContent = `${result.pages.length} page${result.pages.length === 1 ? "" : "s"} · ${shapes} shapes · ${glued} glued endpoints · ${(result.vsdx.byteLength / 1024).toFixed(1)} KB`;
  pagesEl.replaceChildren(
    ...result.pages.map((page) => {
      const card = document.createElement("article");
      card.className = "page";
      const title = document.createElement("h2");
      title.textContent = page.name;
      const meta = document.createElement("p");
      meta.textContent = `${page.widthInches.toFixed(2)} × ${page.heightInches.toFixed(2)} in. ${page.shapes} shapes, ${page.groups} groups, ${page.connectors} connectors, ${page.images} images.`;
      card.append(title, meta);
      return card;
    }),
  );
  const notes = result.pages.flatMap((page) => page.warnings);
  notesEl.hidden = notes.length === 0;
  notesEl.replaceChildren(
    ...notes.map((note) => {
      const item = document.createElement("li");
      item.textContent = note;
      return item;
    }),
  );
  resultEl.hidden = false;
}
