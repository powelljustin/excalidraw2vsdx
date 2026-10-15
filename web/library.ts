import { adminToken, apiJson, setAdminToken, type LibraryView } from "./client.ts";
import { releasePreviews, rememberToken, renderLibraryCard } from "./cards.ts";

const list = document.querySelector<HTMLElement>("#list")!;
const empty = document.querySelector<HTMLElement>("#empty")!;
const errorEl = document.querySelector<HTMLElement>("#error")!;
const summary = document.querySelector<HTMLElement>("#summary")!;
const queryInput = document.querySelector<HTMLInputElement>("#q")!;
const tagInput = document.querySelector<HTMLInputElement>("#tag")!;
const tokenInput = document.querySelector<HTMLInputElement>("#token")!;
const form = document.querySelector<HTMLFormElement>("#filters")!;

tokenInput.value = adminToken();
rememberToken(tokenInput);
tokenInput.addEventListener("change", () => void load());

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void load();
});
queryInput.addEventListener("input", () => void load());
tagInput.addEventListener("input", () => void load());

document.querySelector("#clear")?.addEventListener("click", () => {
  queryInput.value = "";
  tagInput.value = "";
  void load();
});

void load();

async function load(): Promise<void> {
  setAdminToken(tokenInput.value);
  errorEl.hidden = true;
  summary.textContent = "Loading…";
  const params = new URLSearchParams();
  if (queryInput.value.trim()) params.set("q", queryInput.value.trim());
  if (tagInput.value.trim()) params.set("tag", tagInput.value.trim());
  const query = params.toString();
  try {
    const data = await apiJson<{ libraries: LibraryView[] }>(`/api/libraries${query ? `?${query}` : ""}`);
    releasePreviews();
    list.replaceChildren(
      ...data.libraries.map((library) =>
        renderLibraryCard(library, {
          editable: true,
          onReload: () => void load(),
          onTag: (tag) => {
            tagInput.value = tag;
            void load();
          },
        }),
      ),
    );
    const searching = queryInput.value.trim().length > 0 || tagInput.value.trim().length > 0;
    empty.hidden = data.libraries.length > 0;
    empty.replaceChildren();
    if (data.libraries.length === 0) {
      empty.append(searching ? "Nothing matches that search." : "No libraries yet. ");
      if (!searching) {
        const link = document.createElement("a");
        link.href = "/upload.html";
        link.textContent = "Upload one";
        empty.append(link);
      }
    }
    summary.textContent = data.libraries.length === 0
      ? ""
      : `${data.libraries.length} librar${data.libraries.length === 1 ? "y" : "ies"}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errorEl.hidden = false;
    errorEl.textContent = message;
  }
}
