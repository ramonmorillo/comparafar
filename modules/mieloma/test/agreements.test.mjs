import test from "node:test";
import assert from "node:assert/strict";
import { saveAgreement, evaluateAgreements, validateAgreement, AgreementError, spendItems, overlapping, periodOf } from "../src/agreements.js";
import { commercialAccess } from "../src/access.js";
import { emptyRef } from "../src/refcatalog.js";
import { CATALOG_INITIAL, SCHEMES_ALL, PATIENTS_DEMO } from "../src/data.js";
import { addDays } from "../src/engine.js";

const ASOF = "2026-10-31";
const base = (o = {}) => ({ type: "techo", title: "Techo daratumumab 2026", scope: { level: "principio_activo", targetId: "legacy:bort" }, period: { kind: "natural", year: 2026 }, effective: { from: "2026-01-01", to: null }, source: "Contrato 14/2026", owner: "Jefa de Servicio", threshold: { amountCents: 100000 }, ...o });
const items = (cents, kind = "realizado", date = "2026-06-01", ing = "legacy:bort") => ({ date, cents, ingredientIds: [ing], medicineIds: [], presIds: [], kind, origin: "agenda" });
const S0 = (ags = [], extra = {}) => ({ catalog: CATALOG_INITIAL, ref: emptyRef(), plans: [], patients: [], agreements: ags, spendEntries: [], ...extra });

test("registro: validación, histórico de cambios con responsable y ejercicio natural o fechas propias", () => {
  assert.throws(() => saveAgreement([], base({ threshold: null })), AgreementError);
  assert.ok(validateAgreement(base({ source: "" })).some((m) => /fuente/i.test(m)));
  assert.ok(validateAgreement(base({ period: { kind: "custom", from: "2026-07-01", to: "2026-01-01" } })).some((m) => /cierre/i.test(m)));
  let l = saveAgreement([], base(), { user: "ana@h.es", now: "2026-01-02T00:00:00Z" });
  assert.equal(l[0].version, 1); assert.equal(l[0].createdBy, "ana@h.es");
  l = saveAgreement(l, { ...l[0], threshold: { amountCents: 120000 } }, { user: "luis@h.es", now: "2026-03-01T00:00:00Z" });
  assert.equal(l[0].version, 2); assert.equal(l[0].history.length, 1);
  assert.equal(l[0].history[0].threshold.amountCents, 100000, "se conserva la versión anterior");
  assert.equal(l[0].modifiedBy, "luis@h.es");
  assert.deepEqual(periodOf({ period: { kind: "custom", from: "2026-07-01", to: "2027-06-30" } }), { from: "2026-07-01", to: "2027-06-30" });
});

test("techo anual superado: gasto computable, porcentaje, exceso y señal; proyección con fecha de corte y base", () => {
  const S = saveAgreementState(base());
  const ev = evaluateAgreements(S, { items: [items(80000), items(30000, "realizado", "2026-08-01"), items(25000, "proyectado", "2026-11-15"), items(25000, "proyectado", "2027-02-01"), items(9999, "sin_registro", "2026-09-01")], asOf: ASOF })[0];
  assert.equal(ev.realized.cents, 110000);
  assert.equal(ev.realized.source, "agenda");
  assert.equal(ev.threshold, 100000);
  assert.equal(ev.exceeded, true); assert.equal(ev.excess, 10000);
  assert.ok(ev.pct > 1.09 && ev.pct < 1.11);
  assert.ok(ev.signals.some((s) => s.code === "TECHO_SUPERADO"));
  assert.equal(ev.projected.cents, 25000, "solo lo planificado dentro del periodo y después del corte");
  assert.equal(ev.projected.cutDate, ASOF);
  assert.match(ev.projected.basis, /no es gasto realizado/);
  assert.equal(ev.projectedClose, 135000);
  assert.ok(ev.incidents.some((i) => i.code === "SIN_REGISTRO"), "lo vencido sin registrar no computa como gasto");
});

test("sin fuente de gasto realizado: pendiente (no 0 €); acumulado fechado contable lo sustituye y suma lo posterior", () => {
  const S = saveAgreementState(base());
  const sin = evaluateAgreements(S, { items: [items(500, "proyectado", "2026-11-15")], asOf: ASOF })[0];
  assert.equal(sin.realized.cents, null); assert.equal(sin.realized.source, "pendiente");
  assert.equal(sin.exceeded, undefined); assert.equal(sin.projectedClose, null);
  const S2 = { ...S, spendEntries: [{ id: "E1", kind: "realizado", scope: { level: "principio_activo", targetId: "legacy:bort" }, from: "2026-01-01", to: "2026-12-31", asOf: "2026-09-30", amountCents: 60000, source: "Informe contable octubre", by: "ana@h.es" }] };
  const ev = evaluateAgreements(S2, { items: [items(7000, "realizado", "2026-09-15"), items(5000, "realizado", "2026-10-10")], asOf: ASOF })[0];
  assert.equal(ev.realized.cents, 65000, "60 000 contable + 5 000 posterior; la de 15/09 ya está en el acumulado (sin doble cómputo)");
  assert.equal(ev.realized.source, "contabilidad");
  assert.equal(ev.remaining, 35000);
});

