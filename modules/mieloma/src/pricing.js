// Precios versionados por presentación. Puro (sin red ni interfaz).
// Una versión = un precio con vigencia [from, to] para (presentación, centro, condición de compra).
// Reglas: (1) cada cambio de precio crea una versión nueva; (2) no se admiten vigencias solapadas para la misma
// combinación presentación+centro+condición; (3) el historial heredado (catalog[].history) se lee sin modificarlo.
import { addDays } from "./engine.js";
import { eurosToUnits, divRound, UNITS_PER_EUR } from "./money.js";

export const PURCHASE_UNITS = ["envase", "vial", "unidad", "caja"];
export const VAT_MODES = { sin_iva: "Sin IVA (neto)", iva_incluido: "IVA incluido", no_especificado: "No especificado" };
export const DEFAULT_CONDITION = "general";
const NEG_INF = "0000-01-01";

export class PriceError extends Error { constructor(msg, code) { super(msg); this.code = code; } }
export const keyOf = (v) => `${v.presId}|${v.center || ""}|${v.condition || DEFAULT_CONDITION}`;
const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + "T00:00:00Z"));
const start = (v) => v.from || NEG_INF;
const end = (v) => v.to || "9999-12-31";

export function validateVersion(v) {
  const e = [];
  if (!v.presId) e.push("Falta la presentación.");
  if (eurosToUnits(v.price) == null || !(eurosToUnits(v.price) > 0)) e.push("El precio debe ser un importe mayor que 0 (máximo 4 decimales).");
  if ((v.currency || "EUR") !== "EUR") e.push("Solo se admite EUR.");
  if (!PURCHASE_UNITS.includes(v.purchaseUnit)) e.push("Indica la unidad de compra.");
  if (!(Number.isInteger(v.contentPerUnit) && v.contentPerUnit >= 1)) e.push("El contenido por unidad de compra debe ser un entero ≥ 1 (viales o unidades por unidad de compra).");
  if (!v.vat || !VAT_MODES[v.vat.mode]) e.push("Indica el tratamiento del IVA.");
  else if (v.vat.mode === "iva_incluido" && !(v.vat.rate > 0 && v.vat.rate < 1)) e.push("Con IVA incluido hay que indicar el tipo (p. ej. 0,10).");
  if (!v.source || !String(v.source).trim()) e.push("La fuente es obligatoria.");
  if (!isDate(v.from)) e.push("Indica la fecha de entrada en vigor.");
  if (v.to != null && v.to !== "" && !isDate(v.to)) e.push("Fecha de fin no válida.");
  if (isDate(v.from) && isDate(v.to) && v.to < v.from) e.push("La fecha de fin es anterior a la de inicio.");
  return e;
}

// Versiones derivadas del historial heredado: cada entrada vale hasta el día anterior a la siguiente.
export function legacyVersions(item) {
  const h = (item.history || []).map((x, i) => ({ x, i })).filter(({ x }) => !x.voided).sort((a, b) => (a.x.from || "").localeCompare(b.x.from || "") || a.i - b.i);
  return h.map(({ x, i }, k) => {
    const nxt = h[k + 1] && h[k + 1].x.from;
    return {
      id: `L:${item.id}:${i}`, presId: item.id, center: "", condition: DEFAULT_CONDITION, price: x.price, priceUnits: eurosToUnits(x.price), currency: "EUR",
      purchaseUnit: item.oral ? "unidad" : "envase", contentPerUnit: 1, vat: { mode: "no_especificado", rate: null }, source: x.source || "", from: x.from || null,
      to: nxt && nxt > (x.from || NEG_INF) ? addDays(nxt, -1) : null, note: x.note || "", priceType: x.type || "", origin: "legacy", legacyIndex: i,
    };
  });
}
// Todas las versiones de una presentación: las nuevas más las entradas del historial heredado que aún no tienen versión
// equivalente (p. ej. un precio añadido después desde la pantalla «Precios»). Así Costes y el motor heredado ven los mismos precios:
// en ambos gana la entrada con fecha de inicio más reciente.
const legacyKey = (v) => `${v.from || ""}|${Number(v.price)}|${v.source || ""}`;
// Las versiones anuladas no se devuelven salvo includeVoided (historial). `seen` las cuenta igualmente para que una anulada no «reaparezca» desde el historial heredado.
export function versionsFor(state, presId, { includeVoided = false } = {}) {
  const ownAll = (state.priceVersions || []).filter((v) => v.presId === presId);
  const own = includeVoided ? ownAll : ownAll.filter((v) => !v.voided);
  const it = (state.catalog || []).find((c) => c.id === presId);
  if (!ownAll.length) return it ? legacyVersions(it) : [];
  if (!it) return own;
  const seen = new Set(ownAll.map(legacyKey));
  return [...own, ...legacyVersions(it).filter((l) => !seen.has(legacyKey(l))).map((l) => ({ ...l, origin: "legacy-externo" }))];
}

