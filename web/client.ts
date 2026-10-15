export const TOKEN_KEY = "excalidraw2vsdx.adminToken";

export interface ItemView {
  id: string;
  name: string;
  description: string;
  tags: string[];
  access: "free" | "paid";
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
  access: "free" | "paid";
  locked: boolean;
  filename: string;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
  downloadUrl: string;
  items: ItemView[];
}

export function adminToken(): string {
  return sessionStorage.getItem(TOKEN_KEY) ?? "";
}

export function setAdminToken(value: string): void {
  const token = value.trim();
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

export function authHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  const token = adminToken();
  if (token) headers.set("x-admin-token", token);
  return headers;
}

export async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = authHeaders(init?.headers);
  if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(url, { ...init, headers });
  const data = (await response.json().catch(() => ({}))) as { error?: unknown };
  if (!response.ok) {
    const message = typeof data.error === "string" ? data.error : `Request failed (${response.status}).`;
    throw new Error(message);
  }
  return data as T;
}

export async function saveUrl(url: string, filename: string): Promise<void> {
  const response = await fetch(url, { headers: authHeaders() });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: unknown };
    const message = typeof data.error === "string" ? data.error : `Download failed (${response.status}).`;
    throw new Error(message);
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function safeFileName(name: string, extension: string): string {
  const base = name
    .replace(/\.(excalidrawlib|excalidraw|json|vsdx)$/i, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^[._]+/, "")
    .slice(0, 80);
  return `${base || "library"}${extension}`;
}
