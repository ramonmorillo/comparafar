// Mapeos puros entre el estado de la app y las filas de Supabase (sin red; testeables).
export function rowsToCatalog(items, prices) {
  const by = {};
  for (const p of prices || []) (by[p.item_id] = by[p.item_id] || []).push(p);
  return (items || []).map(r => ({
    id: r.id, drug: r.drug, label: r.label, mg: r.mg == null ? null : Number(r.mg), unit: r.unit,
    oral: !!r.oral, route: r.route, center: r.center, excelCell: r.excel_cell, status: r.status, archived: !!r.archived,
    history: (by[r.id] || []).slice().sort((a, b) => String(a.added_at).localeCompare(String(b.added_at)) || a.id - b.id)
      .map(p => ({ price: Number(p.price), from: p.valid_from, source: p.source, type: p.price_type, note: p.note, rid: p.id,
        ...(p.voided_at ? { voided: { at: p.voided_at, by: null, reason: p.void_reason || "" } } : {}) })),
  }));
}
export function itemToRow(it) {
  return { id: it.id, drug: it.drug, label: it.label, mg: it.mg, unit: it.unit, oral: !!it.oral, route: it.route,
    center: it.center, excel_cell: it.excelCell, status: it.status || "pendiente", archived: !!it.archived };
}
export function priceToRow(itemId, e) {
  if (!e || !(Number(e.price) > 0)) throw new Error("El precio debe ser mayor que 0");
  if (!e.source || !String(e.source).trim()) throw new Error("La fuente del precio es obligatoria");
  const row = { item_id: itemId, price: Number(e.price) };
  if (e.type) row.price_type = e.type;
  row.valid_from = e.from || null; row.source = e.source; row.note = e.note || null;
  return { item_id: row.item_id, price: row.price, price_type: row.price_type, valid_from: row.valid_from, source: row.source, note: row.note };
}
export function schemeToRow(s) {
  return { id: s.id, name: s.name, line: s.line, version: s.version || 1, status: s.status || "borrador",
    archived: !!s.archived, verified: s.verified || null, data: s };
}
export function rowToScheme(r) {
  return { ...r.data, id: r.id, name: r.name, line: r.line, version: r.version, status: r.status, archived: !!r.archived, verified: r.verified || null };
}
export function isConflict(e) {
  return !!e && (e.code === "40001" || /Conflicto de versi/i.test(e.message || ""));
}

export function stableStringify(v) {
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ":" + stableStringify(v[k])).join(",") + "}";
  return JSON.stringify(v);
}
// Qué hay que enviar para que `remote` (catálogo conocido de la nube) iguale a `local`.
export function diffCatalog(local, remote) {
  const rm = Object.fromEntries((remote || []).map(i => [i.id, i]));
  const upserts = [], prices = [];
  for (const it of local || []) {
    const r = rm[it.id];
    if (!r || stableStringify(itemToRow(it)) !== stableStringify(itemToRow(r))) upserts.push(itemToRow(it));
    const have = r ? (r.history || []).length : 0;
    (it.history || []).slice(have).forEach(h => prices.push(priceToRow(it.id, h)));
  }
  return { upserts, prices };
}
const norm = s => { const { version, ...rest } = s; return stableStringify(rest); };
// remote: mapa id -> esquema (con version). Devuelve altas y cambios con la versión esperada.
export function diffSchemes(local, remote) {
  const inserts = [], updates = [];
  for (const s of local || []) {
    const r = remote[s.id];
    if (!r) inserts.push(s);
    else if (norm(s) !== norm(r)) updates.push({ scheme: s, expected: r.version });
  }
  return { inserts, updates };
}

// Anulaciones pendientes de enviar en price_history: entradas anuladas en local cuya fila en la nube aún no lo está.
// Las filas se identifican por `rid` (id de fila de la nube); una entrada local sin rid aún no se ha subido y no se puede anular allí.
export function diffHistoryVoids(local, remote) {
  const rm = {};
  for (const it of remote || []) for (const h of it.history || []) if (h.rid != null) rm[h.rid] = h;
  const out = [];
  for (const it of local || []) for (const h of it.history || []) if (h.voided && h.rid != null && rm[h.rid] && !rm[h.rid].voided) out.push({ id: h.rid, reason: h.voided.reason });
  return out;
}
