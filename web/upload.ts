import { adminToken, apiJson, setAdminToken, type LibraryView } from "./client.ts";
import { releasePreviews, rememberToken, renderLibraryCard } from "./cards.ts";

const MAX_BYTES = 20 * 1024 * 1024;

const form = document.querySelector<HTMLFormElement>("#upload")!;
const fileInput = document.querySelector<HTMLInputElement>("#file")!;
const nameInput = document.querySelector<HTMLInputElement>("#name")!;
const descriptionInput = document.querySelector<HTMLTextAreaElement>("#description")!;
const tagsInput = document.querySelector<HTMLInputElement>("#tags")!;
const accessInput = document.querySelector<HTMLSelectElement>("#access")!;
const tokenInput = document.querySelector<HTMLInputElement>("#token")!;
const errorEl = document.querySelector<HTMLElement>("#error")!;
const resultEl = document.querySelector<HTMLElement>("#result")!;
const submit = document.querySelector<HTMLButtonElement>("#submit")!;

tokenInput.value = adminToken();
rememberToken(tokenInput);

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file && !nameInput.value.trim()) {
    nameInput.value = file.name.replace(/\.(excalidrawlib|excalidraw|json)$/i, "").replace(/[_-]+/g, " ");
  }
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void upload();
});

async function upload(): Promise<void> {
  errorEl.hidden = true;
  resultEl.hidden = true;
  const file = fileInput.files?.[0];
  if (!file) {
    showError("Choose an .excalidrawlib or .excalidraw file.");
    return;
  }
  if (!/\.(excalidrawlib|excalidraw|json)$/i.test(file.name)) {
    showError("Upload an .excalidrawlib, .excalidraw, or .json file.");
    return;
  }
  if (file.size > MAX_BYTES) {
    showError("That file is larger than 20 MB.");
    return;
  }
  setAdminToken(tokenInput.value);
  submit.disabled = true;
  try {
    const text = (await file.text()).replace(/^\uFEFF/, "");
    let documentJson: unknown;
    try {
      documentJson = JSON.parse(text);
    } catch {
      showError("That file is not valid JSON.");
      return;
    }
    const data = await apiJson<{ library: LibraryView }>("/api/libraries", {
      method: "POST",
      body: JSON.stringify({
        filename: file.name,
        name: nameInput.value.trim(),
        description: descriptionInput.value.trim(),
        tags: tagsInput.value.split(",").map((tag) => tag.trim()).filter(Boolean),
        access: accessInput.value,
        document: documentJson,
      }),
    });
    releasePreviews();
    resultEl.hidden = false;
    const note = document.createElement("p");
    note.className = "hint";
    note.textContent = data.library.access === "paid"
      ? "Saved. Paid libraries stay hidden from the public library until a payment check is added. Open the library page with the same admin token to see this one."
      : "Saved. The previews below are generated on the server.";
    const link = document.createElement("p");
    const anchor = document.createElement("a");
    anchor.href = "/library.html";
    anchor.textContent = "Browse the library";
    link.append(anchor);
    resultEl.replaceChildren(note, link, renderLibraryCard(data.library, { editable: false }));
    form.reset();
    tokenInput.value = adminToken();
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  } finally {
    submit.disabled = false;
  }
}

function showError(message: string): void {
  errorEl.hidden = false;
  errorEl.textContent = message;
}
