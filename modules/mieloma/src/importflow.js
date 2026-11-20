// Flujo «Subir PDF → Revisar planificación → Confirmar». Puro: devuelve «parches» de estado que la interfaz aplica en UNA sola operación.
// Privacidad: no se guarda el PDF, su nombre ni su texto; solo el hash (para detectar reimportaciones) y los campos estructurados necesarios.
// Las observaciones libres del documento no se persisten (solo indicadores derivados).
import { matchIngredient, confirmAlias, normalizeName, ensureRef } from "./refcatalog.js";
import { estimatePlan } from "./estimate.js";
import { PARSER_VERSION } from "./oncofar.js";
import { addDays } from "./engine.js";

export class ImportError extends Error { constructor(msg, code, extra) { super(msg); this.code = code; this.extra = extra; } }
const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + "T00:00:00Z"));
const F = (value, literal = "", page = null, status) => ({ value, literal, page, status: status || (value == null || value === "" ? "sin_resolver" : "extraido") });
const isConfirmed = (f) => f && (f.status === "confirmado" || f.status === "corregido");

/* ---------- Construcción del borrador ---------- */
export function buildDraft({ parsed, hash, context = "", user = null, now = new Date().toISOString(), S, revisionOf = null, revision = 1, startDate = null }) {
  const phases = parsed.phases.map((p) => ({
    id: p.id, name: p.name, interval: p.interval, cycles: p.cycles, horizonCycles: null, cyclesMode: null, reviewed: false, page: p.page,
    lines: p.lines.map((l) => ({
      id: l.id, order: l.order, page: l.page, pages: l.pages, type: l.type, category: l.category, categoryExplicit: l.categoryExplicit, categoryHint: l.categoryHint, included: l.included,
      route: l.route, days: l.days, adminMinutes: l.adminMinutes, adminLiteral: l.adminLiteral, obsFlags: l.obsFlags, reviewed: false,
      components: l.components.map((c) => {
        const m = c.role === "diluyente" ? { status: "diluyente", options: [] } : matchIngredient(S, c.nameLiteral);
        const auto = m.options.length === 1 && ["nombre", "alias", "id"].includes(m.status) ? m.options[0].id : null;
        return { ...c, ingredientId: auto, match: { status: m.status, options: m.options.map((o) => ({ id: o.id, name: o.name })) }, saveAlias: false };
      }),
    })),
  }));
  return {
    id: uid("DR-"), status: "borrador", hash: hash || null, context, revision, revisionOf, createdAt: now, createdBy: user, parserVersion: PARSER_VERSION, manual: false,
    name: parsed.header.name, startDate, cycleHint: parsed.header.cycleHint || null, phases, warnings: parsed.warnings || [], pageCount: parsed.pageCount || null,
  };
}
// Borrador vacío para completar a mano (PDF escaneado, diseño no reconocido, etc.)
export function manualDraft({ hash = null, context = "", user = null, now = new Date().toISOString(), reason = "", revisionOf = null, revision = 1 } = {}) {
  return {
    id: uid("DR-"), status: "borrador", hash, context, revision, revisionOf, createdAt: now, createdBy: user, parserVersion: PARSER_VERSION, manual: true, manualReason: reason, name: F(null), startDate: null, cycleHint: null,
    phases: [{ id: "F1", name: "Esquema", interval: F(null), cycles: F(null), horizonCycles: null, cyclesMode: null, reviewed: false, page: null, lines: [] }], warnings: reason ? [reason] : [], pageCount: null,
  };
}

