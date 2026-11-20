// Extracción de texto con posiciones de un PDF, en el navegador (pdf.js). Sin OCR ni servicios externos.
// Devuelve { ok, pages:[{n,width,height,items:[{str,x,y,w,h}]}], chars, warnings } o { ok:false, reason, message }.
import { getPdfjs } from "./pdfjs-loader.js";

export const EXTRACT_ERRORS = {
  escaneado: "El PDF no contiene texto seleccionable (parece escaneado o es una imagen). No se usa OCR: completa la planificación manualmente.",
  protegido: "El PDF está protegido con contraseña y no se puede leer.",
  ilegible: "El fichero no se puede leer como PDF.",
  vacio: "El fichero está vacío.",
};
export async function extractPdf(data, { pdfjs } = {}) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (!bytes.length) return { ok: false, reason: "vacio", message: EXTRACT_ERRORS.vacio };
  let doc;
  try {
    const lib = pdfjs || (await getPdfjs());
    doc = await lib.getDocument({ data: bytes.slice(), isEvalSupported: false, useSystemFonts: false, verbosity: 0, disableFontFace: true }).promise;
  } catch (e) {
    if (e && (e.name === "PasswordException" || /password/i.test(e.message || ""))) return { ok: false, reason: "protegido", message: EXTRACT_ERRORS.protegido };
    return { ok: false, reason: "ilegible", message: EXTRACT_ERRORS.ilegible };
  }
  const pages = [], warnings = []; let chars = 0;
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n); const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items = tc.items.filter((t) => typeof t.str === "string" && t.str.trim() !== "").map((t) => ({ str: t.str.replace(/\s+/g, " ").trim(), x: t.transform[4], y: t.transform[5], w: t.width, h: Math.abs(t.height || t.transform[3] || 9) }));
    items.forEach((i) => (chars += i.str.length));
    pages.push({ n, width: vp.width, height: vp.height, items });
  }
  try { await doc.destroy(); } catch (e) { /* nada */ }
  if (chars < 20) return { ok: false, reason: "escaneado", message: EXTRACT_ERRORS.escaneado, pageCount: pages.length };
  pages.filter((p) => p.items.length === 0).forEach((p) => warnings.push(`La página ${p.n} no tiene texto extraíble: revisa su contenido manualmente.`));
  return { ok: true, pages, chars, warnings };
}

// SHA-256 del contenido (para detectar reimportaciones). No se guarda el fichero ni su nombre.
export async function hashBytes(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  try {
    if (globalThis.crypto && globalThis.crypto.subtle) {
      const d = await globalThis.crypto.subtle.digest("SHA-256", bytes);
      return "sha256:" + [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
    }
  } catch (e) { /* contexto no seguro */ }
  let h1 = 0xdeadbeef ^ bytes.length, h2 = 0x41c6ce57 ^ bytes.length; // respaldo no criptográfico
  for (let i = 0; i < bytes.length; i++) { h1 = Math.imul(h1 ^ bytes[i], 2654435761); h2 = Math.imul(h2 ^ bytes[i], 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909); h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return "h53:" + (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}
