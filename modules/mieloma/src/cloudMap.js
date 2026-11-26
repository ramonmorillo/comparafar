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
// Un precio local se identifica por su contenido cuando aún no tiene `rid` (id de fila de la nube).
const hkey = (h) => stableStringify({ p: Number(h.price), f: h.from || null, s: h.source, t: h.type || null });
// Entradas de historial locales que aún NO están en la nube. Se reconocen por no tener `rid`; si una entrada sin `rid`
// coincide con una fila remota que ningún local reclama (p. ej. datos semilla), se considera ya subida (no se duplica).
// Esto sustituye al antiguo corte posicional (slice), que perdía el precio propio si otra persona había subido uno antes.
export function pendingPrices(localHist, remoteHist) {
  const claimed = new Set((localHist || []).filter(h => h.rid != null).map(h => h.rid));
  const pool = new Map();
  for (const r of remoteHist || []) if (r.rid == null || !claimed.has(r.rid)) pool.set(hkey(r), (pool.get(hkey(r)) || 0) + 1);
  const out = [];
  for (const h of localHist || []) {
    if (h.rid != null) continue;
    const k = hkey(h), n = pool.get(k) || 0;
    if (n > 0) pool.set(k, n - 1); else out.push(h);
  }
  return out;
}
// Qué hay que enviar para que `remote` (catálogo conocido de la nube) iguale a `local`.
export function diffCatalog(local, remote) {
  const rm = Object.fromEntries((remote || []).map(i => [i.id, i]));
  const upserts = [], prices = [];
  for (const it of local || []) {
    const r = rm[it.id];
    if (!r || stableStringify(itemToRow(it)) !== stableStringify(itemToRow(r))) upserts.push(itemToRow(it));
    pendingPrices(it.history, r ? r.history : []).forEach(h => prices.push(priceToRow(it.id, h)));
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

/* ---------- Fusión al bajar de la nube (no destructiva) ----------
   Antes, bajar de la nube SUSTITUÍA el estado local y se perdía lo pendiente de subir. Ahora:
   · lo que solo existe en local (altas) se conserva;
   · precios locales sin `rid` y anulaciones locales pendientes se conservan sobre el historial remoto;
   · una edición local de un registro se conserva si la nube no lo ha cambiado desde la última bajada (`prev`);
   · si cambiaron ambos lados gana la nube y el cambio local descartado se devuelve en `conflicts` (para avisar y guardar copia);
   · sin `prev` (primer acceso tras trabajar sin conexión o recargar) la nube gana en las filas del catálogo,
     pero los precios nuevos locales se conservan; un esquema local distinto del remoto cuenta como conflicto. */
const rowKey = (it) => stableStringify(itemToRow(it));
export function mergeCatalog(local, remote, prev) {
  const conflicts = [];
  if (!remote || !remote.length) return { catalog: local, conflicts };
  const lm = Object.fromEntries((local || []).map(i => [i.id, i]));
  const rm = Object.fromEntries(remote.map(i => [i.id, i]));
  const pm = prev ? Object.fromEntries(prev.map(i => [i.id, i])) : {};
  const out = remote.map(r => {
    const l = lm[r.id];
    if (!l) return r;
    const p = pm[r.id];
    let base = r;
    if (p && rowKey(l) !== rowKey(p)) {
      if (rowKey(r) === rowKey(p)) base = { ...r, ...itemToLocalFields(l) };
      else if (rowKey(l) !== rowKey(r)) conflicts.push({ kind: "presentación", id: r.id, name: l.label, local: l });
    }
    const lh = new Map((l.history || []).filter(h => h.rid != null).map(h => [h.rid, h]));
    const history = (r.history || []).map(h => (lh.has(h.rid) && lh.get(h.rid).voided && !h.voided ? { ...h, voided: lh.get(h.rid).voided } : h));
    const pend = pendingPrices(l.history, r.history);
    return { ...base, history: pend.length ? [...history, ...pend] : history };
  });
  for (const l of local || []) if (!rm[l.id]) out.push(l);
  return { catalog: out, conflicts };
}
const itemToLocalFields = (l) => { const { history, ...rest } = l; return rest; };

export function mergeSchemes(local, remote, prevMap) {
  const conflicts = [];
  const lm = Object.fromEntries((local || []).map(s => [s.id, s]));
  const rm = Object.fromEntries((remote || []).map(s => [s.id, s]));
  const out = (remote || []).map(r => {
    const l = lm[r.id];
    if (!l || norm(l) === norm(r)) return r;
    const p = prevMap && prevMap[r.id];
    if (p) {
      const lc = norm(l) !== norm(p), rc = norm(r) !== norm(p);
      if (lc && !rc) return { ...l, version: r.version };    // cambio local pendiente sobre la versión actual de la nube
      if (lc && rc) conflicts.push({ kind: "esquema", id: r.id, name: l.name, local: l });
      return r;
    }
    conflicts.push({ kind: "esquema", id: r.id, name: l.name, local: l });
    return r;
  });
  for (const l of local || []) if (!rm[l.id]) out.push(l);        // altas aún no subidas
  return { schemes: out, conflicts };
}