/* ---------- Reimportación ---------- */
// ¿Existe ya este mismo fichero (hash) en este contexto?
export function findExisting(S, hash, context = "") {
  if (!hash) return { drafts: [], plans: [] };
  return { drafts: (S.importDrafts || []).filter((d) => d.hash === hash && d.context === context), plans: (S.importedPlans || []).filter((p) => p.hash === hash && p.context === context) };
}
export function chainOf(S, plan) {
  const all = S.importedPlans || []; const root = (p) => { let c = p; const seen = new Set(); while (c && c.revisionOf && !seen.has(c.id)) { seen.add(c.id); c = all.find((x) => x.id === c.revisionOf); } return c ? c.id : p.id; };
  const r = root(plan); return all.filter((p) => root(p) === r);
}
// Planes vigentes: la revisión más alta de cada cadena. Las anteriores se conservan sin tocarse.
export function currentPlans(S) { const all = S.importedPlans || []; return all.filter((p) => chainOf(S, p).every((o) => o.revision <= p.revision)); }
export function nextRevision(S, plan) { return Math.max(...chainOf(S, plan).map((p) => p.revision)) + 1; }

// Copia un plan confirmado a un borrador editable (revisión explícita). No modifica el plan original.
export function reviseFromPlan(S, planId, { user, now = new Date().toISOString() } = {}) {
  const plan = (S.importedPlans || []).find((p) => p.id === planId); if (!plan) throw new ImportError("Plan no encontrado.", "no_encontrado");
  const copy = JSON.parse(JSON.stringify(plan));
  return {
    id: uid("DR-"), status: "borrador", hash: plan.hash, context: plan.context, revision: nextRevision(S, plan), revisionOf: plan.id, createdAt: now, createdBy: user || null, parserVersion: plan.parserVersion, manual: false,
    name: F(copy.name, copy.name, null, "extraido"), startDate: copy.startDate, cycleHint: null, warnings: ["Revisión de un plan ya confirmado: vuelve a confirmar los datos que afecten al calendario o al coste."], pageCount: null,
    phases: copy.phases.map((p) => ({ id: p.id, name: p.name, interval: F(p.interval, String(p.interval ?? ""), null), cycles: F(p.cycles, String(p.cycles ?? ""), null), horizonCycles: p.horizonCycles ?? null, cyclesMode: p.cyclesMode || null, reviewed: false, page: null,
      lines: p.lines.map((l) => ({ id: l.id, order: l.order, page: l.page, pages: [l.page], type: F(l.typeLiteral, l.typeLiteral), category: l.category, categoryExplicit: l.categoryExplicit, categoryHint: "", included: l.included, route: F(l.route, l.route || ""), days: F(l.days, (l.days || []).join(",")), adminMinutes: l.adminMinutes, adminLiteral: "", obsFlags: {}, reviewed: false,
        components: l.components.map((c) => ({ ...c, match: { status: c.ingredientId ? "id" : "ninguna", options: [] }, saveAlias: false })) })) })),
  };
}

