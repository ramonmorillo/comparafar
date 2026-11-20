// Documentos SINTÉTICOS con el diseño de la hoja de ejemplo de Oncofar (columnas y filas multilínea). Sin datos reales.
export const X = { order: 40, type: 80, days: 200, route: 235, time: 280, comp: 365, dose: 520 };
const LH = 11;
// doc: { name, interval, cycles, comments, phases:[{ title?, interval?, cycles?, rows:[{ order, type, days, route, time, comps:[[name,dose]], obs:[...] }] }] }
export function oncofarPages(doc, { pageBreakY = 120, headerRepeat = true } = {}) {
  const pages = []; let items, y;
  const pageHeader = (first) => {
    items = []; pages.push({ items }); y = 800;
    if (first || headerRepeat) { items.push({ x: 40, y: 810, text: "Hospital Universitario de Valme" }, { x: 380, y: 810, text: "viernes, 20 de noviembre de 2026 8:13:38" }); }
    y = 780;
    if (first) {
      items.push({ x: 200, y, text: "Esquemas Antineoplásicos/Soporte", size: 11 }); y -= 22;
      items.push({ x: 40, y, text: "Nombre" }, { x: 110, y, text: doc.name }); y -= LH + 3;
      items.push({ x: 40, y, text: "Periodicidad" }, { x: 110, y, text: String(doc.interval ?? "") }, { x: 160, y, text: "Nº Máximo de Ciclos" }, { x: 270, y, text: String(doc.cycles ?? "") }, { x: 300, y, text: "Capacidad emetógena" }, { x: 400, y, text: "Moderada" }); y -= LH + 3;
      if (doc.comments) { items.push({ x: 40, y, text: "Comentarios" }, { x: 110, y, text: doc.comments }); y -= LH + 3; }
      items.push({ x: 40, y, text: "Bibliografía" }, { x: 110, y, text: "Referencia sintética de prueba. Lancet 2024." }); y -= LH + 3;
      items.push({ x: 40, y, text: "Servicios" }, { x: 130, y, text: "Diagnósticos de Localización, Indicaciones y Dianas" }); y -= LH + 3;
      items.push({ x: 40, y, text: "Hematología Clínica" }, { x: 130, y, text: "Diagnósticos de Localización:" }, { x: 250, y, text: "LINFOMA DIFUSO DE CELULAS GRANDES B" }); y -= 24;
    }
  };
  const tableHeader = () => {
    items.push({ x: 40, y, text: "Orden" }, { x: X.type, y, text: "Tipo Terapia" }, { x: X.days, y, text: "Días" }, { x: X.route, y, text: "Vía" }, { x: X.time, y, text: "T.Admin/Poso" }, { x: X.comp, y, text: "Componentes Mezcla IV" }, { x: X.dose, y, text: "Dosis Base/Intervalo" });
    y -= LH; items.push({ x: X.time, y, text: "logía" }); y -= LH + 4;
  };
  pageHeader(true);
  items.push({ x: 40, y, text: "(I) Administraciones" }); y -= 16;
  doc.phases.forEach((ph, pi) => {
    if (ph.title) { items.push({ x: 40, y, text: ph.title, size: 10 }); y -= LH + 3; }
    if (ph.interval != null || ph.cycles != null) { items.push({ x: 40, y, text: "Periodicidad" }, { x: 110, y, text: String(ph.interval ?? "") }, { x: 160, y, text: "Nº Máximo de Ciclos" }, { x: 270, y, text: String(ph.cycles ?? "") }); y -= LH + 3; }
    tableHeader();
    for (const r of ph.rows) {
      const nLines = Math.max(r.comps.length + (r.obs ? r.obs.length + 1 : 0), r.type.split("|").length);
      if (y - nLines * LH < pageBreakY) { pageHeader(false); tableHeader(); }
      const y0 = y;
      items.push({ x: X.order, y, text: String(r.order) });
      r.type.split("|").forEach((t, i) => items.push({ x: X.type, y: y0 - i * LH, text: t }));
      items.push({ x: X.days, y, text: String(r.days) }, { x: X.route, y, text: r.route || "PIV" }, { x: X.time, y, text: r.time || "000:30" });
      let k = 0;
      r.comps.forEach(([n, d]) => { items.push({ x: X.comp, y: y0 - k * LH, text: n }); if (d) items.push({ x: X.dose, y: y0 - k * LH, text: d }); k++; });
      if (r.obs) { items.push({ x: X.comp, y: y0 - k * LH, text: "Observaciones:" }); k++; r.obs.forEach((o) => { items.push({ x: X.comp, y: y0 - k * LH, text: o }); k++; }); }
      y = y0 - Math.max(k, r.type.split("|").length) * LH - 8;
    }
    y -= 6;
  });
  items.push({ x: 20, y, text: "(II)Medicación Asociada el Protocolo (Dispensación FH/Receta)" });
  pages.forEach((p) => p.items.push({ x: 20, y: 30, text: "Farmis_Oncofar®" })); // pie repetido en todas las páginas
  return pages;
}

