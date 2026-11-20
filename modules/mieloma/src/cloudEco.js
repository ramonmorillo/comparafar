// Mapeos y diferencias puras (sin red) entre el estado de la app y las tablas de la migración 003.
// Reglas de sincronización (ver docs/MODULOS-ECONOMICOS.md):
//  · ref_* y spend_entries y alias: solo se AÑADEN (ref_medicines/ref_presentations también se actualizan).
//  · price_versions: solo se añaden; lo único que cambia es CERRAR la vigencia abierta (valid_to).
//  · agreements: control optimista de versión (se envía expected+1); el histórico lo genera la base (agreement_versions).
// Lo que NUNCA se sincroniza: planes importados, borradores de importación y estimaciones (pueden llevar datos de paciente).
import { stableStringify } from "./cloudMap.js";

const nul = (v) => (v === undefined || v === "" ? null : v);

/* ---------- Catálogo de referencia ---------- */
export const ingredientToRow = (i) => ({ id: i.id, name: i.name, name_norm: i.nameNorm, source: i.source || {}, cima: i.cima || null });
export const rowToIngredient = (r) => ({ id: r.id, name: r.name, nameNorm: r.name_norm, source: r.source || {}, ...(r.cima ? { cima: r.cima } : {}) });

export const medicineToRow = (m) => ({ id: m.id, name: m.name, nregistro: nul(m.nregistro), labtitular: nul(m.labtitular), forma: nul(m.forma), atc: m.atc || null, ingredients: m.ingredients, source: m.source || {} });
export const rowToMedicine = (r) => ({ id: r.id, name: r.name, nregistro: r.nregistro || null, labtitular: r.labtitular || "", forma: r.forma || "", atc: r.atc || null, ingredients: r.ingredients, source: r.source || {} });

export const presentationToRow = (p) => ({ id: p.id, medicine_id: p.medicineId, cn: nul(p.cn), label: p.label, content: p.content || null, conversion: p.conversion || null, oral: !!p.oral, source: p.source || {}, archived: !!p.archived });
export const rowToPresentation = (r) => ({ id: r.id, medicineId: r.medicine_id, cn: r.cn || null, label: r.label, content: r.content || null, conversion: r.conversion || null, oral: !!r.oral, source: r.source || {}, archived: !!r.archived });

export const aliasToRow = (a) => ({ id: a.id, alias: a.alias, alias_norm: a.aliasNorm, ingredient_id: a.ingredientId });
export const rowToAlias = (r) => ({ id: r.id, alias: r.alias, aliasNorm: r.alias_norm, ingredientId: r.ingredient_id, source: "Oncofar", confirmedAt: r.confirmed_at || null });

/* ---------- Versiones de precio ---------- */
export function versionToRow(v) {
  return { id: v.id, presentation_id: v.presId, center: v.center || "", condition: v.condition || "general", price_units: v.priceUnits, currency: "EUR",
    purchase_unit: v.purchaseUnit, content_per_unit: v.contentPerUnit, vat_mode: v.vat ? v.vat.mode : "no_especificado", vat_rate: v.vat && v.vat.rate ? v.vat.rate : null,
    source: v.source, valid_from: v.from, valid_to: v.to || null, price_type: nul(v.priceType), note: nul(v.note), origin: v.origin || "manual" };
}
export function rowToVersion(r) {
  return { id: r.id, presId: r.presentation_id, center: r.center || "", condition: r.condition || "general", price: Number(r.price_units) / 10000, priceUnits: Number(r.price_units), currency: "EUR",
    purchaseUnit: r.purchase_unit, contentPerUnit: r.content_per_unit, vat: { mode: r.vat_mode, rate: r.vat_rate == null ? null : Number(r.vat_rate) }, source: r.source,
    from: r.valid_from, to: r.valid_to || null, priceType: r.price_type || "", note: r.note || "", origin: r.origin || "manual", at: r.created_at || null };
}

/* ---------- Acuerdos ---------- */
// data conserva todo salvo lo que tiene columna propia y el histórico (que lo lleva agreement_versions).
export function agreementToRow(a) {
  const { id, version, type, title, source, owner, history, createdAt, createdBy, modifiedAt, modifiedBy, ...data } = a;
  return { id, version: version || 1, type, title, scope_level: a.scope.level, scope_target: a.scope.targetId, data, source, owner };
}
// versions: filas de agreement_versions de ese acuerdo (para reconstruir el histórico).
export function rowToAgreement(r, versions = []) {
  const vs = versions.filter((x) => x.agreement_id === r.id && x.version < r.version).sort((a, b) => a.version - b.version);
  const history = vs.map((x, i) => {
    const next = vs[i + 1];
    return { ...x.data, id: r.id, version: x.version, type: r.type, title: x.data.title || r.title, source: x.data.source || r.source, owner: x.data.owner || r.owner, replacedAt: next ? next.changed_at : r.updated_at || null };
  });
  return { ...r.data, id: r.id, version: r.version, type: r.type, title: r.title, source: r.source, owner: r.owner, createdAt: r.created_at, modifiedAt: r.updated_at, history };
}

/* ---------- Gasto registrado ---------- */
export const spendToRow = (e) => ({ id: e.id, kind: e.kind, agreement_id: e.agreementId || null, scope: e.scope || {}, from_date: e.from || null, to_date: e.to || null, as_of: e.asOf, amount_cents: e.amountCents, source: e.source });
export const rowToSpend = (r) => ({ id: r.id, kind: r.kind, agreementId: r.agreement_id || null, scope: r.scope || {}, from: r.from_date || null, to: r.to_date || null, asOf: r.as_of, amountCents: Number(r.amount_cents), source: r.source, by: null, at: r.created_at || null });