/* ---------- Revisión: qué impide confirmar ---------- */
export function reviewIssues(d) {
  const I = []; const add = (severity, code, text, where) => I.push({ severity, code, text, where });
  if (!d.name || !d.name.value || !String(d.name.value).trim()) add("bloqueante", "NOMBRE", "Falta el nombre del esquema.", "name");
  if (d.startDate && !isDate(d.startDate)) add("bloqueante", "FECHA", "La fecha inicial no es válida.", "startDate");
  if (!d.startDate) add("aviso", "SIN_FECHA", "Sin fecha inicial: el plan se conserva como pauta relativa (días de ciclo) y no se generan fechas de calendario.", "startDate");
  if (!d.phases.length || !d.phases.some((p) => p.lines.length)) add("bloqueante", "SIN_LINEAS", "No hay líneas de administración. Añade al menos una.", "phases");
  d.phases.forEach((p) => {
    const w = `fase:${p.id}`;
    const cyc = p.cycles && p.cycles.value;
    if (cyc != null) { if (!isConfirmed(p.cycles) && !p.reviewed) add("bloqueante", "CICLOS_SIN_CONFIRMAR", `Fase «${p.name}»: confirma el número de ciclos (${cyc}).`, w); }
    else if (!(Number.isInteger(p.horizonCycles) && p.horizonCycles >= 1) && p.cyclesMode !== "tramo") add("bloqueante", "CICLOS_SIN_RESOLVER", `Fase «${p.name}»: el documento no indica el número de ciclos. Indica el horizonte de proyección o elige trabajar solo con el tramo documentado.`, w);
    const effCycles = cyc != null ? cyc : p.horizonCycles || 1;
    if (effCycles > 1) {
      if (!(p.interval && p.interval.value > 0)) add("bloqueante", "INTERVALO_SIN_RESOLVER", `Fase «${p.name}»: falta el intervalo entre ciclos (necesario con ${effCycles} ciclos).`, w);
      else if (!isConfirmed(p.interval) && !p.reviewed) add("bloqueante", "INTERVALO_SIN_CONFIRMAR", `Fase «${p.name}»: confirma el intervalo entre ciclos (${p.interval.value} días).`, w);
    }
    p.lines.forEach((l) => {
      const lw = `linea:${p.id}:${l.id}`, tag = `Fase «${p.name}», fila ${l.order}`;
      if (l.category === "ambiguo" && l.included == null) add("bloqueante", "FILA_AMBIGUA", `${tag}: el documento no la clasifica. Decide si se incluye en la estimación.`, lw);
      if (!l.included) return;
      if (!(l.days && l.days.value && l.days.value.length)) add("bloqueante", "DIAS_SIN_RESOLVER", `${tag}: faltan los días de administración.`, lw);
      if (!l.reviewed) add("bloqueante", "LINEA_SIN_CONFIRMAR", `${tag}: confirma días, dosis y correspondencia con el catálogo.`, lw);
      l.components.filter((c) => c.role !== "diluyente").forEach((c) => {
        if (!(c.doseValue > 0) || !["fixed", "mgm2", "mgkg"].includes(c.basis)) add("bloqueante", "DOSIS_SIN_RESOLVER", `${tag}: dosis de ${c.nameLiteral} sin resolver o en una unidad no convertible a mg («${c.doseLiteral || "vacía"}»).`, lw);
        if (!c.ingredientId) add("bloqueante", "SIN_CORRESPONDENCIA", `${tag}: ${c.nameLiteral} no está vinculado a un principio activo del catálogo.`, lw);
      });
    });
  });
  (d.warnings || []).forEach((t) => add("aviso", "EXTRACCION", t, "warnings"));
  return I;
}
export const blockers = (d) => reviewIssues(d).filter((i) => i.severity === "bloqueante");

/* ---------- Edición con trazabilidad (reinicia la confirmación de lo editado) ---------- */
export function setField(f, value) { return { ...f, value, status: value == null || value === "" ? "sin_resolver" : "corregido" }; }

/* ---------- Confirmación atómica ---------- */
function planFromDraft(d, { now, user }) {
  return {
    id: uid("PLI-"), kind: "importado", status: "confirmado", hash: d.hash, context: d.context, revision: d.revision, revisionOf: d.revisionOf, name: String(d.name.value).trim(), startDate: d.startDate || null,
    confirmedAt: now, confirmedBy: user || null, parserVersion: d.parserVersion, manual: !!d.manual,
    phases: d.phases.filter((p) => p.lines.length).map((p) => ({
      id: p.id, name: p.name, interval: p.interval && p.interval.value > 0 ? p.interval.value : null, cycles: p.cycles && p.cycles.value != null ? p.cycles.value : null, horizonCycles: p.horizonCycles || null, cyclesMode: p.cyclesMode || null,
      lines: p.lines.map((l) => ({
        id: l.id, order: l.order, page: l.page, typeLiteral: l.type ? l.type.literal || l.type.value || "" : "", category: l.category, categoryExplicit: !!l.categoryExplicit, included: l.included === true,
        route: l.route && l.route.value, days: (l.days && l.days.value) || [], adminMinutes: l.adminMinutes == null ? null : l.adminMinutes,
        components: l.components.map((c) => ({ id: c.id, nameLiteral: c.nameLiteral, doseLiteral: c.doseLiteral, doseValue: c.doseValue, unit: c.unit, basis: c.basis, role: c.role, ingredientId: c.ingredientId || null, page: c.page })),
      })),
    })),
  };
}

