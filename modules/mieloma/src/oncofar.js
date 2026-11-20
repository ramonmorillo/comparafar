// Reconstrucción de una hoja «Esquemas Antineoplásicos/Soporte» de Oncofar a partir del texto con posiciones del PDF.
// BASE DE DISEÑO: una fotografía impresa de una hoja real (columnas Orden · Tipo Terapia · Días · Vía · T.Admin/Posología ·
// Componentes Mezcla IV · Dosis Base/Intervalo; filas multilínea; «Observaciones:» dentro de la fila).
// NO VERIFICADO contra un PDF real: geometría de texto, saltos de página, encabezados repetidos y fases se tratan de forma defensiva.
// Todo lo que no se puede resolver se devuelve como «sin resolver» con su valor literal y su página; nada se inventa.
import { parseDays } from "./engine.js";

export const PARSER_VERSION = "oncofar-0.1 (sin verificar con PDF real)";
const num = (s) => { const t = String(s).trim().replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."); const n = Number(t); return t !== "" && isFinite(n) ? n : NaN; };
const F = (value, literal, page, status) => ({ value, literal: literal == null ? "" : literal, page: page || null, status: status || (value == null || value === "" ? "sin_resolver" : "extraido") });

/* ---------- Líneas ---------- */
function toLines(pages) {
  const lines = [];
  for (const pg of pages) {
    const its = pg.items.slice().sort((a, b) => b.y - a.y || a.x - b.x);
    let cur = null;
    for (const it of its) {
      if (cur && Math.abs(cur.y - it.y) <= Math.max(2.5, it.h * 0.4)) cur.items.push(it);
      else { cur = { page: pg.n, y: it.y, ph: pg.height, items: [it] }; lines.push(cur); }
    }
  }
  lines.forEach((l) => { l.items.sort((a, b) => a.x - b.x); l.text = l.items.map((i) => i.str).join(" "); });
  return lines;
}
const normSig = (t) => t.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
const isTableHeader = (l) => /\borden\b/i.test(l.text) && /\btipo\b/i.test(l.text) && /v[ií]a/i.test(l.text) && /componentes/i.test(l.text);
const isPageNo = (t) => /^p[aá]g(ina|\.)?\s*\d+\s*(de|\/)\s*\d+$/i.test(t.trim());

// Quita encabezados/pies repetidos (mismo texto en ≥ 2 páginas, en el 10 % superior o el 8 % inferior) y numeración de página.
function dropRepeated(lines, pageCount) {
  const sig = new Map();
  if (pageCount >= 2) for (const l of lines) { const inBand = l.y > l.ph * 0.9 || l.y < l.ph * 0.08; if (!inBand) continue; const k = normSig(l.text); sig.set(k, new Set([...(sig.get(k) || []), l.page])); }
  return lines.filter((l) => { const inBand = l.y > l.ph * 0.9 || l.y < l.ph * 0.08; if (isPageNo(l.text)) return false; return !(pageCount >= 2 && inBand && (sig.get(normSig(l.text)) || new Set()).size >= 2); });
}

/* ---------- Cabecera ---------- */
const LABELS = [
  ["name", /Nombre/i], ["period", /Periodicidad/i], ["cycles", /N[º°o]\.?\s*M[aá]ximo\s+de\s+Ciclos/i], ["emetogenic", /Capacidad\s+emet[oó]gena/i], ["eft", /Tipo\s+EFT/i], ["state", /Estado/i],
  ["trial", /Ensayo\s+Cl[ií]nico/i], ["rt", /Radioterapia/i], ["cost", /Coste\s*\(€\s*\/\s*ciclo\)/i], ["comments", /Comentarios/i], ["obsEFT", /Observaciones\s+EFT/i],
  ["biblio", /Bibliograf[ií]a/i], ["services", /Servicios/i], ["diag", /Diagn[oó]sticos\s+de\s+Localizaci[oó]n(?:\s*,\s*Indicaciones\s+y\s+Dianas|\s*:)?/i],
];
export function parseHeaderBlock(text, page = 1) {
  const hits = [];
  for (const [key, re] of LABELS) { const g = new RegExp("(?:^|\\s)(" + re.source + ")", "gi"); let m; while ((m = g.exec(text))) hits.push({ key, start: m.index + (m[0].length - m[1].length), end: m.index + m[0].length }); }
  hits.sort((a, b) => a.start - b.start);
  // descarta solapes (p. ej. «Observaciones EFT» dentro de otra etiqueta)
  const clean = []; for (const h of hits) if (!clean.length || h.start >= clean[clean.length - 1].end) clean.push(h);
  const raw = {};
  clean.forEach((h, i) => { const v = text.slice(h.end, i + 1 < clean.length ? clean[i + 1].start : text.length).trim(); if (!(h.key in raw)) raw[h.key] = v; });
  const per = raw.period != null ? num(raw.period) : NaN, cyc = raw.cycles != null ? num(raw.cycles) : NaN;
  const hint = (raw.comments || raw.obsEFT || "").match(/ciclo\s*(\d+)\s*[:\-]?\s*d[ií]a\s*(\d+)/i);
  return {
    name: F(raw.name ? raw.name.trim() : null, raw.name, page),
    interval: F(Number.isInteger(per) && per > 0 ? per : null, raw.period, page),
    cycles: F(Number.isInteger(cyc) && cyc > 0 ? cyc : null, raw.cycles, page),
    cycleHint: hint ? { cycle: +hint[1], day: +hint[2] } : null,
    emetogenic: raw.emetogenic || "",
  };
}

/* ---------- Dosis, vía, días, tiempo ---------- */
const DILUENT = /^(cloruro\s+s[oó]dico|suero|glucosa|glucosalino|agua\b|ringer|dextrosa|salino|fisiol[oó]gico)/i;
export function parseDose(literal) {
  const s = String(literal || "").trim();
  const m = s.match(/^([\d.,]+)\s*(mg|g|mcg|µg|ug|ml|l|ui|u\.i\.?|mmol|meq)?\s*(?:\/\s*(m²|m2|kg))?\s*$/i);
  if (!m) return { value: null, unit: null, basis: null, literal: s };
  const v = num(m[1]); if (!isFinite(v)) return { value: null, unit: null, basis: null, literal: s };
  const u = (m[2] || "").toLowerCase(), per = (m[3] || "").toLowerCase();
  if (u === "ml" || u === "l") return { value: v * (u === "l" ? 1000 : 1), unit: "ml", basis: "volume", literal: s };
  const toMg = u === "g" ? 1000 : u === "mcg" || u === "µg" || u === "ug" ? 0.001 : u === "mg" ? 1 : null;
  if (toMg == null) return { value: v, unit: u || null, basis: null, literal: s };
  const basis = per === "kg" ? "mgkg" : per ? "mgm2" : "fixed";
  return { value: Math.round(v * toMg * 1e6) / 1e6, unit: basis === "fixed" ? "mg" : basis === "mgkg" ? "mg/kg" : "mg/m2", basis, literal: s };
}
export function parseDaysLiteral(literal) {
  const t = String(literal || "").replace(/\s+a\s+/gi, "-").replace(/\s*-\s*/g, "-").trim();
  if (!t) return null;
  try { const d = parseDays(t); return d.length ? d : null; } catch (e) { return null; }
}
export function parseAdminTime(literal) { const m = String(literal || "").trim().match(/^(\d{1,3}):(\d{2})$/); return m ? +m[1] * 60 + +m[2] : null; }

export function classifyRow(typeLiteral, obsText = "") {
  const t = String(typeLiteral || "");
  if (/antineopl/i.test(t)) return { category: "principal", explicit: true, hint: "" };
  if (/premedicaci/i.test(t)) return { category: "premedicacion", explicit: true, hint: "" };
  if (/antiem|hidrataci|soporte/i.test(t)) return { category: "soporte", explicit: true, hint: "" };
  return { category: "ambiguo", explicit: false, hint: /\b(antes|previo|premed)/i.test(obsText) ? "La observación indica administración previa a otro fármaco, pero el documento no la clasifica expresamente." : "El documento no clasifica expresamente esta fila." };
}

/* ---------- Tabla ---------- */
const COLS = [["order", /^orden/i], ["type", /^tipo/i], ["days", /^d[ií]as/i], ["route", /^v[ií]a/i], ["time", /^t\.?\s*admin/i], ["comp", /^componentes/i], ["dose", /^dosis/i]];
function geometry(headerLine) {
  const g = {};
  for (const [k, re] of COLS) { const it = headerLine.items.find((i) => re.test(i.str)); if (it) g[k] = it.x; }
  return Object.keys(g).length >= 6 && "order" in g && "comp" in g && "dose" in g ? g : null;
}
function colOf(g, x) { let best = null, bx = -Infinity; for (const [k, sx] of Object.entries(g)) if (x >= sx - 14 && sx > bx) { best = k; bx = sx; } return best; }

const PHASE_HEAD = /^\s*(fase\b.+|etapa\b.+|inducci[oó]n\b.*|mantenimiento\b.*|consolidaci[oó]n\b.*|intensificaci[oó]n\b.*)$/i;

// extract = resultado de extractPdf. Devuelve { ok:true, header, phases, warnings } | { ok:false, reason, message }
export function parseOncofar(extract) {
  const pageCount = extract.pages.length;
  const all = toLines(extract.pages);
  const lines = dropRepeated(all.filter((l, i, a) => true), pageCount);
  // la cabecera de tabla se conserva en cada página para fijar la geometría; las repeticiones no generan filas
  const warnings = [...(extract.warnings || [])];
  const firstTable = lines.findIndex(isTableHeader);
  if (firstTable < 0) return { ok: false, reason: "diseno", message: "No se reconoce la tabla de administraciones (no se encuentra la cabecera Orden / Tipo Terapia / Vía / Componentes). Completa la planificación manualmente." };
  // Cabecera: líneas anteriores a «(I) Administraciones» o a la primera tabla, hasta el primer encabezado de fase
  const stopAt = (() => { const i = lines.findIndex((l) => /\(I\)\s*Administraciones/i.test(l.text)); return i >= 0 && i < firstTable ? i : firstTable; })();
  const firstPhaseHead = lines.findIndex((l, i) => i < stopAt && PHASE_HEAD.test(l.text.trim()) && !/^nombre/i.test(l.text));
  const headEnd = firstPhaseHead >= 0 ? firstPhaseHead : stopAt;
  const headLines = lines.slice(0, headEnd);
  const header = parseHeaderBlock(headLines.map((l) => l.text).join(" "), (headLines[0] || {}).page || 1);

  const phases = []; let phase = null, geo = null, row = null, pendingPhaseHead = null;
  const newPhase = (name, page) => { phase = { name: F(name, name, page), page, interval: null, cycles: null, rows: [] }; phases.push(phase); row = null; return phase; };
  const closeRow = () => { row = null; };

  for (let i = headEnd; i < lines.length; i++) {
    const l = lines[i], t = l.text.trim();
    if (/^\(II\)/i.test(t) || /medicaci[oó]n asociada/i.test(t)) { closeRow(); break; }
    if (/\(I\)\s*Administraciones/i.test(t)) continue;
    if (PHASE_HEAD.test(t) && !isTableHeader(l)) { pendingPhaseHead = { name: t, page: l.page }; newPhase(t, l.page); continue; }
    if (isTableHeader(l)) { const g = geometry(l); if (!g) return { ok: false, reason: "diseno", message: `La cabecera de la tabla (página ${l.page}) no tiene las columnas esperadas.` }; geo = g; if (!phase) newPhase("Esquema", l.page); closeRow(); continue; }
    if (!geo) { // texto entre un encabezado de fase y su tabla: puede traer su periodicidad y nº de ciclos
      if (phase) { const h = parseHeaderBlock(t, l.page); if (h.interval.value != null) phase.interval = h.interval; if (h.cycles.value != null) phase.cycles = h.cycles; }
      continue;
    }
    if (pendingPhaseHead && !geo) continue;
    // fila de datos
    const cells = {}; l.items.forEach((it) => { const c = colOf(geo, it.x); if (c) (cells[c] = cells[c] || []).push(it); });
    const orderIt = (cells.order || []).find((it) => /^\d{1,2}$/.test(it.str));
    if (!phase) newPhase("Esquema", l.page);
    // texto de fase intercalado (propio de la fase) sin columnas de tabla reconocibles
    if (!orderIt && !row && !cells.comp && !cells.dose) { const h = parseHeaderBlock(t, l.page); if (h.interval.value != null) phase.interval = h.interval; if (h.cycles.value != null) phase.cycles = h.cycles; continue; }
    if (orderIt) { row = { order: +orderIt.str, page: l.page, pages: [l.page], type: [], days: [], route: [], time: [], comp: [], dose: [] }; phase.rows.push(row); }
    if (!row) continue; // restos de cabecera (p. ej. «logía») antes de la primera fila
    if (!row.pages.includes(l.page)) row.pages.push(l.page);
    for (const k of ["type", "days", "route", "time"]) (cells[k] || []).forEach((it) => row[k].push(it.str));
    (cells.comp || []).forEach((it) => row.comp.push({ y: l.y, text: it.str, page: l.page }));
    (cells.dose || []).forEach((it) => row.dose.push({ y: l.y, text: it.str, page: l.page }));
  }
  if (!phases.some((p) => p.rows.length)) return { ok: false, reason: "diseno", message: "Se encontró la cabecera de la tabla pero ninguna fila de administración." , warnings };

  const outPhases = phases.filter((p) => p.rows.length).map((p, pi) => buildPhase(p, pi, header, phases.length > 1 || pendingPhaseHead != null, warnings));
  return { ok: true, header, phases: outPhases, warnings, pageCount };
}

function buildPhase(p, idx, header, explicitPhases, warnings) {
  const interval = p.interval || (header.interval ? { ...header.interval } : F(null, "", null));
  const cycles = p.cycles || (header.cycles ? { ...header.cycles } : F(null, "", null));
  return {
    id: "F" + (idx + 1), name: explicitPhases ? p.name.value : "Esquema", nameLiteral: p.name.literal, page: p.page, intervalOwn: !!p.interval, cyclesOwn: !!p.cycles, interval, cycles,
    lines: p.rows.map((r, ri) => buildLine(r, idx, ri, warnings)),
  };
}
function buildLine(r, pi, ri, warnings) {
  const names = [], obsLines = []; let inObs = false;
  r.comp.forEach((c) => { if (/^observaciones?:?$/i.test(c.text.trim()) || /^observaciones?:/i.test(c.text.trim())) inObs = true; (inObs ? obsLines : names).push(c); });
  const doseLines = r.dose.slice();
  const used = new Set();
  const comps = names.map((n, ci) => {
    let di = -1, bd = 7;
    doseLines.forEach((d, k) => { const dy = Math.abs(d.y - n.y); if (!used.has(k) && d.page === n.page && dy <= bd) { bd = dy; di = k; } });
    if (di < 0 && names.length === doseLines.length && !used.has(ci)) di = ci; // respaldo por orden si no hay correspondencia vertical
    if (di >= 0) used.add(di);
    const lit = di >= 0 ? doseLines[di].text : "";
    const d = parseDose(lit);
    const diluent = DILUENT.test(n.text.trim()) && d.basis === "volume";
    return { id: `c${ci + 1}`, nameLiteral: n.text.trim(), doseLiteral: lit, doseValue: d.value, unit: d.unit, basis: d.basis, role: diluent ? "diluyente" : "farmaco", page: n.page };
  });
  const typeLit = r.type.join(" ").replace(/\s+/g, " ").trim();
  const obsText = obsLines.map((o) => o.text).join(" ");
  const cls = classifyRow(typeLit, obsText);
  const daysLit = r.days.join(" ").trim(), days = parseDaysLiteral(daysLit);
  if (!days) warnings.push(`Fila ${r.order} (p. ${r.page}): días de administración sin resolver («${daysLit || "vacío"}»).`);
  const spans = r.pages.length > 1 ? `Fila ${r.order}: continúa entre las páginas ${r.pages.join(" y ")}.` : null;
  if (spans) warnings.push(spans);
  return {
    id: `P${pi + 1}L${ri + 1}`, order: r.order, page: r.page, pages: r.pages, type: F(typeLit, typeLit, r.page),
    category: cls.category, categoryExplicit: cls.explicit, categoryHint: cls.hint,
    included: cls.category === "principal" ? true : cls.category === "ambiguo" ? null : false,
    route: F(r.route.join(" ").trim() || null, r.route.join(" ").trim(), r.page),
    days: F(days, daysLit, r.page), adminMinutes: parseAdminTime(r.time.join(" ")), adminLiteral: r.time.join(" ").trim(),
    obsFlags: { before: /\b(antes|previo)/i.test(obsText), present: obsLines.length > 0 }, components: comps,
  };
}
