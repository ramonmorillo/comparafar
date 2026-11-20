// Carga perezosa de pdf.js (build «legacy»). Todo se ejecuta en el navegador: el PDF no sale del equipo.
// En el HTML compilado el worker va incrustado (módulo virtual «virtual:pdf-worker», ver build/build.mjs).
let lib = null;
export async function getPdfjs() {
  if (lib) return lib;
  const mod = await import("pdfjs-dist/legacy/build/pdf.min.mjs");
  if (typeof window !== "undefined" && typeof Worker !== "undefined" && typeof Blob !== "undefined" && typeof URL !== "undefined") {
    try {
      const w = await import("virtual:pdf-worker");
      mod.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([w.default], { type: "text/javascript" }));
    } catch (e) { /* sin worker incrustado: pdf.js usará el modo de compatibilidad */ }
  }
  lib = mod; return lib;
}
