import test from "node:test";
import assert from "node:assert/strict";
import { estimatePlan, costInPeriod } from "../src/estimate.js";
import { addPriceVersion } from "../src/pricing.js";
import { emptyRef, addIngredient, addMedicine, addPresentation } from "../src/refcatalog.js";
import { CATALOG_INITIAL } from "../src/data.js";

const mkState = () => ({ catalog: JSON.parse(JSON.stringify(CATALOG_INITIAL)), ref: emptyRef(), priceVersions: [] });
const comp = (id, name, ingredientId, doseValue, basis = "fixed", extra = {}) => ({ id, nameLiteral: name, ingredientId, doseValue, basis, unit: "mg", role: "farmaco", ...extra });
const line = (id, comps, days = [1], extra = {}) => ({ id, order: 1, category: "principal", included: true, days, components: comps, ...extra });
const plan = (phases, extra = {}) => ({ id: "PLAN1", startDate: "2026-11-01", phases, ...extra });
const phase = (id, lines, extra = {}) => ({ id, name: id, interval: 21, cycles: 2, lines, ...extra });
const PAT = { weight: 80, height: 1.75, scMethod: "mosteller", scOverride: 0 };

test("cambio de precio entre dos ciclos: cada ciclo usa su vigencia; la estimación anterior se conserva; el total parcial señala la línea sin precio", () => {
  let S = mkState();
  const p = plan([phase("F1", [
    line("L1", [comp("c1", "BORTEZOMIB", "legacy:bort", 3.5)]),
    line("L2", [comp("c2", "GLOFITAMAB", null, 30)]),               // sin correspondencia en catálogo
  ])]);
  const est1 = estimatePlan(S, p, { now: "2026-11-01T08:00:00Z", refDate: "2026-11-01" });
  // Bortezomib 3,5 mg vial a 15,49 € (precio heredado), dos ciclos
  const b = est1.administrations.filter((a) => a.label === "BORTEZOMIB");
  assert.deepEqual(b.map((a) => a.date), ["2026-11-01", "2026-11-22"]);
  assert.deepEqual(b.map((a) => a.cents), [1549, 1549]);
  assert.equal(est1.total.cents, 3098);
  assert.equal(est1.total.incomplete, true, "falta una línea: el total es parcial");
  assert.equal(est1.total.pendingLines.length, 1);
  assert.equal(est1.total.pendingLines[0].label, "GLOFITAMAB");
  assert.deepEqual(est1.total.pendingLines[0].reasons, ["SIN_INGREDIENTE"]);
  const gl = est1.administrations.filter((a) => a.label === "GLOFITAMAB");
  assert.ok(gl.every((a) => a.cents === null && a.status === "incompleto"), "una línea sin datos nunca aparece como 0 €");
  const est1Json = JSON.stringify(est1);

  // el 22/11 sube el precio: añade versión (cierra la vigente el 21/11)
  const r = addPriceVersion(S, { presId: "C03", price: 20, purchaseUnit: "vial", contentPerUnit: 1, vat: { mode: "sin_iva" }, source: "Resolución X", from: "2026-11-22" }, { closePrevious: true });
  S = { ...S, ...r };
  const est2 = estimatePlan(S, p, { now: "2026-11-23T08:00:00Z", refDate: "2026-11-23" });
  const b2 = est2.administrations.filter((a) => a.label === "BORTEZOMIB");
  assert.deepEqual(b2.map((a) => a.cents), [1549, 2000], "ciclo 1 con la vigencia antigua, ciclo 2 con la nueva");
  assert.equal(b2[1].items[0].priceSource, "Resolución X");
  assert.notEqual(est2.id, est1.id);
  assert.equal(JSON.stringify(est1), est1Json, "la estimación anterior no cambia");
  assert.equal(est1.administrations[0].items[0].unitPriceUnits, 154900, "conserva el precio aplicado");
  // periodo
  assert.equal(costInPeriod(est2, "2026-11-20", "2026-11-30").cents, 2000);
  assert.equal(costInPeriod(est2, "2026-11-01", "2026-11-30").incomplete, true);
});

test("dosis por superficie corporal y envases completos con regla explícita; sin paciente → incompleto, no 0 €", () => {
  let S = mkState();
  let r = addIngredient(S.ref, { name: "Gemcitabina" }); S = { ...S, ref: r.ref }; const gem = r.ingredient;
  const m = addMedicine(S.ref, { name: "Gemcitabina X", ingredients: [{ ingredientId: gem.id }] }); S = { ...S, ref: m.ref };
  for (const [label, mg, price] of [["Gemcitabina 1000 mg vial", 1000, 50], ["Gemcitabina 200 mg vial", 200, 12]]) {
    const pr = addPresentation(S.ref, { medicineId: m.medicine.id, label, conversion: { mgPerUnit: mg, basis: "manual", verified: true } }); S = { ...S, ref: pr.ref };
    const id = pr.presentation.id;
    S = { ...S, ...addPriceVersion(S, { presId: id, price, purchaseUnit: "vial", contentPerUnit: 1, vat: { mode: "sin_iva" }, source: "Test", from: "2026-01-01" }) };
  }
  const p = plan([phase("F1", [line("L1", [comp("c1", "GEMCITABINA", gem.id, 1000, "mgm2")])], { cycles: 1 })]);
  const est = estimatePlan(S, p, { patient: PAT });
  const a = est.administrations[0];
  // SC Mosteller 80 kg, 175 cm = 1,972 m² → 1972 mg → 2×1000 (100,00 €) vs 1×1000+5×200 (110,00 €)
  assert.ok(Math.abs(a.doseMg - 1972.0) < 1);
  assert.equal(a.cents, 10000);
  assert.equal(a.items[0].n, 2);
  assert.match(est.rule.text, /sin aprovechamiento/);
  // aprovechamiento explícito del 50 % del sobrante
  const eff = estimatePlan(S, p, { patient: PAT, policy: "aprovechamiento", reuse: 0.5 });
  assert.ok(eff.administrations[0].cents < 10000 && eff.administrations[0].cents > 9000);
  assert.match(eff.rule.text, /50 %/);
  // sin datos de paciente
  const sin = estimatePlan(S, p, {});
  assert.equal(sin.administrations[0].status, "incompleto");
  assert.deepEqual(sin.administrations[0].reasons, ["SIN_PACIENTE"]);
  assert.equal(sin.total.cents, 0); assert.equal(sin.total.incomplete, true);
});