test("dos acuerdos coincidentes sin orden definido: incidencia y ajuste pendiente; con orden y base, cálculo secuencial", () => {
  const techo = base();
  const dto = base({ type: "descuento", title: "Descuento 10 %", threshold: null, formula: { kind: "pct", pct: 0.1 }, settlement: "Nota de abono trimestral", scope: { level: "principio_activo", targetId: "legacy:bort" } });
  const vol = base({ type: "volumen", title: "Volumen por tramos", threshold: null, formula: { kind: "tramos", tiers: [{ from: 0, to: 50000, pct: 0 }, { from: 50000, to: null, pct: 0.2 }] }, settlement: "Rappel anual" });
  let S = S0([]); [techo, dto, vol].forEach((a) => { S = { ...S, agreements: saveAgreement(S.agreements, a) }; });
  const evs = evaluateAgreements(S, { items: [items(110000)], asOf: ASOF });
  const byTitle = Object.fromEntries(evs.map((e) => [e.title, e]));
  assert.equal(byTitle["Techo daratumumab 2026"].excess, 10000, "el exceso del techo se muestra igualmente");
  for (const t of ["Descuento 10 %", "Volumen por tramos"]) {
    assert.equal(byTitle[t].adjustment.status, "pendiente", t);
    assert.equal(byTitle[t].adjustment.cents, null);
    assert.ok(byTitle[t].incidents.some((i) => i.code === "ACUERDOS_COINCIDENTES"));
  }
  // ahora con orden y base definidos
  S = { ...S, agreements: S.agreements.map((a) => (a.type === "descuento" ? { ...a, order: 1, base: "bruto" } : a.type === "volumen" ? { ...a, order: 2, base: "neto" } : a)) };
  const ev2 = Object.fromEntries(evaluateAgreements(S, { items: [items(110000)], asOf: ASOF }).map((e) => [e.title, e]));
  assert.equal(ev2["Descuento 10 %"].adjustment.cents, 11000);
  assert.equal(ev2["Volumen por tramos"].adjustment.cents, Math.round((110000 - 11000 - 50000) * 0.2), "tramo sobre base neta (bruto − descuento previo)");
  assert.equal(ev2["Volumen por tramos"].adjustment.status, "calculado");
});

test("un acuerdo aislado con fórmula calcula; sin fórmula o sin gasto queda pendiente; ajustes registrados van aparte", () => {
  let S = S0([]); S = { ...S, agreements: saveAgreement([], base({ type: "devolucion", title: "Devolución", threshold: { amountCents: 100000 }, formula: { kind: "fijo", amountCents: 5000, when: "techo_superado" }, settlement: "Abono" })) };
  S.spendEntries = [{ id: "A1", kind: "devolucion", agreementId: S.agreements[0].id, amountCents: 4000, asOf: "2026-10-01", source: "Abono 33", by: "ana@h.es" }];
  const ev = evaluateAgreements(S, { items: [items(120000)], asOf: ASOF })[0];
  assert.equal(ev.adjustment.cents, 5000); assert.equal(ev.registeredAdjustments.cents, 4000);
  assert.notEqual(ev.adjustment.cents, ev.registeredAdjustments.cents, "calculado ≠ efectivamente registrado");
  const sinF = evaluateAgreements({ ...S, agreements: [{ ...S.agreements[0], formula: null }] }, { items: [items(120000)], asOf: ASOF })[0];
  assert.equal(sinF.adjustment.status, "pendiente");
  const sinG = evaluateAgreements(S, { items: [], asOf: ASOF })[0];
  assert.equal(sinG.adjustment.status, "pendiente");
});

test("alcance acotado por indicación/centro/población sin datos para delimitarlo: incidencia visible; jerarquía de alcance", () => {
  const S = saveAgreementState(base({ scope: { level: "principio_activo", targetId: "legacy:bort", indication: "Mieloma" } }));
  const ev = evaluateAgreements(S, { items: [items(1000)], asOf: ASOF })[0];
  assert.ok(ev.incidents.some((i) => i.code === "ALCANCE_NO_VERIFICABLE"));
  const med = { ...base(), id: "m", scope: { level: "medicamento", targetId: "MED-1" } }, ing = { ...base(), id: "i" };
  const S2 = { ...S0(), ref: { ...emptyRef(), ingredients: [], medicines: [{ id: "MED-1", name: "X", ingredients: [{ ingredientId: "legacy:bort" }] }], presentations: [], aliases: [] } };
  assert.equal(overlapping(S2, med, ing), true);
  assert.equal(overlapping(S2, med, { ...ing, scope: { level: "principio_activo", targetId: "legacy:carf" } }), false);
});

test("partidas de gasto desde la agenda heredada: administradas = realizado, futuras = proyectado, vencidas sin registro no computan", () => {
  const sch = SCHEMES_ALL.find((s) => s.id === "1C-DVRD-IV") || SCHEMES_ALL[0];
  const pat = PATIENTS_DEMO[1];
  const td = "2026-11-20";
  const plan = { id: "PL", patient: pat.code, schemeId: sch.id, maint: "none", start: addDays(td, -20), done: {} };
  const S = S0([], { plans: [plan], patients: PATIENTS_DEMO });
  let it = spendItems(S, SCHEMES_ALL, td);
  assert.ok(it.some((i) => i.kind === "proyectado") && it.some((i) => i.kind === "sin_registro"));
  assert.ok(!it.some((i) => i.kind === "realizado"));
  const first = it.find((i) => i.kind === "sin_registro");
  const S2 = { ...S, plans: [{ ...plan, done: { [plan.id + ":0"]: { status: "ok" } } }] };
  it = spendItems(S2, SCHEMES_ALL, td);
  assert.equal(it.filter((i) => i.kind === "realizado").length, 1);
  assert.ok(it.every((i) => Number.isInteger(i.cents)));
  assert.ok(first.cents > 0);
});

test("acceso a condiciones comerciales según rol y modo", () => {
  assert.equal(commercialAccess({ status: "ready", role: "lector" }).view, false);
  assert.equal(commercialAccess({ status: "ready", role: "editor" }).edit, true);
  assert.equal(commercialAccess({ status: "login" }).view, false);
  assert.equal(commercialAccess({ status: "local" }).view, true);
});

function saveAgreementState(a) { return S0(saveAgreement([], a)); }
