export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Escape text node content and turn newlines into numeric character references. */
export function xmlText(value: string): string {
  const cleaned = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  return cleaned
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r\n|\r|\n/g, "&#10;");
}

export function num(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 1e6) / 1e6;
  if (Object.is(rounded, -0)) return "0";
  return String(rounded);
}

export function cell(
  name: string,
  value: number | string,
  formula?: string,
  unit?: string,
): string {
  const v = typeof value === "number" ? num(value) : xmlEscape(value);
  let out = `<Cell N="${xmlEscape(name)}" V="${v}"`;
  if (formula) out += ` F="${xmlEscape(formula)}"`;
  if (unit) out += ` U="${xmlEscape(unit)}"`;
  return `${out}/>`;
}

export function pageName(raw: string, index: number): string {
  const cleaned = raw
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const base = cleaned || `Page-${index + 1}`;
  return base.slice(0, 31);
}
