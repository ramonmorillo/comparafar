// Catálogo de referencia con tres entidades distintas: principio activo → medicamento → presentación comercial.
// Aditivo: el catálogo heredado de costes (catalog[]) se expone como principios activos y presentaciones «virtuales»
// (origen «Excel») sin modificarlo. Los alias, precios y acuerdos son propios del hospital y una actualización de CIMA nunca los toca.
import { DRUGS } from "./data.js";

export const emptyRef = () => ({ ingredients: [], medicines: [], presentations: [], aliases: [] });
export const ensureRef = (r) => ({ ...emptyRef(), ...(r || {}) });
export const normalizeName = (s) => String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export class CatalogError extends Error { constructor(msg, code, existing) { super(msg); this.code = code; this.existing = existing; } }
const prov = (kind, extra = {}) => ({ kind, ...extra });

/* ---------- Vista unificada (heredado + nuevo) ---------- */
export function legacyIngredients() { return Object.entries(DRUGS).map(([code, name]) => ({ id: "legacy:" + code, name, nameNorm: normalizeName(name), source: prov("excel"), legacy: true })); }
export function legacyPresentations(catalog) {
  return (catalog || []).filter((c) => !c.archived).map((c) => ({
    id: c.id, legacy: true, medicineId: null, ingredientIds: ["legacy:" + c.drug], cn: null, nregistro: null, label: c.label, oral: !!c.oral, content: { count: 1, unit: c.unit || "unidad" },
    conversion: c.mg > 0 ? { mgPerUnit: c.mg, basis: "excel", verified: c.status === "verificado" } : null, source: prov("excel", { cell: c.excelCell }),
  }));
}
export function allIngredients(S) { return [...legacyIngredients(), ...ensureRef(S.ref).ingredients]; }
export function allPresentations(S) {
  const ref = ensureRef(S.ref); const med = Object.fromEntries(ref.medicines.map((m) => [m.id, m]));
  const own = ref.presentations.filter((p) => !p.archived).map((p) => ({ ...p, ingredientIds: ((med[p.medicineId] || {}).ingredients || []).map((i) => i.ingredientId), medicineName: (med[p.medicineId] || {}).name }));
  return [...legacyPresentations(S.catalog), ...own];
}
export const ingredientName = (S, id) => (allIngredients(S).find((i) => i.id === id) || {}).name || id;