export function findOverlap(versions, cand, ignoreId) {
  return versions.find((v) => !v.voided && v.id !== ignoreId && keyOf(v) === keyOf(cand) && start(v) <= end(cand) && start(cand) <= end(v)) || null;
}

// Resuelve el precio aplicable en una fecha. Prioriza el centro exacto y luego el general; misma condición.
export function resolvePrice(versions, date, { center = "", condition = DEFAULT_CONDITION } = {}) {
  const hit = (c) => versions.filter((v) => !v.voided && (v.center || "") === c && (v.condition || DEFAULT_CONDITION) === condition && start(v) <= date && date <= end(v)).sort((a, b) => start(b).localeCompare(start(a)))[0];
  return (center && hit(center)) || hit("") || null;
}

// Precio por unidad de dispensación (vial/comprimido) en unidades de 0,0001 €, según el tratamiento de IVA pedido.
// Devuelve { units, warnings } o { error }.
export function unitPrice(v, { vat = "sin_iva" } = {}) {
  const warnings = [];
  let u = v.priceUnits != null ? v.priceUnits : eurosToUnits(v.price);
  if (!(u > 0)) return { error: "Precio no válido." };
  const mode = (v.vat && v.vat.mode) || "no_especificado", rate = v.vat && v.vat.rate;
  if (mode === "no_especificado") warnings.push("IVA no especificado en el origen del precio; se usa tal cual.");
  else if (vat === "sin_iva" && mode === "iva_incluido") {
    if (!(rate > 0)) return { error: "Precio con IVA incluido sin tipo de IVA." };
    u = divRound(u * UNITS_PER_EUR, Math.round((1 + rate) * UNITS_PER_EUR));
  } else if (vat === "con_iva" && mode === "sin_iva") {
    if (!(rate > 0)) return { error: "Para obtener el precio con IVA falta el tipo de IVA." };
    u = divRound(u * Math.round((1 + rate) * UNITS_PER_EUR), UNITS_PER_EUR);
  }
  const n = v.contentPerUnit || 1;
  if (n > 1) { u = divRound(u, n); warnings.push(`Precio dividido entre ${n} unidades por ${v.purchaseUnit} (redondeo a 0,0001 €).`); }
  return { units: u, warnings };
}

// Conversión explícita mg/envase: coste por mg solo si consta y está comprobada.
export function costPerMg(pres, unitUnits) {
  const c = pres && pres.conversion;
  if (!c || !(c.mgPerUnit > 0) || !c.verified || unitUnits == null) return null;
  return unitUnits / UNITS_PER_EUR / c.mgPerUnit;
}

