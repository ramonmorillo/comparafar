// Acuerdos y medidas de gasto: registro con vigencia e histórico, cómputo de gasto y evaluación (techo, descuentos, devoluciones, volumen).
// Puro. Importes en céntimos enteros. Las condiciones comerciales son sensibles: ver access.js para quién puede verlas.
import { computeScheme, addDays } from "./engine.js";
import { allPresentations, ensureRef } from "./refcatalog.js";
import { currentPlans } from "./importflow.js";

export const AGREEMENT_TYPES = { techo: "Techo de gasto", descuento: "Descuento", devolucion: "Devolución", volumen: "Acuerdo por volumen", otra: "Otra medida documentada" };
export const SCOPE_LEVELS = { principio_activo: "Principio activo", medicamento: "Medicamento", presentacion: "Presentación" };
export const FORMULA_KINDS = { pct: "Porcentaje (opcionalmente sobre lo que exceda un umbral)", fijo: "Importe fijo", tramos: "Tramos por gasto acumulado" };
export class AgreementError extends Error { constructor(m) { super(m); } }
const uid = () => "AC-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + "T00:00:00Z"));
const clampPct = (p) => typeof p === "number" && p > 0 && p <= 1;

export function periodOf(ag) {
  const p = ag.period || {};
  return p.kind === "natural" ? { from: `${p.year}-01-01`, to: `${p.year}-12-31` } : { from: p.from, to: p.to };
}

export function validateAgreement(a) {
  const e = [];
  if (!AGREEMENT_TYPES[a.type]) e.push("Elige el tipo de medida.");
  if (!a.title || !a.title.trim()) e.push("Falta el título.");
  if (!a.scope || !SCOPE_LEVELS[a.scope.level] || !a.scope.targetId) e.push("Define el alcance (principio activo, medicamento o presentación).");
  const p = a.period || {};
  if (p.kind === "natural") { if (!(Number.isInteger(p.year) && p.year >= 2000 && p.year <= 2100)) e.push("Ejercicio natural no válido."); }
  else if (p.kind === "custom") { if (!isDate(p.from) || !isDate(p.to)) e.push("Indica las fechas de inicio y cierre del periodo."); else if (p.to < p.from) e.push("El cierre del periodo es anterior al inicio."); }
  else e.push("Elige el periodo (ejercicio natural o fechas propias).");
  if (!a.effective || !isDate(a.effective.from)) e.push("Indica la fecha de entrada en vigor."); else if (a.effective.to && (!isDate(a.effective.to) || a.effective.to < a.effective.from)) e.push("Fecha de fin de vigencia no válida.");
  if (!a.source || !a.source.trim()) e.push("La fuente es obligatoria (contrato, resolución, acta…).");
  if (!a.owner || !a.owner.trim()) e.push("Indica la persona responsable.");
  if (a.type === "techo" && !(a.threshold && a.threshold.amountCents > 0)) e.push("El techo necesita un importe mayor que 0.");
  const f = a.formula;
  if (f) {
    if (f.kind === "pct" && !clampPct(f.pct)) e.push("Porcentaje no válido (entre 0 y 1).");
    if (f.kind === "fijo" && !(f.amountCents > 0)) e.push("Importe fijo no válido.");
    if (f.kind === "tramos" && !(Array.isArray(f.tiers) && f.tiers.length && f.tiers.every((t, i) => t.from >= 0 && typeof t.pct === "number" && t.pct >= 0 && t.pct <= 1 && (t.to == null || t.to > t.from) && (i === 0 || t.from >= f.tiers[i - 1].from)))) e.push("Tramos no válidos.");
  }
  if (["descuento", "devolucion", "volumen"].includes(a.type) && f && f.kind && !a.settlement) e.push("Indica el mecanismo de liquidación.");
  return e;
}