/* ---------- Alta manual con deduplicación ---------- */
export function addIngredient(ref, { name, source, cima }, { user, now = new Date().toISOString() } = {}) {
  ref = ensureRef(ref); const n = trim(name); if (!n) throw new CatalogError("Falta el nombre del principio activo.", "invalid");
  const norm = normalizeName(n);
  const dup = [...legacyIngredients(), ...ref.ingredients].find((i) => i.nameNorm === norm || (cima && i.cima && i.cima.codigo === cima.codigo));
  if (dup) throw new CatalogError(`Ya existe «${dup.name}».`, "duplicate", dup);
  const ing = { id: uid("PA-"), name: n, nameNorm: norm, source: source || prov("manual", { by: user || null, at: now }), ...(cima ? { cima } : {}) };
  return { ref: { ...ref, ingredients: [...ref.ingredients, ing] }, ingredient: ing };
}
export function addMedicine(ref, { name, ingredients, source, nregistro, labtitular, forma, atc }, { user, now = new Date().toISOString() } = {}) {
  ref = ensureRef(ref); const n = trim(name);
  if (!n) throw new CatalogError("Falta el nombre del medicamento.", "invalid");
  if (!ingredients || !ingredients.length) throw new CatalogError("Un medicamento necesita al menos un principio activo.", "invalid");
  const known = new Set([...legacyIngredients(), ...ref.ingredients].map((i) => i.id));
  ingredients.forEach((i) => { if (!known.has(i.ingredientId)) throw new CatalogError("Principio activo desconocido.", "invalid"); });
  const dup = ref.medicines.find((m) => (nregistro && m.nregistro === nregistro) || (!nregistro && !m.nregistro && normalizeName(m.name) === normalizeName(n)));
  if (dup) throw new CatalogError(`Ya existe el medicamento «${dup.name}».`, "duplicate", dup);
  const med = { id: uid("MED-"), name: n, nregistro: nregistro || null, labtitular: labtitular || "", forma: forma || "", atc: atc || null, ingredients: ingredients.map((i) => ({ ingredientId: i.ingredientId, amount: i.amount == null ? "" : String(i.amount), unit: i.unit || "" })), source: source || prov("manual", { by: user || null, at: now }) };
  return { ref: { ...ref, medicines: [...ref.medicines, med] }, medicine: med };
}
export function addPresentation(ref, { medicineId, label, cn, content, conversion, oral, source }, { user, now = new Date().toISOString() } = {}) {
  ref = ensureRef(ref); const l = trim(label);
  if (!ref.medicines.some((m) => m.id === medicineId)) throw new CatalogError("Elige el medicamento de la presentación.", "invalid");
  if (!l) throw new CatalogError("Falta la descripción de la presentación.", "invalid");
  const cnT = cn == null || cn === "" ? null : String(cn).trim();
  if (cnT && !/^\d{6,7}$/.test(cnT)) throw new CatalogError("El código nacional son 6 o 7 dígitos (se guarda como texto).", "invalid");
  const dup = ref.presentations.find((p) => !p.archived && ((cnT && p.cn === cnT) || (p.medicineId === medicineId && normalizeName(p.label) === normalizeName(l))));
  if (dup) throw new CatalogError(`Ya existe esa presentación («${dup.label}»${dup.cn ? ", CN " + dup.cn : ""}).`, "duplicate", dup);
  const p = { id: uid("PR-"), medicineId, cn: cnT, label: l, content: content || null, conversion: conversion && conversion.mgPerUnit > 0 ? { ...conversion } : null, oral: !!oral, source: source || prov("manual", { by: user || null, at: now }), archived: false };
  return { ref: { ...ref, presentations: [...ref.presentations, p] }, presentation: p };
}
// Corrige la equivalencia mg/envase (acción del usuario). Solo cambia `conversion`.
export function setConversion(ref, presId, conv, { user, now = new Date().toISOString() } = {}) {
  ref = ensureRef(ref);
  if (!ref.presentations.some((p) => p.id === presId)) throw new CatalogError("Presentación no encontrada.", "invalid");
  if (conv && !(conv.mgPerUnit > 0)) throw new CatalogError("mg por unidad debe ser > 0.", "invalid");
  return { ...ref, presentations: ref.presentations.map((p) => (p.id === presId ? { ...p, conversion: conv ? { mgPerUnit: conv.mgPerUnit, basis: conv.basis || "manual", verified: !!conv.verified, note: conv.note || "", by: user || null, at: now } : null } : p)) };
}

/* ---------- Alias de Oncofar (solo con confirmación del usuario) ---------- */
export function confirmAlias(ref, alias, ingredientId, { user, now = new Date().toISOString() } = {}) {
  ref = ensureRef(ref); const norm = normalizeName(alias);
  if (!norm) throw new CatalogError("Alias vacío.", "invalid");
  const ex = ref.aliases.find((a) => a.aliasNorm === norm);
  if (ex && ex.ingredientId === ingredientId) return ref;
  if (ex) throw new CatalogError(`El alias «${alias}» ya está vinculado a otro principio activo.`, "duplicate", ex);
  return { ...ref, aliases: [...ref.aliases, { id: uid("AL-"), alias: trim(alias), aliasNorm: norm, ingredientId, source: "Oncofar", confirmedBy: user || null, confirmedAt: now }] };
}

// Correspondencia de un nombre del documento con el catálogo: id → nombre normalizado → alias confirmado → candidatas.
// Nunca elige por el usuario cuando hay varias opciones.
export function matchIngredient(S, literal, hintId) {
  const ings = allIngredients(S), ref = ensureRef(S.ref), norm = normalizeName(literal);
  if (hintId) { const h = ings.find((i) => i.id === hintId); if (h) return { status: "id", options: [h] }; }
  const al = ref.aliases.filter((a) => a.aliasNorm === norm).map((a) => ings.find((i) => i.id === a.ingredientId)).filter(Boolean);
  if (al.length === 1) return { status: "alias", options: al };
  const ex = ings.filter((i) => i.nameNorm === norm);
  if (ex.length === 1) return { status: "nombre", options: ex };
  if (ex.length > 1) return { status: "varias", options: ex };
  const toks = norm.split(" ").filter((t) => t.length > 2);
  const cand = toks.length ? ings.filter((i) => { const n = i.nameNorm.split(" "); return toks.every((t) => n.includes(t)) || n.every((t) => t.length <= 2 || norm.split(" ").includes(t)); }) : [];
  if (cand.length) return { status: "varias", options: cand };
  return { status: "ninguna", options: [] };
}

