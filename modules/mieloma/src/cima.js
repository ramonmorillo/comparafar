// Cliente de la API oficial CIMA (AEMPS, uso humano) v1.23 — https://cima.aemps.es/cima/rest
// Comportamiento comprobado contra el servicio real (20/11/2026):
//  · GET medicamentos?nombre|practiv1|practiv2|cn|nregistro|npactiv|comerc… → {totalFilas,pagina,tamanioPagina:200,resultados[]}; pagina empieza en 1.
//  · Sin resultados: 200 con resultados [] (medicamentos) o 204 SIN cuerpo (medicamento?cn=…, consulta sin parámetros).
//  · medicamento?nregistro|cn devuelve la ficha con principiosActivos[], presentaciones[] (cn como texto) y atcs[].
//  · nregistro puede ser alfanumérico (p. ej. «1161101004IP»); el CN es de 6–7 dígitos y puede empezar por 0 → siempre texto.
//  · «nombre» solo busca marcas/denominaciones comerciales (nombre=glofitamab → 0; practiv1=glofitamab → Columvi).
//  · CORS abierto en GET (access-control-allow-origin: *): se puede llamar desde el navegador.
// Privacidad: solo se envían términos de catálogo (nombre, principio activo, nº de registro, CN). Nunca texto de PDF ni datos de paciente.
import { parseNumberEs } from "./engine.js";

export const CIMA_BASE = "https://cima.aemps.es/cima/rest";
export class CimaError extends Error { constructor(kind, msg, status) { super(msg); this.kind = kind; this.status = status; } }

// Clasifica el texto escrito por el usuario.
export function classifyTerm(raw) {
  const t = String(raw || "").trim();
  if (!t) return { kind: "empty", value: "" };
  if (/^\d{6,7}$/.test(t)) return { kind: "cn_or_nregistro", value: t };
  if (/^\d{5,10}[A-Za-z0-9]*$/.test(t)) return { kind: "nregistro", value: t.toUpperCase() };
  return { kind: "name", value: t };
}

export function createCima({ fetchImpl, base = CIMA_BASE, timeoutMs = 15000 } = {}) {
  const f = fetchImpl || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
  async function get(path, params) {
    if (!f) throw new CimaError("network", "Este entorno no permite consultar CIMA.");
    const qs = Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
    const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
    let res;
    try { res = await f(`${base}/${path}${qs ? "?" + qs : ""}`, { method: "GET", headers: { Accept: "application/json" }, credentials: "omit", referrerPolicy: "no-referrer", signal: ctl ? ctl.signal : undefined }); }
    catch (e) { throw new CimaError(e && e.name === "AbortError" ? "timeout" : "network", e && e.name === "AbortError" ? "CIMA no ha respondido a tiempo." : "No se pudo conectar con CIMA."); }
    finally { if (timer) clearTimeout(timer); }
    if (res.status === 204) return { status: 204, json: null };
    if (!res.ok) throw new CimaError("http", `CIMA respondió con el error HTTP ${res.status}.`, res.status);
    let text = ""; try { text = await res.text(); } catch (e) { throw new CimaError("network", "Se cortó la respuesta de CIMA."); }
    if (!text.trim()) return { status: res.status, json: null };
    try { return { status: res.status, json: JSON.parse(text) }; } catch (e) { throw new CimaError("parse", "CIMA devolvió una respuesta que no se puede leer."); }
  }

  async function list(params, pagina = 1) {
    const r = await get("medicamentos", { ...params, pagina });
    const j = r.json;
    if (!j || !Array.isArray(j.resultados)) return { total: 0, page: pagina, pageSize: 200, pages: 0, results: [] };
    const pageSize = j.tamanioPagina || 200;
    return { total: j.totalFilas || 0, page: j.pagina || pagina, pageSize, pages: Math.ceil((j.totalFilas || 0) / pageSize), results: j.resultados.map(normalizeListItem) };
  }
  async function detail({ nregistro, cn }) {
    const r = await get("medicamento", nregistro ? { nregistro } : { cn });
    return r.json && r.json.nregistro ? normalizeDetail(r.json) : null;
  }

  // Búsqueda de alto nivel. Devuelve { via, total, page, pages, results } o lanza CimaError.
  async function search(term, { pagina = 1, soloComercializados = false } = {}) {
    const c = classifyTerm(term); const comerc = soloComercializados ? 1 : undefined;
    if (c.kind === "empty") return { via: "vacio", total: 0, page: 1, pages: 0, results: [] };
    if (c.kind === "cn_or_nregistro" || c.kind === "nregistro") {
      if (c.kind === "cn_or_nregistro") { const r = await list({ cn: c.value, comerc }, 1); if (r.total) return { via: "cn", ...r }; }
      const r = await list({ nregistro: c.value, comerc }, 1); return { via: "nregistro", ...r };
    }
    const byName = await list({ nombre: c.value, comerc }, pagina);
    if (byName.total) return { via: "nombre", ...byName };
    const byAi = await list({ practiv1: c.value, comerc }, pagina); // los principios activos no se encuentran por «nombre»
    return { via: byAi.total ? "principio activo" : "nombre", ...byAi };
  }
  return { get, list, detail, search };
}