export const previewPlan = (d) => planFromDraft(d, { now: "", user: null });

// opts de estimación: { patient, policy, reuse, vat, center, condition, refDate }
// Devuelve { patch, plan, estimate } o lanza ImportError. El patch se aplica con un único set().
export function confirmDraft(S, draftId, { user = null, now = new Date().toISOString(), est = {} } = {}) {
  const d = (S.importDrafts || []).find((x) => x.id === draftId);
  if (!d) throw new ImportError("El borrador ya no existe (¿ya se confirmó?).", "no_encontrado");
  const b = blockers(d);
  if (b.length) throw new ImportError(`Faltan ${b.length} dato(s) por resolver o confirmar.`, "bloqueado", { issues: b });
  const dup = (S.importedPlans || []).find((p) => d.hash && p.hash === d.hash && p.context === d.context && p.revision === d.revision);
  if (dup) throw new ImportError("Ya existe un plan confirmado de este fichero en este contexto con la misma revisión. Crea una revisión explícita.", "duplicado", { existing: dup.id });
  const plan = planFromDraft(d, { now, user });
  // alias confirmados por el usuario (solo con confirmación explícita en el borrador)
  let ref = ensureRef(S.ref);
  for (const p of d.phases) for (const l of p.lines) for (const c of l.components) if (c.saveAlias && c.ingredientId && c.role !== "diluyente" && normalizeName(c.nameLiteral)) { try { ref = confirmAlias(ref, c.nameLiteral, c.ingredientId, { user, now }); } catch (e) { /* alias ya vinculado a otro: se conserva el existente */ } }
  const S2 = { ...S, ref, importedPlans: [...(S.importedPlans || []), plan] };
  const estimate = estimatePlan(S2, plan, { ...est, user, now });
  const log = [{ ts: Date.now(), what: `Plan importado confirmado: «${plan.name}» (revisión ${plan.revision})`, by: user || null }, ...(S.log || [])].slice(0, 100);
  return { plan, estimate, patch: { ref, importedPlans: S2.importedPlans, importDrafts: (S.importDrafts || []).filter((x) => x.id !== d.id), estimates: [...(S.estimates || []), estimate], log } };
}

// Nueva estimación (recalculada) de un plan ya confirmado. No modifica el plan ni las estimaciones anteriores.
export function reestimate(S, planId, { user = null, now = new Date().toISOString(), est = {} } = {}) {
  const plan = (S.importedPlans || []).find((p) => p.id === planId); if (!plan) throw new ImportError("Plan no encontrado.", "no_encontrado");
  const estimate = estimatePlan(S, plan, { ...est, user, now });
  return { estimate, patch: { estimates: [...(S.estimates || []), estimate], log: [{ ts: Date.now(), what: `Nueva estimación del plan «${plan.name}»`, by: user || null }, ...(S.log || [])].slice(0, 100) } };
}

// Fechas de calendario de un plan (solo con fecha inicial explícita). Útil para mostrar por fase, ciclo y día.
export function planCalendar(plan) {
  const out = []; let offset = 0;
  for (const ph of plan.phases) {
    const cycles = ph.cycles != null ? ph.cycles : ph.horizonCycles != null ? ph.horizonCycles : 1;
    const len = ph.interval || 0, nc = cycles > 1 && !len ? 1 : cycles;
    for (let c = 1; c <= nc; c++) for (const ln of ph.lines) { if (!ln.included) continue; for (const d of ln.days) out.push({ phase: ph.name, phaseId: ph.id, cycle: c, day: d, lineId: ln.id, dayAbs: offset + (c - 1) * len + (d - 1), date: plan.startDate ? addDays(plan.startDate, offset + (c - 1) * len + (d - 1)) : null, drugs: ln.components.filter((x) => x.role !== "diluyente").map((x) => x.nameLiteral) }); }
    offset += nc * len;
  }
  return out.sort((a, b) => a.dayAbs - b.dayAbs);
}
