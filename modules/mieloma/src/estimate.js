// Estimación económica de un plan importado (fases → ciclos → días → administraciones).
// Reutiliza del motor: resolvePatient, doseMg, minCover, addDays. Importes en enteros (ver money.js).
// Nunca devuelve 0 € para una línea sin datos: la marca como incompleta con su motivo y excluye su importe del total parcial.
import { resolvePatient, doseMg, minCover, addDays } from "./engine.js";
import { allPresentations } from "./refcatalog.js";
import { versionsFor, resolvePrice, unitPrice, DEFAULT_CONDITION } from "./pricing.js";
import { unitsToCents, ROUNDING_RULE, UNITS_PER_EUR } from "./money.js";

export const ESTIMATE_ENGINE = "1.0.0";
export const REASONS = {
  SIN_INGREDIENTE: "Fármaco sin correspondencia en el catálogo",
  SIN_PRESENTACION: "El principio activo no tiene presentaciones en el catálogo",
  SIN_EQUIVALENCIA: "Ninguna presentación tiene equivalencia mg por envase",
  SIN_PRECIO: "Sin precio vigente en la fecha de la administración",
  SIN_PACIENTE: "Dosis por peso o superficie corporal sin datos válidos del paciente",
  UNIDAD_NO_SOPORTADA: "Unidad de dosis no convertible a mg",
  DOSIS_NO_RESUELTA: "Dosis sin resolver",
  IVA_NO_RESUELTO: "No se puede aplicar el tratamiento de IVA pedido",
};
const MAX_COMBOS = 200000;

export function policyText(o) {
  return o.policy === "aprovechamiento" ? `Envases completos con aprovechamiento explícito del ${Math.round((o.reuse || 0) * 100)} % del sobrante parenteral` : "Envases completos, sin aprovechamiento del sobrante";
}

// Cobertura mínima con guarda frente a explosión combinatoria.
function cover(doseMgV, pres) {
  const combos = pres.reduce((p, x) => p * (Math.ceil(doseMgV / x.mg - 1e-9) + 1), 1);
  if (combos <= MAX_COMBOS) return minCover(doseMgV, pres);
  const best = pres.slice().sort((a, b) => a.price / a.mg - b.price / b.mg)[0];
  const n = Math.ceil(doseMgV / best.mg - 1e-9);
  return { items: [{ pres: best, n }], mgSupplied: n * best.mg, cost: n * best.price };
}