// Alta o modificación con histórico: cada cambio conserva la versión anterior y quién/cuándo.
export function saveAgreement(list, input, { user, now = new Date().toISOString() } = {}) {
  const prev = input.id && list.find((x) => x.id === input.id);
  if (prev && prev.voided) throw new AgreementError("Un acuerdo anulado no se modifica: registra uno nuevo.");
  const errs = validateAgreement(input); if (errs.length) throw new AgreementError(errs.join(" "));
  if (!prev) return [...list, { ...input, id: uid(), version: 1, createdAt: now, createdBy: user || null, history: [] }];
  const { history, ...snap } = prev;
  return list.map((x) => (x.id === prev.id ? { ...input, id: prev.id, version: prev.version + 1, createdAt: prev.createdAt, createdBy: prev.createdBy, modifiedAt: now, modifiedBy: user || null, history: [...history, { ...snap, replacedAt: now, replacedBy: user || null }] } : x));
}

// Anular (irreversible, con motivo): nueva versión con estado «anulado»; la anterior queda en el histórico. Solo revisor/admin (lo exige la interfaz y la base).
export const isVoidedAgreement = (a) => !!a.voided;
export const activeAgreements = (S) => (S.agreements || []).filter((a) => !a.voided);
export function voidAgreement(list, id, reason, { user, now = new Date().toISOString() } = {}) {
  const r = String(reason == null ? "" : reason).trim(); if (!r) throw new AgreementError("El motivo de la anulación es obligatorio.");
  const prev = (list || []).find((x) => x.id === id);
  if (!prev) throw new AgreementError("Acuerdo no encontrado.");
  if (prev.voided) throw new AgreementError("Este acuerdo ya está anulado.");
  const { history, ...snap } = prev;
  return list.map((x) => (x.id === id ? { ...prev, version: prev.version + 1, status: "anulado", voided: { at: now, by: user || null, reason: r }, modifiedAt: now, modifiedBy: user || null, history: [...history, { ...snap, replacedAt: now, replacedBy: user || null }] } : x));
}

/* ---------- Alcance ---------- */
function scopeIndex(S) {
  const ref = ensureRef(S.ref); const pres = Object.fromEntries(allPresentations(S).map((p) => [p.id, p])); const med = Object.fromEntries(ref.medicines.map((m) => [m.id, m]));
  return { pres, med };
}
export function itemMatches(ag, item) {
  const t = ag.scope.targetId;
  if (ag.scope.level === "principio_activo") return (item.ingredientIds || []).includes(t);
  if (ag.scope.level === "medicamento") return (item.medicineIds || []).includes(t);
  return (item.presIds || []).includes(t);
}
const covers = (a, b, ix) => {
  if (a.scope.level === b.scope.level) return a.scope.targetId === b.scope.targetId;
  const ingOf = (x) => (x.scope.level === "principio_activo" ? [x.scope.targetId] : x.scope.level === "medicamento" ? ((ix.med[x.scope.targetId] || {}).ingredients || []).map((i) => i.ingredientId) : (ix.pres[x.scope.targetId] || {}).ingredientIds || []);
  const medOfPres = (x) => (ix.pres[x.scope.targetId] || {}).medicineId;
  if (a.scope.level === "principio_activo") return ingOf(b).includes(a.scope.targetId);
  if (a.scope.level === "medicamento" && b.scope.level === "presentacion") return medOfPres(b) === a.scope.targetId;
  return false;
};
const periodsOverlap = (a, b) => { const x = periodOf(a), y = periodOf(b); return x.from <= y.to && y.from <= x.to; };
export function overlapping(S, a, b) {
  const ix = scopeIndex(S);
  return (covers(a, b, ix) || covers(b, a, ix)) && periodsOverlap(a, b) && (!a.scope.center || !b.scope.center || a.scope.center === b.scope.center);
}