test("presentación sin equivalencia, sin precio en la fecha, IVA y líneas ambiguas o diluyentes", () => {
  let S = mkState();
  const g = addIngredient(S.ref, { name: "Ingrediente Z" }); S = { ...S, ref: g.ref };
  const m = addMedicine(S.ref, { name: "Z", ingredients: [{ ingredientId: g.ingredient.id }] }); S = { ...S, ref: m.ref };
  const pr = addPresentation(S.ref, { medicineId: m.medicine.id, label: "Z vial" }); S = { ...S, ref: pr.ref };
  const p = plan([phase("F1", [
    line("L1", [comp("c1", "Z", g.ingredient.id, 10)]),
    line("L2", [comp("c2", "CLORURO SODICO 0.9 %", null, 50, "volume", { role: "diluyente", unit: "ml" })]),
    line("L3", [comp("c3", "ONDANSETRON", "legacy:bort", 16)], [1], { category: "ambiguo", included: null }),
  ], { cycles: 1 })]);
  let est = estimatePlan(S, p, {});
  assert.deepEqual(est.administrations.map((a) => a.reasons[0]), ["SIN_EQUIVALENCIA"]);
  assert.ok(!est.administrations.some((a) => /CLORURO/.test(a.label)), "el diluyente no se costea");
  assert.ok(est.total.pendingLines.some((l) => l.reasons.includes("LINEA_POR_REVISAR")), "la fila ambigua queda pendiente, no incluida en silencio");
  // con equivalencia pero precio que empieza después de la administración
  S = { ...S, ref: { ...S.ref, presentations: S.ref.presentations.map((x) => ({ ...x, conversion: { mgPerUnit: 10, verified: true, basis: "manual" } })) } };
  S = { ...S, ...addPriceVersion(S, { presId: pr.presentation.id, price: 110, purchaseUnit: "vial", contentPerUnit: 1, vat: { mode: "iva_incluido", rate: 0.1 }, source: "T", from: "2026-12-01" }) };
  est = estimatePlan(S, p, {});
  assert.deepEqual(est.administrations[0].reasons, ["SIN_PRECIO"]);
  S = { ...S, priceVersions: S.priceVersions.map((v) => ({ ...v, from: "2026-01-01" })) };
  est = estimatePlan(S, p, {});
  assert.equal(est.administrations[0].cents, 10000, "110 € con IVA 10 % incluido → 100,00 € sin IVA");
  est = estimatePlan(S, p, { vat: "con_iva" });
  assert.equal(est.administrations[0].cents, 11000);
});

test("sin fecha inicial no hay calendario: precios a fecha de cálculo y aviso; ciclos o intervalo ausentes se marcan", () => {
  const S = mkState();
  const p = plan([phase("F1", [line("L1", [comp("c1", "BORTEZOMIB", "legacy:bort", 3.5)], [1, 8])], { cycles: null, interval: null })], { startDate: null });
  const est = estimatePlan(S, p, { refDate: "2026-11-20" });
  assert.ok(est.administrations.every((a) => a.date === null && a.priceDate === "2026-11-20"));
  assert.equal(est.calendar.mode, "relativa");
  assert.equal(est.administrations.length, 2, "solo el tramo documentado (1 ciclo)");
  assert.ok(est.warnings.some((w) => w.code === "CICLOS_NO_DEFINIDOS") && est.warnings.some((w) => w.code === "SIN_FECHA_INICIAL"));
  assert.equal(est.total.incomplete, true);
  // con horizonte indicado por el usuario pero sin intervalo, no inventa el calendario
  const est2 = estimatePlan(S, plan([phase("F1", [line("L1", [comp("c1", "BORTEZOMIB", "legacy:bort", 3.5)])], { cycles: null, horizonCycles: 6, interval: null })]), {});
  assert.equal(est2.administrations.length, 1);
  assert.ok(est2.warnings.some((w) => w.code === "INTERVALO_NO_DEFINIDO"));
});

test("dos fases: la segunda empieza al terminar la primera", () => {
  const S = mkState();
  const p = plan([
    phase("IND", [line("L1", [comp("c1", "BORTEZOMIB", "legacy:bort", 3.5)], [1])], { cycles: 2, interval: 21 }),
    phase("MANT", [line("L2", [comp("c2", "BORTEZOMIB", "legacy:bort", 3.5)], [1])], { cycles: 2, interval: 28 }),
  ]);
  const est = estimatePlan(S, p, {});
  assert.deepEqual(est.administrations.map((a) => a.date), ["2026-11-01", "2026-11-22", "2026-12-13", "2027-01-10"]);
  assert.equal(est.byPhase.length, 2);
});