/* ---------- Altas y cierres (devuelven los trozos de estado a reemplazar) ---------- */
const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// state: { catalog, priceVersions }. Lanza PriceError. opts: { closePrevious, user, now }
export function addPriceVersion(state, input, opts = {}) {
  const errs = validateVersion(input);
  if (errs.length) throw new PriceError(errs.join(" "), "invalid");
  const now = opts.now || new Date().toISOString();
  let list = (state.priceVersions || []).slice();
  const hadOwn = list.some((v) => v.presId === input.presId);
  const events = [];
  if (!hadOwn) { // materializa el historial heredado (se copia, no se mueve)
    const it = (state.catalog || []).find((c) => c.id === input.presId);
    if (it) { const lv = legacyVersions(it); lv.forEach((v) => list.push({ ...v, id: uid("V"), origin: "legacy", materializedAt: now })); if (lv.length) events.push(`Se copió el historial heredado de ${it.label} (${lv.length}) a versiones de precio.`); }
  }
  const nv = { id: uid("V"), presId: input.presId, center: input.center || "", condition: input.condition || DEFAULT_CONDITION, price: Number(String(input.price).replace(",", ".")), priceUnits: eurosToUnits(input.price),
    currency: "EUR", purchaseUnit: input.purchaseUnit, contentPerUnit: input.contentPerUnit, vat: { mode: input.vat.mode, rate: input.vat.mode === "no_especificado" ? null : (input.vat.rate || null) }, source: String(input.source).trim(),
    from: input.from, to: input.to || null, note: input.note || "", priceType: input.priceType || "", origin: "manual", by: opts.user || null, at: now };
  const clash = findOverlap(list, nv);
  if (clash) {
    const closable = opts.closePrevious && !clash.to && start(clash) < nv.from && !list.some((v) => !v.voided && v !== clash && v.id !== clash.id && keyOf(v) === keyOf(nv) && start(v) > start(clash) && start(v) <= end(nv));
    if (!closable) throw new PriceError(`La vigencia se solapa con la versión vigente desde ${clash.from || "origen"}${clash.to ? " hasta " + clash.to : " (sin fecha de fin)"}. Cierra esa versión o ajusta las fechas.`, "overlap");
    list = list.map((v) => (v.id === clash.id ? { ...v, to: addDays(nv.from, -1), closedBy: nv.id, closedAt: now } : v));
    events.push(`Vigencia anterior cerrada el ${addDays(nv.from, -1)}.`);
  }
  list.push(nv);
  const mirrored = (nv.center === "" && nv.condition === DEFAULT_CONDITION);
  const catalog = (state.catalog || []).map((c) => (mirrored && c.id === nv.presId ? { ...c, history: [...c.history, { price: nv.price, from: nv.from, source: nv.source, type: nv.priceType || "Costes", note: nv.note }] } : c));
  return { priceVersions: list, catalog, version: nv, events, mirrored };
}

// Versión «comercial»: condición diferenciada o específica de un centro (requiere acceso a condiciones comerciales).
export const isCommercialVersion = (v) => (v.condition && v.condition !== DEFAULT_CONDITION) || !!v.center;

/* ---------- Anulación (no se borra: queda en el histórico con motivo, autor y fecha) ---------- */
export class VoidError extends Error { constructor(m, code) { super(m); this.code = code; } }
const needReason = (reason) => { const r = String(reason == null ? "" : reason).trim(); if (!r) throw new VoidError("El motivo de la anulación es obligatorio.", "reason"); return r; };
const stamp = (reason, { user, now }) => ({ at: now || new Date().toISOString(), by: user || null, reason: needReason(reason) });

// Anula una versión de precio. Si es un precio general (el que Costes refleja en el historial heredado), anula también su entrada
// del historial para que la Calculadora y el motor heredado dejen de usarla. Devuelve los trozos de estado a reemplazar.
export function voidPriceVersion(state, versionId, reason, opts = {}) {
  const v = (state.priceVersions || []).find((x) => x.id === versionId);
  if (!v) throw new VoidError("No se encuentra la versión de precio.", "missing");
  if (v.voided) throw new VoidError("Esta versión ya está anulada.", "already");
  const mark = stamp(reason, opts);
  const priceVersions = state.priceVersions.map((x) => (x.id === versionId ? { ...x, voided: mark } : x));
  let mirrored = false;
  const general = (v.center || "") === "" && (v.condition || DEFAULT_CONDITION) === DEFAULT_CONDITION;
  const catalog = (state.catalog || []).map((c) => {
    if (!general || c.id !== v.presId) return c;
    const k = legacyKey(v); const i = (c.history || []).findIndex((h) => !h.voided && legacyKey(h) === k);
    if (i < 0) return c;
    mirrored = true;
    return { ...c, history: c.history.map((h, j) => (j === i ? { ...h, voided: mark } : h)) };
  });
  const prev = priceVersions.filter((x) => !x.voided && x.id !== versionId && keyOf(x) === keyOf(v) && x.to && x.closedBy === versionId);
  const reopened = prev.length ? prev.map((x) => x.id) : [];
  return { priceVersions, catalog, mirrored, version: priceVersions.find((x) => x.id === versionId),
    warning: reopened.length ? "La versión anterior seguirá cerrada: registra la versión correcta para que haya un precio vigente en ese periodo." : null };
}

export function voidSpendEntry(list, id, reason, opts = {}) {
  const e = (list || []).find((x) => x.id === id);
  if (!e) throw new VoidError("No se encuentra el registro de gasto.", "missing");
  if (e.voided) throw new VoidError("Este registro ya está anulado.", "already");
  const mark = stamp(reason, opts);
  return list.map((x) => (x.id === id ? { ...x, voided: mark } : x));
}