/* ---------- Partidas de gasto ---------- */
const toCents = (eur) => Math.round(eur * 100);
// Partidas de gasto a nivel de administración: ejecución de la agenda (planes heredados) y estimaciones de planes importados.
// kind: realizado (registrada como administrada) | proyectado (futura) | sin_registro (prevista y vencida sin registrar)
export function spendItems(S, schemes, asOf) {
  const items = [];
  const pres = Object.fromEntries(allPresentations(S).map((p) => [p.id, p])); const ref = ensureRef(S.ref);
  const medOf = (presId) => (pres[presId] || {}).medicineId;
  for (const plan of S.plans || []) {
    const sch = schemes.find((s) => s.id === plan.schemeId), pat = (S.patients || []).find((p) => p.code === plan.patient);
    if (!sch || !pat || !plan.start) continue;
    const res = computeScheme(sch, S.catalog, { weight: pat.weight, height: pat.height, scMethod: pat.scMethod, scOverride: pat.scOverride }, { reuse: 0, maint: plan.maint || "none", horizon: "all" });
    res.events.forEach((e, i) => {
      if (e.eff == null || e.fixed) return;
      const date = addDays(plan.start, e.day - 1), id = `${plan.id}:${i}`, done = plan.done && plan.done[id];
      items.push({ date, cents: toCents(e.eff), ingredientIds: ["legacy:" + e.drug], medicineIds: [], presIds: [], kind: done && done.status === "ok" ? "realizado" : date > asOf ? "proyectado" : done ? "sin_registro" : "sin_registro", origin: "agenda", ref: plan.id });
    });
  }
  const latest = {};
  for (const est of S.estimates || []) if (!latest[est.planId] || est.createdAt > latest[est.planId].createdAt) latest[est.planId] = est;
  const vigentes = new Set(currentPlans(S).map((p) => p.id)); // solo la revisión vigente de cada plan: evita contar dos veces
  for (const est of Object.values(latest)) {
    const plan = (S.importedPlans || []).find((p) => p.id === est.planId); if (!plan || plan.status !== "confirmado" || !vigentes.has(plan.id)) continue;
    for (const a of est.administrations) {
      if (a.status !== "ok") { items.push({ date: a.date, cents: null, ingredientIds: [], medicineIds: [], presIds: [], kind: "pendiente", origin: "estimacion", ref: est.id }); continue; }
      const presIds = a.items.map((i) => i.presId);
      items.push({ date: a.date, cents: a.cents, ingredientIds: [...new Set(presIds.flatMap((p) => (pres[p] || {}).ingredientIds || []))], medicineIds: [...new Set(presIds.map(medOf).filter(Boolean))], presIds, kind: a.date ? "proyectado" : "sin_fecha", origin: "estimacion", ref: est.id });
    }
  }
  return items;
}

/* ---------- Evaluación ---------- */
function tiersAdjust(B, tiers) { return tiers.reduce((s, t) => { const hi = t.to == null ? B : Math.min(B, t.to), lo = t.from; return hi > lo ? s + Math.round((hi - lo) * t.pct) : s; }, 0); }
function rawAdjustment(ag, base, exceeded) {
  const f = ag.formula; if (!f) return null;
  if (f.kind === "pct") return Math.round(Math.max(0, base - (f.over || 0)) * f.pct);
  if (f.kind === "fijo") return f.when === "techo_superado" ? (exceeded ? f.amountCents : 0) : f.amountCents;
  if (f.kind === "tramos") return tiersAdjust(base, f.tiers);
  return null;
}