/* ---------- Incorporar una ficha de CIMA (detalle normalizado) ---------- */
// Crea/enlaza principios activos, crea o ACTUALIZA solo los campos oficiales del medicamento y añade las presentaciones elegidas.
// Nunca modifica alias, precios, acuerdos, ni la equivalencia mg/envase ya confirmada por el usuario.
export function incorporateCima(ref, d, selectedCns, { user, now = new Date().toISOString() } = {}) {
  ref = ensureRef(ref); const rep = { ingredientsCreated: [], ingredientsLinked: [], medicine: null, medicineUpdated: false, presentationsAdded: [], presentationsSkipped: [] };
  const src = (extra = {}) => prov("cima", { nregistro: d.nregistro, consultedAt: now, by: user || null, ...extra });
  const links = [];
  for (const ing of d.ingredients) {
    const nn = normalizeName(ing.nombre);
    let ex = ref.ingredients.find((i) => i.cima && i.cima.codigo === ing.codigo) || [...legacyIngredients(), ...ref.ingredients].find((i) => i.nameNorm === nn);
    if (!ex) { const r = addIngredient(ref, { name: ing.nombre, source: src({ codigo: ing.codigo, id: ing.cimaId }), cima: { id: ing.cimaId, codigo: ing.codigo } }, { user, now }); ref = r.ref; ex = r.ingredient; rep.ingredientsCreated.push(ex.name); }
    else { if (!ex.legacy && !ex.cima) ref = { ...ref, ingredients: ref.ingredients.map((i) => (i.id === ex.id ? { ...i, cima: { id: ing.cimaId, codigo: ing.codigo } } : i)) }; rep.ingredientsLinked.push(ex.name); }
    links.push({ ingredientId: ex.id, amount: ing.cantidad, unit: ing.unidad });
  }
  let med = ref.medicines.find((m) => m.nregistro === d.nregistro);
  if (!med) { const r = addMedicine(ref, { name: d.nombre, ingredients: links, nregistro: d.nregistro, labtitular: d.labtitular, forma: d.forma, atc: d.atc, source: src({ url: d.fichaUrl }) }, { user, now }); ref = r.ref; med = r.medicine; }
  else {
    ref = { ...ref, medicines: ref.medicines.map((m) => (m.id === med.id ? { ...m, name: d.nombre, labtitular: d.labtitular, forma: d.forma, atc: d.atc, ingredients: links, source: { ...m.source, kind: "cima", nregistro: d.nregistro, consultedAt: now, url: d.fichaUrl } } : m)) };
    rep.medicineUpdated = true;
  }
  rep.medicine = med.name;
  for (const cn of selectedCns || []) {
    const p = d.presentations.find((x) => x.cn === String(cn)); if (!p) continue;
    const exP = ref.presentations.find((x) => x.cn === p.cn);
    if (exP) { // actualiza solo datos oficiales; conserva equivalencia confirmada
      ref = { ...ref, presentations: ref.presentations.map((x) => (x.id === exP.id ? { ...x, label: p.nombre, content: p.content, source: { ...x.source, consultedAt: now, nregistro: d.nregistro } } : x)) };
      rep.presentationsSkipped.push(p.cn); continue;
    }
    try {
      const r = addPresentation(ref, { medicineId: med.id, label: p.nombre, cn: p.cn, content: p.content, conversion: p.conversion, oral: d.oral, source: src({ cn: p.cn, comerc: p.comerc }) }, { user, now });
      ref = r.ref; rep.presentationsAdded.push(p.cn);
    } catch (e) { if (e instanceof CatalogError && e.code === "duplicate") rep.presentationsSkipped.push(p.cn); else throw e; }
  }
  return { ref, report: rep };
}

function trim(s) { return s == null ? "" : String(s).trim(); }