// opts: { patient, policy, reuse, vat, center, condition, refDate, now, user }
export function estimatePlan(S, plan, opts = {}) {
  const o = { policy: "vial", reuse: 0, vat: "sin_iva", center: "", condition: DEFAULT_CONDITION, refDate: new Date().toISOString().slice(0, 10), ...opts };
  const now = o.now || new Date().toISOString();
  const pt = o.patient ? resolvePatient(o.patient) : null;
  const allPres = allPresentations(S);
  const verCache = {};
  const vers = (id) => verCache[id] || (verCache[id] = versionsFor(S, id));
  const admins = [], warnings = [], pendingLines = new Map();
  const planBlockers = [];
  const note = (w) => { if (!warnings.some((x) => x.code === w.code && x.text === w.text)) warnings.push(w); };

  let offset = 0;
  for (const ph of plan.phases || []) {
    let cycles = ph.cycles != null ? ph.cycles : ph.horizonCycles != null ? ph.horizonCycles : 1;
    if (ph.cycles == null && ph.horizonCycles == null) {
      if (ph.cyclesMode === "tramo") note({ level: "info", code: "TRAMO_DOCUMENTADO", text: `Fase «${ph.name}»: el documento no indica el número de ciclos; por decisión del usuario se estima solo el tramo documentado (1 ciclo).` });
      else { note({ level: "warn", code: "CICLOS_NO_DEFINIDOS", text: `Fase «${ph.name}»: el documento no indica el número de ciclos; se estima solo el tramo documentado (1 ciclo). Indica el horizonte de proyección para ampliarlo.` }); planBlockers.push({ phase: ph.id, code: "CICLOS_NO_DEFINIDOS" }); }
    }
    const interval = ph.interval > 0 ? ph.interval : null;
    if (cycles > 1 && !interval) { cycles = 1; note({ level: "crit", code: "INTERVALO_NO_DEFINIDO", text: `Fase «${ph.name}»: sin intervalo entre ciclos; solo se estima el primer ciclo.` }); planBlockers.push({ phase: ph.id, code: "INTERVALO_NO_DEFINIDO" }); }
    const len = interval || 0;
    for (const ln of ph.lines || []) {
      if (ln.included == null && ln.category === "ambiguo") { pendingLines.set(ln.id, { lineId: ln.id, label: lineLabel(ln), reasons: ["LINEA_POR_REVISAR"], phase: ph.name }); continue; }
      if (!ln.included) continue;
      for (let c = 1; c <= cycles; c++) {
        for (const d of ln.days || []) {
          const dayAbs = offset + (c - 1) * len + (d - 1);
          const date = plan.startDate ? addDays(plan.startDate, dayAbs) : null;
          const priceDate = date || o.refDate;
          for (const comp of ln.components || []) {
            if (comp.role === "diluyente") continue;
            const a = costAdmin({ S, comp, pt, o, allPres, vers, priceDate });
            admins.push({ id: `${ph.id}|c${c}|d${d}|${ln.id}|${comp.id}`, phaseId: ph.id, phase: ph.name, cycle: c, day: d, dayAbs, date, lineId: ln.id, label: comp.nameLiteral, category: ln.category, priceDate, ...a });
            if (a.status === "incompleto") { const k = ln.id + "|" + comp.id; const e = pendingLines.get(k) || { lineId: ln.id, label: comp.nameLiteral, reasons: [], phase: ph.name }; a.reasons.forEach((r) => !e.reasons.includes(r) && e.reasons.push(r)); pendingLines.set(k, e); }
          }
        }
      }
    }
    offset += cycles * len;
  }
  if (!plan.startDate) note({ level: "info", code: "SIN_FECHA_INICIAL", text: `Sin fecha inicial: los precios se resolvieron a la fecha de cálculo (${o.refDate}) y las administraciones no tienen fecha de calendario.` });
  if (pt && pt.errors.length) note({ level: "crit", code: "PACIENTE", text: "Datos del paciente no válidos: " + pt.errors.join(" ") });

  const ok = admins.filter((a) => a.status === "ok");
  const sum = (arr) => arr.reduce((s, a) => s + (a.cents || 0), 0);
  const group = (keyFn) => { const m = new Map(); admins.forEach((a) => { const k = keyFn(a); const g = m.get(k.key) || { ...k, cents: 0, admins: 0, incomplete: 0 }; g.admins++; if (a.status === "ok") g.cents += a.cents; else g.incomplete++; m.set(k.key, g); }); return [...m.values()]; };
  const incomplete = admins.some((a) => a.status !== "ok") || pendingLines.size > 0 || planBlockers.length > 0;
  return {
    id: "EST-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), planId: plan.id, createdAt: now, createdBy: o.user || null, kind: "estimacion", engine: ESTIMATE_ENGINE,
    rule: { policy: o.policy, reuse: o.policy === "aprovechamiento" ? o.reuse : 0, text: policyText(o), vat: o.vat, center: o.center, condition: o.condition, rounding: ROUNDING_RULE },
    calendar: { startDate: plan.startDate || null, mode: plan.startDate ? "fecha" : "relativa", refDate: o.refDate },
    patient: pt ? { weight: pt.weight, height: pt.height, sc: pt.sc, scSource: pt.scSource } : null,
    administrations: admins,
    byCycle: group((a) => ({ key: `${a.phaseId}|${a.cycle}`, phase: a.phase, cycle: a.cycle })),
    byPhase: group((a) => ({ key: a.phaseId, phase: a.phase })),
    total: { cents: sum(ok), incomplete, partial: incomplete, admins: admins.length, pricedAdmins: ok.length, pendingLines: [...pendingLines.values()], blockers: planBlockers },
    warnings,
  };
}
const lineLabel = (ln) => (ln.components || []).map((c) => c.nameLiteral).join(" + ") || `Línea ${ln.order || ""}`;