// Reproduce la estructura de la hoja de ejemplo (ciclo 2 día 1 de una combinación con anticuerpo biespecífico, gemcitabina y oxaliplatino)
export const SAMPLE_SINGLE = {
  name: "GLOFI- GEMOX ciclo2", interval: 21, cycles: 1, comments: "Ciclo 2: día 1 . Creado por SAC.",
  phases: [{ rows: [
    { order: 1, type: "Otros", days: 1, route: "PIV", time: "000:10", comps: [["METILPREDNISOLONA", "80 mg"], ["DEXCLORFENIRAMINA", "10 mg"], ["CLORURO SODICO 0.9 %", "50 ml"]], obs: ["Completado MINIMO 1 h ANTES!!!! de", "Glofitamab"] },
    { order: 2, type: "Otros", days: 1, route: "PO", time: "000:01", comps: [["PARACETAMOL", "1000 mg"]], obs: ["al menos 30 min antes de glofitamab"] },
    { order: 3, type: "Pauta|antiemética|primera elección", days: 1, route: "PIV", time: "000:15", comps: [["ONDANSETRON", "16 mg"], ["CLORURO SODICO 0.9 %", "50 ml"]], obs: ["Adm 30 min antes de QT"] },
    { order: 4, type: "Pauta|antiemética|alternativa", days: 1, route: "PIV", time: "000:30", comps: [["FOSAPREPITANT", "150 mg"], ["ONDANSETRON", "16 mg"], ["CLORURO SODICO 0.9 %", "250 ml"]] },
    { order: 5, type: "Hidratación", days: 1, route: "PIV", time: "000:30", comps: [["GLUCOSALINO", "500 ml"]] },
    { order: 6, type: "Antineoplásico", days: 1, route: "PIV", time: "004:00", comps: [["GLOFITAMAB", "30 mg"], ["CLORURO SODICO 0.9 %", "100 ml"]] },
    { order: 7, type: "Antineoplásico", days: 1, route: "PIV", time: "000:30", comps: [["GEMCITABINA", "1000 mg/ m²"], ["CLORURO SODICO 0.9 %", "500 ml"]] },
    { order: 8, type: "Antineoplásico", days: 1, route: "PIV", time: "002:00", comps: [["OXALIPLATINO", "100 mg/ m²"], ["GLUCOSA 5%", "250 ml"]] },
  ] }],
};
// Dos fármacos en días distintos (1 y 1,8), varias páginas, dos fases y encabezados repetidos
export function twoPhaseDoc(extraRows = 0) {
  const fill = Array.from({ length: extraRows }, (_, i) => ({ order: 2 + i, type: "Hidratación", days: 1, route: "PIV", time: "000:30", comps: [["GLUCOSALINO", "500 ml"]] }));
  return { name: "ESQUEMA SINTETICO AB", interval: 21, cycles: 6, phases: [
    { title: "Fase de inducción", interval: 21, cycles: 4, rows: [
      { order: 1, type: "Antineoplásico", days: "1,8", route: "PIV", time: "000:30", comps: [["FARMACO ALFA", "1.3 mg/ m²"], ["CLORURO SODICO 0.9 %", "100 ml"]] },
      ...fill,
      { order: 2 + extraRows, type: "Antineoplásico", days: "1", route: "PIV", time: "001:00", comps: [["FARMACO BETA", "375 mg/ m²"]] },
    ] },
    { title: "Fase de mantenimiento", interval: 56, cycles: 6, rows: [
      { order: 1, type: "Antineoplásico", days: "1", route: "PIV", time: "001:00", comps: [["FARMACO BETA", "375 mg/ m²"]] },
    ] },
  ] };
}