// ctx: { S, schemes?, items, asOf } → evaluación de todos los acuerdos vigentes (o de los pedidos).
export function evaluateAgreements(S, { items, asOf, only } = {}) {
  const ags = activeAgreements(S).filter((a) => (!only || only.includes(a.id)));   // los anulados no computan
  const entries = (S.spendEntries || []).filter((e) => !e.voided);   // el gasto anulado no computa
  const evals = ags.map((ag) => evalOne(S, ag, items || [], entries, asOf));
  // Interacción entre acuerdos coincidentes
  const act = evals.filter((e) => e.active);
  for (const e of act) {
    const ag = ags.find((a) => a.id === e.agreementId);
    e.coincide = act.filter((o) => o !== e && overlapping(S, ag, ags.find((a) => a.id === o.agreementId))).map((o) => o.agreementId);
  }
  const seen = new Set();
  for (const e of act) {
    if (!e.coincide.length || seen.has(e.agreementId)) continue;
    const group = [];
    const stack = [e.agreementId];
    while (stack.length) { const id = stack.pop(); if (group.includes(id)) continue; group.push(id); stack.push(...act.find((x) => x.agreementId === id).coincide); }
    group.forEach((id) => seen.add(id));
    const members = group.map((id) => ags.find((a) => a.id === id));
    const adjMembers = members.filter((a) => a.formula);
    const defined = adjMembers.every((a) => Number.isInteger(a.order) && a.base) && new Set(adjMembers.map((a) => a.order)).size === adjMembers.length;
    const titles = members.map((a) => `«${a.title}»`).join(", ");
    group.forEach((id) => {
      const ev = act.find((x) => x.agreementId === id);
      ev.incidents.push({ code: "ACUERDOS_COINCIDENTES", text: `Coinciden ${members.length} acuerdos (${titles}).${defined || !adjMembers.length ? "" : " No está definido el orden ni la base de aplicación: el ajuste queda pendiente."}` });
      if (!defined && adjMembers.length && ev.adjustment.status === "calculado") ev.adjustment = { status: "pendiente", cents: null, reason: "Interacción entre acuerdos sin definir (orden y base de aplicación)." };
    });
    if (defined && adjMembers.length > 1) { // aplicación secuencial por orden; base neta resta ajustes previos
      let acc = 0;
      adjMembers.slice().sort((a, b) => a.order - b.order).forEach((a) => {
        const ev = act.find((x) => x.agreementId === a.id);
        if (ev.adjustment.status !== "calculado") return;
        const base = a.base === "neto" ? Math.max(0, ev.computable.cents - acc) : ev.computable.cents;
        const adj = rawAdjustment(a, base, ev.exceeded); ev.adjustment = { status: "calculado", cents: adj, reason: `Orden ${a.order}, base ${a.base}.` }; acc += adj;
      });
    }
  }
  return evals;
}