function costAdmin({ S, comp, pt, o, allPres, vers, priceDate }) {
  const bad = (reason, extra = {}) => ({ status: "incompleto", cents: null, reasons: [reason], doseMg: null, items: [], ...extra });
  if (!comp.ingredientId) return bad("SIN_INGREDIENTE");
  if (!(comp.doseValue > 0)) return bad("DOSIS_NO_RESUELTA");
  let dose;
  if (comp.basis === "fixed") dose = comp.doseValue;
  else if (comp.basis === "mgm2" || comp.basis === "mgkg") {
    if (!pt || pt.errors.length || !(pt.sc > 0)) return bad("SIN_PACIENTE");
    dose = doseMg({ basis: comp.basis, dose: comp.doseValue }, pt, 0);
  } else return bad("UNIDAD_NO_SOPORTADA");
  const mine = allPres.filter((p) => (p.ingredientIds || []).includes(comp.ingredientId) && !p.archived);
  if (!mine.length) return bad("SIN_PRESENTACION", { doseMg: dose });
  const conv = mine.filter((p) => p.conversion && p.conversion.mgPerUnit > 0);
  if (!conv.length) return bad("SIN_EQUIVALENCIA", { doseMg: dose });
  const priced = [], warns = [];
  for (const p of conv) {
    const v = resolvePrice(vers(p.id), priceDate, { center: o.center, condition: o.condition });
    if (!v) continue;
    const up = unitPrice(v, { vat: o.vat });
    if (up.error) { warns.push(up.error); continue; }
    priced.push({ p, v, units: up.units, w: up.warnings });
  }
  if (!priced.length) return warns.length ? bad("IVA_NO_RESUELTO", { doseMg: dose, notes: warns }) : bad("SIN_PRECIO", { doseMg: dose });
  const pres = priced.map((x) => ({ id: x.p.id, label: x.p.label, mg: x.p.conversion.mgPerUnit, price: x.units / UNITS_PER_EUR, oral: !!x.p.oral, ref: x }));
  const cov = cover(dose, pres);
  if (!cov) return bad("SIN_PRECIO", { doseMg: dose });
  const fullUnits = cov.items.reduce((s, i) => s + i.n * i.pres.ref.units, 0);
  const parenteral = cov.items.some((i) => !i.pres.oral);
  let units = fullUnits;
  if (o.policy === "aprovechamiento" && parenteral && o.reuse > 0) {
    const theor = Math.round((fullUnits * dose) / cov.mgSupplied);
    units = theor + Math.round((fullUnits - theor) * (1 - o.reuse));
  }
  const notes = [...new Set(cov.items.flatMap((i) => i.pres.ref.w))];
  if (cov.items.some((i) => !(i.pres.ref.p.conversion.verified))) notes.push("Equivalencia mg por envase sin comprobar en alguna presentación.");
  return {
    status: "ok", reasons: [], doseMg: dose, cents: unitsToCents(units), unitsExact: units, mgSupplied: cov.mgSupplied, waste: cov.mgSupplied - dose, notes,
    items: cov.items.map((i) => ({ presId: i.pres.id, label: i.pres.label, n: i.n, unitPriceUnits: i.pres.ref.units, priceVersionId: i.pres.ref.v.id, priceSource: i.pres.ref.v.source, priceFrom: i.pres.ref.v.from, priceTo: i.pres.ref.v.to || null, condition: i.pres.ref.v.condition || DEFAULT_CONDITION })),
  };
}

// Coste de un periodo de calendario [from,to] sobre una estimación con fechas. Incompleto si hay administraciones sin importe en el periodo.
export function costInPeriod(est, from, to) {
  const sel = est.administrations.filter((a) => a.date && a.date >= from && a.date <= to);
  return { cents: sel.filter((a) => a.status === "ok").reduce((s, a) => s + a.cents, 0), admins: sel.length, incomplete: sel.some((a) => a.status !== "ok"), dated: est.calendar.mode === "fecha" };
}