/* ---------- Normalización ---------- */
const trimS = (s) => (s == null ? "" : String(s).trim());
export function normalizeListItem(r) {
  return { nregistro: trimS(r.nregistro), nombre: trimS(r.nombre), labtitular: trimS(r.labtitular), comerc: !!r.comerc, dosis: trimS(r.dosis), forma: trimS(r.formaFarmaceutica && r.formaFarmaceutica.nombre),
    vtm: trimS(r.vtm && r.vtm.nombre), generico: !!r.generico, huerfano: !!r.huerfano, cpresc: trimS(r.cpresc), vias: (r.viasAdministracion || []).map((v) => trimS(v.nombre)) };
}
export function normalizeDetail(j) {
  const atc = (j.atcs || []).slice().sort((a, b) => (b.nivel || 0) - (a.nivel || 0))[0];
  const ficha = (j.docs || []).find((d) => d.tipo === 1);
  const pres = (j.presentaciones || []).map((p) => {
    const content = parseContent(p.nombre);
    return { cn: trimS(p.cn), nombre: trimS(p.nombre), comerc: !!p.comerc, psum: !!p.psum, content };
  });
  const dosis = trimS(j.dosis);
  return {
    nregistro: trimS(j.nregistro), nombre: trimS(j.nombre), labtitular: trimS(j.labtitular), comerc: !!j.comerc, dosis, forma: trimS(j.formaFarmaceutica && j.formaFarmaceutica.nombre),
    vias: (j.viasAdministracion || []).map((v) => trimS(v.nombre)), oral: (j.viasAdministracion || []).some((v) => /ORAL/i.test(v.nombre || "")) || /ORAL|COMPRIMIDO|CAPSULA|CÁPSULA/i.test((j.formaFarmaceutica && j.formaFarmaceutica.nombre) || ""),
    atc: atc ? { codigo: atc.codigo, nombre: trimS(atc.nombre) } : null, vtm: trimS(j.vtm && j.vtm.nombre), fichaUrl: ficha ? ficha.url : null,
    // cantidad/unidad se conservan LITERALES: en soluciones expresan concentración, no mg por envase.
    ingredients: (j.principiosActivos || []).map((p) => ({ cimaId: p.id, codigo: trimS(p.codigo), nombre: trimS(p.nombre), cantidad: trimS(p.cantidad), unidad: trimS(p.unidad), orden: p.orden || 0 })),
    presentations: pres.map((p) => ({ ...p, conversion: proposeConversion(dosis, p.content) })),
  };
}

// «1 vial de 10 ml», «30 comprimidos», «1 vial» → { count, unit, volume:{amount,unit}|null, literal }
export function parseContent(name) {
  const m = String(name || "").match(/(\d+(?:[.,]\d+)?)\s*(vial(?:es)?|comprimidos?|c[aá]psulas?|ampollas?|jeringas?(?: precargadas?)?|sobres?|plumas?|frascos?|bolsas?)(?:\s+de\s+(\d+(?:[.,]\d+)?)\s*(ml|l|mg|g))?\s*$/i);
  if (!m) return null;
  return { count: parseNumberEs(m[1]), unit: m[2].toLowerCase(), volume: m[3] ? { amount: parseNumberEs(m[3]), unit: m[4].toLowerCase() } : null, literal: m[0].trim() };
}
const toMg = (n, u) => (/^g$/i.test(u) ? n * 1000 : /^(mcg|µg|ug)$/i.test(u) ? n / 1000 : n);
// Propone mg por unidad de dispensación en tres patrones verificados; si no, null (el usuario introduce la equivalencia).
export function proposeConversion(dosis, content) {
  const d = String(dosis || "").trim();
  let m = d.match(/^([\d.,]+)\s*(mg|g|mcg|µg)$/i); // «10 MG», «1800 mg»: contenido total por unidad
  if (m) { const n = parseNumberEs(m[1]); if (n > 0) return mk(toMg(n, m[2]), `dosis «${d}»`); }
  m = d.match(/^([\d.,]+)\s*(mg|g)\s*\/\s*([\d.,]+)\s*ml$/i); // «1 G/26,3 ML»: cantidad total en ese volumen
  if (m) { const n = parseNumberEs(m[1]); if (n > 0) return mk(toMg(n, m[2]), `dosis «${d}»`); }
  m = d.match(/^([\d.,]+)\s*(mg|g)\s*(?:[a-záéíóú ]*)\/\s*ml$/i); // «5 mg/ml», «100 mg/ ml» × volumen del envase
  if (m && content && content.volume && content.volume.unit === "ml") { const n = parseNumberEs(m[1]); if (n > 0) return mk(toMg(n, m[2]) * content.volume.amount, `«${d}» × ${content.volume.amount} ml por vial`); }
  return null;
  function mk(mg, basis) { return { mgPerUnit: Math.round(mg * 1e6) / 1e6, basis: "cima", note: "Propuesta calculada a partir de " + basis + ". Compruébala antes de usarla.", verified: false }; }
}