function evalOne(S, ag, items, entries, asOf) {
  const { from, to } = periodOf(ag);
  const active = ag.effective.from <= asOf && (!ag.effective.to || asOf <= ag.effective.to);
  const incidents = [], limits = [];
  if (ag.scope.indication) limits.push(`indicación «${ag.scope.indication}»`);
  if (ag.scope.population) limits.push(`población «${ag.scope.population}»`);
  if (ag.scope.center) limits.push(`centro «${ag.scope.center}»`);
  if (limits.length) incidents.push({ code: "ALCANCE_NO_VERIFICABLE", text: `El acuerdo se limita a ${limits.join(", ")}, pero los datos de gasto disponibles no permiten delimitarlo: el gasto incluye todo el ámbito del ${SCOPE_LEVELS[ag.scope.level].toLowerCase()}.` });
  const mine = items.filter((it) => itemMatches(ag, it));
  const inP = (d) => d && d >= from && d <= to;
  // Gasto realizado: acumulado contable fechado (si hay) + ejecución registrada posterior; si no, solo ejecución; si no hay nada, pendiente.
  const accs = entries.filter((e) => e.kind === "realizado" && e.scope && e.scope.level === ag.scope.level && e.scope.targetId === ag.scope.targetId && e.from <= from && e.to >= to && e.asOf <= asOf).sort((a, b) => b.asOf.localeCompare(a.asOf));
  const acc = accs[0];
  const execDone = mine.filter((i) => i.kind === "realizado" && inP(i.date) && i.date <= asOf && (!acc || i.date > acc.asOf));
  let realized = { cents: null, source: "pendiente", detail: "Sin fuente de gasto realizado: registra un acumulado fechado o la ejecución de la agenda." };
  if (acc) realized = { cents: acc.amountCents + execDone.reduce((s, i) => s + i.cents, 0), source: "contabilidad", detail: `Acumulado a ${acc.asOf} (${acc.source})${execDone.length ? ` + ${execDone.length} administración(es) registradas después` : ""}.`, asOf: acc.asOf };
  else if (execDone.length) realized = { cents: execDone.reduce((s, i) => s + i.cents, 0), source: "agenda", detail: `${execDone.length} administración(es) registradas como administradas en la agenda.` };
  const unreg = mine.filter((i) => i.kind === "sin_registro" && inP(i.date)).length;
  if (unreg) incidents.push({ code: "SIN_REGISTRO", text: `${unreg} administración(es) prevista(s) y vencida(s) sin registro de ejecución: no computan como gasto realizado.` });
  if (acc && accs.length > 1) incidents.push({ code: "ACUMULADOS_MULTIPLES", text: "Hay varios acumulados registrados; se usa el de fecha más reciente." });
  // Proyección
  const projItems = mine.filter((i) => i.kind === "proyectado" && inP(i.date) && i.date > asOf);
  const pending = mine.filter((i) => i.kind === "pendiente").length, undated = mine.filter((i) => i.kind === "sin_fecha").length;
  const projected = { cents: projItems.reduce((s, i) => s + i.cents, 0), cutDate: asOf, from: addDays(asOf, 1), to, admins: projItems.length, incomplete: pending > 0 || undated > 0, basis: `${projItems.length} administración(es) planificadas entre ${addDays(asOf, 1)} y ${to} (estimación a partir del calendario de los planes; no es gasto realizado)${pending ? `; ${pending} administración(es) sin importe por datos pendientes` : ""}${undated ? `; ${undated} sin fecha (no ubicables en el periodo)` : ""}.` };
  const computable = { cents: realized.cents, note: "Gasto realizado dentro del periodo del acuerdo" };
  const adjRegistered = entries.filter((e) => (e.kind === "ajuste" || e.kind === "devolucion") && e.agreementId === ag.id);
  const registered = { cents: adjRegistered.reduce((s, e) => s + e.amountCents, 0), entries: adjRegistered };
  const ev = { agreementId: ag.id, type: ag.type, title: ag.title, active, period: { from, to }, asOf, realized, projected, computable, registeredAdjustments: registered, incidents, coincide: [], signals: [], adjustment: { status: "no_aplica", cents: null, reason: "" } };
  const th = ag.threshold && ag.threshold.amountCents;
  if (th) {
    ev.threshold = th;
    if (realized.cents != null) {
      ev.pct = realized.cents / th; ev.remaining = th - realized.cents; ev.exceeded = realized.cents > th; ev.excess = Math.max(0, realized.cents - th);
      if (ev.exceeded) ev.signals.push({ level: "crit", code: "TECHO_SUPERADO", text: `Techo superado en ${(ev.excess / 100).toFixed(2).replace(".", ",")} €.` });
    }
    if (realized.cents != null) { ev.projectedClose = realized.cents + projected.cents; ev.projectedExceeds = !ev.exceeded && ev.projectedClose > th; if (ev.projectedExceeds) ev.signals.push({ level: "warn", code: "TECHO_PROYECTADO", text: "La proyección de cierre supera el techo." }); }
    else ev.projectedClose = null;
  } else if (realized.cents != null) ev.projectedClose = realized.cents + projected.cents;
  if (ag.formula && active) {
    if (realized.cents == null) ev.adjustment = { status: "pendiente", cents: null, reason: "Sin gasto realizado: no se puede calcular el ajuste." };
    else if (ag.type === "otra") ev.adjustment = { status: "no_aplica", cents: null, reason: "Medida documentada sin cálculo automático." };
    else ev.adjustment = { status: "calculado", cents: rawAdjustment(ag, realized.cents, ev.exceeded), reason: "Fórmula configurada sobre el gasto realizado." };
  } else if (["descuento", "devolucion", "volumen"].includes(ag.type) && active) ev.adjustment = { status: "pendiente", cents: null, reason: "Fórmula, condiciones y orden de aplicación sin configurar." };
  return ev;
}