/* ---------- Diferencias: qué enviar para que la nube iguale al estado local ---------- */
const byId = (xs) => Object.fromEntries((xs || []).map((x) => [x.id, x]));
const same = (a, b) => stableStringify(a) === stableStringify(b);
const addedOnly = (local, remote, toRow) => { const rm = byId(remote); return (local || []).filter((x) => !rm[x.id]).map(toRow); };
const addedOrChanged = (local, remote, toRow) => { const rm = byId(remote); return (local || []).filter((x) => !rm[x.id] || !same(toRow(x), toRow(rm[x.id]))).map(toRow); };

// local / remote: { ref, priceVersions, agreements, spendEntries } con la misma forma que el estado de la app.
export function diffEco(local, remote) {
  const lr = local.ref || {}, rr = remote.ref || {};
  const rv = byId(remote.priceVersions);
  const newVersions = [], closures = [];
  for (const v of local.priceVersions || []) {
    const r = rv[v.id];
    if (!r) newVersions.push(versionToRow(v));
    else if (!r.to && v.to) closures.push({ id: v.id, valid_to: v.to });   // único cambio admitido por la base
  }
  const ra = byId(remote.agreements);
  const agInserts = [], agUpdates = [];
  for (const a of local.agreements || []) {
    const r = ra[a.id];
    if (!r) agInserts.push(agreementToRow(a));
    else {
      const { version: _lv, ...lrow } = agreementToRow(a); const { version: _rv, ...rrow } = agreementToRow(r);
      if (!same(lrow, rrow)) agUpdates.push({ row: agreementToRow({ ...a, version: r.version + 1 }), expected: r.version });
    }
  }
  return {
    ingredients: addedOnly(lr.ingredients, rr.ingredients, ingredientToRow),
    aliases: addedOnly(lr.aliases, rr.aliases, aliasToRow),
    medicines: addedOrChanged(lr.medicines, rr.medicines, medicineToRow),
    presentations: addedOrChanged(lr.presentations, rr.presentations, presentationToRow),
    newVersions, closures, agInserts, agUpdates,
    spend: addedOnly(local.spendEntries, remote.spendEntries, spendToRow),
  };
}
export const ecoDiffEmpty = (d) => !(d.ingredients.length || d.aliases.length || d.medicines.length || d.presentations.length || d.newVersions.length || d.closures.length || d.agInserts.length || d.agUpdates.length || d.spend.length);

// Estado remoto → trozos de estado de la app. `canSeeCommercial`: editor/revisor/admin. Un lector no recibe (ni sustituye) condiciones comerciales.
export function ecoFromRows(rows, { canSeeCommercial }) {
  const out = {
    ref: { ingredients: (rows.ingredients || []).map(rowToIngredient), medicines: (rows.medicines || []).map(rowToMedicine), presentations: (rows.presentations || []).map(rowToPresentation), aliases: (rows.aliases || []).map(rowToAlias) },
  };
  if (canSeeCommercial) {
    out.priceVersions = (rows.priceVersions || []).map(rowToVersion);
    out.agreements = (rows.agreements || []).map((r) => rowToAgreement(r, rows.agreementVersions || []));
    out.spendEntries = (rows.spend || []).map(rowToSpend);
  }
  return out;
}
// Un error de «tabla inexistente» indica que 003 aún no está aplicada: la sincronización económica se desactiva sin romper el resto.
export const isMissingTable = (e) => !!e && (e.code === "42P01" || e.code === "PGRST205" || /could not find the table|does not exist/i.test(e.message || ""));

// Tras bajar de la nube se conservan los metadatos locales (quién/cuándo) de los registros con el mismo id:
// la base solo guarda el uuid del autor, no su correo (el correo está en audit_log, visible solo para revisor y admin).
export function keepLocalMeta(remoteList, localList, keys = ["by", "at"]) {
  const lm = byId(localList);
  return (remoteList || []).map((r) => { const l = lm[r.id]; if (!l) return r; const o = { ...r }; for (const k of keys) if (l[k] != null) o[k] = l[k]; return o; });
}

// Fusión al bajar de la nube: la base nunca borra, así que lo que solo existe en local está pendiente de subir y NO se pierde.
// Para el mismo id gana la nube, salvo un cambio local pendiente (acuerdo con versión mayor; precio cerrado localmente y abierto en la nube).
const mergeList = (remote, local, localWins) => {
  const lm = byId(local), rm = byId(remote);
  return [...(remote || []).map((r) => (lm[r.id] && localWins(lm[r.id], r) ? lm[r.id] : r)), ...(local || []).filter((l) => !rm[l.id])];
};
export function mergeEco(local, remoteParts) {
  const out = {};
  const lr = local.ref || {}, rr = remoteParts.ref;
  out.ref = {
    ...lr,
    ingredients: mergeList(rr.ingredients, lr.ingredients, () => false),
    aliases: mergeList(rr.aliases, lr.aliases, () => false),
    medicines: mergeList(rr.medicines, lr.medicines, () => false),
    presentations: mergeList(rr.presentations, lr.presentations, () => false),
  };
  if (remoteParts.priceVersions) out.priceVersions = mergeList(keepLocalMeta(remoteParts.priceVersions, local.priceVersions, ["by", "at", "closedBy", "closedAt"]), local.priceVersions, (l, r) => !!l.to && !r.to);
  if (remoteParts.agreements) out.agreements = mergeList(remoteParts.agreements, local.agreements, (l, r) => (l.version || 1) > r.version);
  if (remoteParts.spendEntries) out.spendEntries = mergeList(keepLocalMeta(remoteParts.spendEntries, local.spendEntries), local.spendEntries, () => false);
  return out;
}
