/**
 * Octets for the viewers (RULES.md D39): a binary string's hexadecimal
 * text, or a large object's Base64, as octets; octets as a hexadecimal
 * dump; and the kind of image octets are, by their first octets.
 */

/** The octets of `hex`, Turborel's text of a binary string: null if it is none. */
export function fromHex(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || !/^[0-9A-F]*$/iu.test(hex)) {
    return null;
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** The octets of `base64`. */
export function fromBase64(base64: string): Uint8Array {
  const text = atob(base64);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) {
    bytes[i] = text.charCodeAt(i);
  }
  return bytes;
}

/** `bytes` in Base64. */
export function toBase64(bytes: Uint8Array): string {
  let text = "";
  for (const b of bytes) {
    text += String.fromCharCode(b);
  }
  return btoa(text);
}

/** Octets a dump's line shows. */
const LINE = 16;
/** The most octets a dump shows. */
export const MAX_DUMP_BYTES = 64 * 1024;

/** `bytes` as a dump: each line its offset, sixteen octets in hexadecimal, and those printable as ASCII. */
export function hexDump(bytes: Uint8Array): string {
  const lines: string[] = [];
  const shown = Math.min(bytes.length, MAX_DUMP_BYTES);
  for (let at = 0; at < shown; at += LINE) {
    const chunk = [...bytes.subarray(at, Math.min(at + LINE, shown))];
    const hex = chunk.map((b) => b.toString(16).padStart(2, "0")).join(" ");
    const ascii = chunk.map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".")).join("");
    lines.push(`${at.toString(16).padStart(8, "0")}  ${hex.padEnd(LINE * 3 - 1)}  ${ascii}`);
  }
  if (bytes.length > shown) {
    lines.push(`… ${String(bytes.length - shown)} more octets`);
  }
  return lines.join("\n");
}

/** The images a viewer shows, by their first octets: SVG is not among them, as it may hold script. */
const IMAGES: readonly (readonly [string, readonly number[]])[] = [
  ["image/png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  ["image/jpeg", [0xff, 0xd8, 0xff]],
  ["image/gif", [0x47, 0x49, 0x46, 0x38]],
  ["image/bmp", [0x42, 0x4d]],
];

/** The type of image `bytes` are, if one a viewer shows. */
export function imageType(bytes: Uint8Array): string | null {
  const riff = [0x52, 0x49, 0x46, 0x46].every((b, i) => bytes[i] === b);
  if (riff && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP") {
    return "image/webp";
  }
  return IMAGES.find(([, magic]) => magic.every((b, i) => bytes[i] === b))?.[0] ?? null;
}
