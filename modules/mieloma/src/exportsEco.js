// Campos económicos añadidos a las exportaciones existentes (informe, CSV de cálculo y de comparación).
// Distingue gasto REALIZADO, gasto PROYECTADO, importe COMPUTABLE para el acuerdo y ajustes/devoluciones REGISTRADOS.
// Las condiciones comerciales solo se incluyen si el rol lo permite (access.js). Sin acuerdos registrados devuelve null:
// las exportaciones de datos anteriores a esta versión salen exactamente igual que antes.
import { spendItems, evaluateAgreements, periodOf, AGREEMENT_TYPES, SCOPE_LEVELS } from "./agreements.js";
import { ingredientName, allPresentations, ensureRef } from "./refcatalog.js";
import { fmtDate } from "./engine.js";

const eur = (c) => (c == null ? "pendiente" : (c / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €");
export function scopeLabel(S, ag) {
  const t = ag.scope.targetId;
  if (ag.scope.level === "principio_activo") return `${SCOPE_LEVELS.principio_activo}: ${ingredientName(S, t)}`;
  if (ag.scope.level === "medicamento") return `${SCOPE_LEVELS.medicamento}: ${((ensureRef(S.ref).medicines.find((m) => m.id === t)) || {}).name || t}`;
  return `${SCOPE_LEVELS.presentacion}: ${((allPresentations(S).find((p) => p.id === t)) || {}).label || t}`;
}
export function agreementRow(S, ag, ev) {
  const th = ag.threshold && ag.threshold.amountCents;
  return {
    titulo: ag.title, tipo: AGREEMENT_TYPES[ag.type], alcance: scopeLabel(S, ag), periodo: `${fmtDate(periodOf(ag).from)} – ${fmtDate(periodOf(ag).to)}`,
    vigencia: `${fmtDate(ag.effective.from)}${ag.effective.to ? " – " + fmtDate(ag.effective.to) : " (sin fecha de fin)"}`, fuente: ag.source, responsable: ag.owner, umbral: th ? eur(th) : "",
    liquidacion: ag.settlement || "", realizado: eur(ev.realized.cents), fuenteRealizado: ev.realized.source, proyectado: eur(ev.projected.cents), proyeccionCorte: ev.projected.cutDate,
    proyeccionBase: ev.projected.basis, computable: eur(ev.computable.cents), consumido: ev.pct == null ? "" : Math.round(ev.pct * 1000) / 10 + " %", restante: ev.remaining == null ? "" : ev.remaining >= 0 ? eur(ev.remaining) : "excedido en " + eur(-ev.remaining),
    ajusteCalculado: ev.adjustment.status === "calculado" ? eur(ev.adjustment.cents) : ev.adjustment.status === "pendiente" ? "pendiente: " + ev.adjustment.reason : "", ajustesRegistrados: ev.registeredAdjustments.entries.length ? eur(ev.registeredAdjustments.cents) : "",
    incidencias: ev.incidents.map((i) => i.text).concat(ev.signals.map((s) => s.text)).join(" | "),
  };
}
// → null (nada que añadir) | { note } (sin permiso) | { rows, asOf }
export function ecoSection(S, schemes, { access, asOf = new Date().toISOString().slice(0, 10) } = {}) {
  const ags = (S.agreements || []).filter((a) => a);
  if (!ags.length) return null;
  if (access && !access.view) return { note: "Condiciones comerciales no incluidas: tu rol no tiene permiso para verlas.", rows: [] };
  const items = spendItems(S, schemes, asOf);
  const evs = evaluateAgreements(S, { items, asOf });
  return { asOf, rows: evs.filter((e) => e.active).map((e) => agreementRow(S, ags.find((a) => a.id === e.agreementId), e)) };
}
export const ecoLines = (eco) => {
  if (!eco) return [];
  if (eco.note) return ["", eco.note];
  const L = ["", `ACUERDOS Y MEDIDAS DE GASTO VIGENTES (a ${fmtDate(eco.asOf)}). «Realizado» = gasto registrado; «proyectado» = estimación por calendario; «computable» = base del acuerdo.`];
  eco.rows.forEach((r) => L.push(`- ${r.titulo} [${r.tipo}] · ${r.alcance} · periodo ${r.periodo} · fuente: ${r.fuente} · responsable: ${r.responsable}`, `    umbral ${r.umbral || "—"}; realizado ${r.realizado} (${r.fuenteRealizado}); proyectado ${r.proyectado} (corte ${r.proyeccionCorte}); computable ${r.computable}${r.consumido ? "; consumido " + r.consumido : ""}${r.restante ? "; restante " + r.restante : ""}; ajuste calculado: ${r.ajusteCalculado || "—"}; ajustes registrados: ${r.ajustesRegistrados || "—"}${r.incidencias ? "\n    INCIDENCIAS: " + r.incidencias : ""}`));
  return L;
};
export const ecoCSVRows = (eco) => {
  if (!eco) return [];
  if (eco.note) return [[], [eco.note]];
  const head = ["Acuerdo", "Tipo", "Alcance", "Periodo", "Vigencia", "Fuente", "Responsable", "Umbral", "Mecanismo de liquidación", "Gasto realizado", "Fuente del realizado", "Gasto proyectado", "Fecha de corte", "Base de la proyección", "Importe computable", "% consumido", "Restante/excedido", "Ajuste calculado", "Ajustes registrados", "Incidencias"];
  return [[], ["Acuerdos y medidas de gasto vigentes (realizado ≠ proyectado ≠ computable ≠ ajustes registrados)"], head, ...eco.rows.map((r) => [r.titulo, r.tipo, r.alcance, r.periodo, r.vigencia, r.fuente, r.responsable, r.umbral, r.liquidacion, r.realizado, r.fuenteRealizado, r.proyectado, r.proyeccionCorte, r.proyeccionBase, r.computable, r.consumido, r.restante, r.ajusteCalculado, r.ajustesRegistrados, r.incidencias])];
};

// CSV de una estimación guardada de un plan importado: es SIEMPRE estimación (calendario del plan), nunca gasto realizado.
import { toCSV } from "./engine.js";
import { REASONS } from "./estimate.js";
export function estimateCSV(est, plan, eco) {
  const e2 = (c) => (c == null ? "" : (c / 100).toFixed(2).replace(".", ","));
  const rows = [["Estimación de plan importado (proyección; no es gasto realizado)"], ["Plan", plan ? plan.name : est.planId], ["Revisión", plan ? plan.revision : ""], ["Estimación generada", est.createdAt], ["Generada por", est.createdBy || ""], ["Regla de cálculo", est.rule.text], ["Tratamiento de IVA", est.rule.vat === "con_iva" ? "con IVA" : "sin IVA"], ["Redondeo", est.rule.rounding], ["Calendario", est.calendar.mode === "fecha" ? "desde " + est.calendar.startDate : "relativo (sin fecha inicial; precios a " + est.calendar.refDate + ")"], ["Resultado", est.total.incomplete ? "TOTAL PARCIAL (hay líneas pendientes)" : "Total completo"], ["Total (€)", e2(est.total.cents)], [],
    ["Fase", "Ciclo", "Día", "Fecha", "Fármaco", "Dosis (mg)", "Presentaciones", "Precio por unidad (€)", "Versión y fuente de precio", "Importe (€)", "Estado", "Motivo"]];
  for (const a of est.administrations) rows.push([a.phase, a.cycle, a.day, a.date || "relativa", a.label, a.doseMg == null ? "" : String(Math.round(a.doseMg * 100) / 100).replace(".", ","), (a.items || []).map((i) => `${i.n}× ${i.label}`).join(" + "), (a.items || []).map((i) => (i.unitPriceUnits / 10000).toFixed(4).replace(".", ",")).join(" + "), (a.items || []).map((i) => `${i.priceVersionId} · ${i.priceSource || ""} · desde ${i.priceFrom || "origen"}`).join(" ; "), e2(a.cents), a.status === "ok" ? "valorada" : "incompleta", (a.reasons || []).map((r) => REASONS[r] || r).join("; ")]);
  if (est.total.pendingLines.length) { rows.push([], ["Líneas pendientes"]); est.total.pendingLines.forEach((l) => rows.push([l.phase, l.label, l.reasons.map((r) => REASONS[r] || r).join("; ")])); }
  rows.push(...ecoCSVRows(eco));
  return toCSV(rows);
}
