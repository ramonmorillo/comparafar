import test from "node:test";
import assert from "node:assert/strict";
import { bsa, validatePatient, resolvePatient, minCover, presentationsFor, adminCost, computeScheme, parseDays, daysToString, buildBsAbScheme, sensitivity, compareSchemes, validateScheme, DAYS_PER_MONTH } from "../src/engine.js";
import { CATALOG_INITIAL, SCHEMES_ALL, BSAB_PRESETS } from "../src/data.js";

const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const P88 = { weight: 88, height: 1.6, scMethod: "mosteller", scOverride: 0 };
const S = (id) => SCHEMES_ALL.find((s) => s.id === id);

test("SC Mosteller 88 kg / 1,60 m = 1,978 m² (no 1,83)", () => { near(bsa("mosteller", 88, 1.6), 1.9777, 0.0005); });
test("SC Du Bois y Haycock calculables y coherentes", () => { near(bsa("dubois", 88, 1.6), 1.91, 0.02); near(bsa("haycock", 88, 1.6), 2.0157, 0.002); });
test("Entradas no plausibles → sin cálculo", () => {
  assert.equal(bsa("mosteller", 0, 1.6), null); assert.equal(bsa("mosteller", -5, 1.6), null);
  assert.equal(bsa("mosteller", 88, 160), null); // talla en cm por error
  assert.ok(validatePatient(88, 160).length > 0);
  const r = computeScheme(S("1C-DVRD-IV"), CATALOG_INITIAL, { weight: 88, height: 0 }, {});
  assert.equal(r.totals, null); assert.ok(r.errors.length);
});
test("mg/kg y mg/m² usan peso y SC", () => {
  const r = computeScheme(S("2-KD"), CATALOG_INITIAL, P88, {});
  const l20 = r.lines.find((l) => l.dose === 20); near(l20.sampleDose, 20 * 1.9777, 0.02);
});
test("Cobertura con envases completos: dara IV 1408 mg = 4 viales de 400", () => {
  const pr = presentationsFor(CATALOG_INITIAL, "dara_iv");
  const c = adminCost(1408, pr, 0); assert.equal(c.vials, 4); near(c.full, 4 * 743.27); near(c.theor, 1408 * 743.27 / 400);
  near(c.eff, c.full); near(adminCost(1408, pr, 1).eff, c.theor);
});
test("Lenalidomida: 10 mg → cápsula de 10; 25 mg → cápsula de 25 (mínimo coste)", () => {
  const pr = presentationsFor(CATALOG_INITIAL, "lena");
  near(minCover(10, pr).cost, 0.42); near(minCover(25, pr).cost, 0.6);
});
test("Dexametasona sin precio: no se inventa coste y se avisa", () => {
  const r = computeScheme(S("2-VD"), CATALOG_INITIAL, P88, {});
  assert.ok(r.warnings.some((w) => w.code === "SIN_PRECIO" && w.drugs.includes("dex")));
  const dex = r.lines.find((l) => l.drug === "dex"); assert.equal(dex.priced, false); assert.equal(dex.eff, 0);
});
test("Regresión Excel (SC 1,83, coste por mg): esquemas sin errores del Excel coinciden", () => {
  const pt = { ...P88, scOverride: 1.83 };
  const ok = ["1C-DVTD-IV", "1C-DVTD-SC", "1N-DRD-IV", "1N-DRD-SC", "1N-VRD", "2-BELAPD", "2-ISAKD-IV", "2-ISAKD-SC", "2-PVD", "2-BELAVD", "2-SELVD", "2-DVD-SC", "2-DVD-IV", "2-ISAPD-IV", "2-ISAPD-SC", "2-VD", "2-RD", "3-ISAPD", "3-PD", "3-ISAKD", "2-DRD-IV"];
  for (const id of ok) { const s = S(id); near(computeScheme(s, CATALOG_INITIAL, pt, {}).totals.mainTheor, s.excel.main.value, 0.02); }
});
test("Discrepancias del Excel documentadas (diferencia = error identificado)", () => {
  const pt = { ...P88, scOverride: 1.83 };
  const d = (id) => computeScheme(S(id), CATALOG_INITIAL, pt, {}).totals.mainTheor - S(id).excel.main.value;
  near(d("1C-DVRD-IV"), -6.3, 0.02);        // lenalidomida a 0,65 en vez de 0,60 (126 d)
  near(d("1C-ISAVRD-SC"), 252.69 - 4.2, 0.02); // bortezomib=0 por referencia rota
  near(d("2-KD"), 46176.51 - 8856.56, 0.05);   // carfilzomib con coste/mg de isatuximab
  near(d("3-POCYDEX"), 70.27, 0.02);           // ciclofosfamida omitida
});
test("Cambio de frecuencia: calendario real, sin multiplicar el coste del ciclo 1", () => {
  const r = computeScheme(S("2-ISAKD-IV"), CATALOG_INITIAL, P88, { horizon: "all" });
  const isa = r.events.filter((e) => e.drug === "isa_iv"); assert.equal(isa.length, 26);
  const c1 = r.events.filter((e) => e.drug === "isa_iv" && e.cycle === 1 && e.seg === "c1"); assert.equal(c1.length, 4);
  assert.equal(r.events.filter((e) => e.drug === "carf" && e.doseRef === 56).length, 70);
});
test("Horizontes: ciclo 1, 3 meses y 12 meses recortan el calendario", () => {
  const s = S("2-ISAKD-IV");
  const c1 = computeScheme(s, CATALOG_INITIAL, P88, { horizon: "cycle1" });
  const m3 = computeScheme(s, CATALOG_INITIAL, P88, { horizon: Math.round(3 * DAYS_PER_MONTH) });
  const all = computeScheme(s, CATALOG_INITIAL, P88, { horizon: "all" });
  assert.ok(c1.totals.eff < m3.totals.eff && m3.totals.eff < all.totals.eff);
  assert.equal(c1.events.filter((e) => e.drug === "isa_iv").length, 4);
});
test("Mantenimiento de duración indefinida llega al horizonte", () => {
  const s = JSON.parse(JSON.stringify(S("1N-DRD-IV"))); s.maint[0].segs[0].cycles = null;
  const r = computeScheme(s, CATALOG_INITIAL, P88, { maint: "DR", horizon: 730 });
  assert.ok(r.durationDays >= 730 - 28 && r.events.some((e) => e.day > 600));
});
test("Costes: teórico ≤ tras aprovechamiento ≤ envases completos; redondeo de dosis parametrizable", () => {
  const s = S("1C-DVRD-IV");
  const a = computeScheme(s, CATALOG_INITIAL, P88, { reuse: 0 }).totals, b = computeScheme(s, CATALOG_INITIAL, P88, { reuse: 0.5 }).totals;
  assert.ok(a.theor <= b.eff && b.eff <= a.eff + 1e-6 && a.eff <= a.full + 1e-6);
  const r5 = computeScheme(s, CATALOG_INITIAL, P88, { roundStep: 50 }); const dara = r5.events.find((e) => e.drug === "dara_iv"); assert.equal(dara.dose % 50, 0);
});
test("Precios: factor de sensibilidad y precio ausente", () => {
  const a = computeScheme(S("2-RD"), CATALOG_INITIAL, P88, {}).totals.theor, b = computeScheme(S("2-RD"), CATALOG_INITIAL, P88, { priceFactor: 1.1 }).totals.theor;
  near(b, a * 1.1, 0.001);
});
test("Biespecíficos: step-up completo (el Excel omitía el 2.º escalón)", () => {
  const cfg = BSAB_PRESETS.tec; const sch = buildBsAbScheme({ ...cfg, name: "Tec" });
  const r = computeScheme(sch, CATALOG_INITIAL, P88, { horizon: "all" });
  assert.equal(r.events.length, 3 + 23 + 12);
  const su = r.events.filter((e) => e.seg === "su"); assert.equal(su.length, 3);
  assert.ok(r.durationDays >= 48 * 7 - 14);
});
test("Biespecíficos: Excel NORC teclistamab (coste/mg, 47 semanas sin step-up 2)", () => {
  const cfg = { ...BSAB_PRESETS.tec, weekly: { ...BSAB_PRESETS.tec.weekly, weeks: 47 }, biweekly: { ...BSAB_PRESETS.tec.biweekly, doses: 0 }, stepUp: [BSAB_PRESETS.tec.stepUp[0], BSAB_PRESETS.tec.stepUp[2]] };
  const r = computeScheme(buildBsAbScheme(cfg), CATALOG_INITIAL, { ...P88, scOverride: 1.83 }, {});
  // Excel K21 = 136.977,23 con 645,52 (vial) para el 1.er escalón; MieloFarma: mg proporcional en todos
  assert.ok(Math.abs(r.totals.theor - 136977.23) < 600);
});
test("Sensibilidad devuelve diferencias absolutas y porcentuales", () => {
  const s = sensitivity(S("1C-DVRD-IV"), CATALOG_INITIAL, P88, { reuse: 0 }, "theor");
  assert.ok(s.rows.length >= 8); const w = s.rows.find((x) => x.label.startsWith("Peso +")); assert.ok(w.diff > 0 && w.pct > 0);
  // con envases completos, +10 % de peso puede no cambiar el nº de viales (diferencia 0): comportamiento esperado
  const f = sensitivity(S("1C-DVRD-IV"), CATALOG_INITIAL, P88, { reuse: 0 }, "eff"); assert.ok(f.rows.find((x) => x.label.startsWith("Peso +")).diff >= 0);
});
test("Comparación: mismos pacientes y horizonte; desglose por fármaco", () => {
  const cmp = compareSchemes([{ scheme: S("1N-DRD-IV") }, { scheme: S("1N-DRD-SC") }], CATALOG_INITIAL, P88, { horizon: 365 });
  assert.equal(cmp.results.length, 2); assert.ok(cmp.byDrug.some((x) => x.drug === "dara_iv") && cmp.byDrug.some((x) => x.drug === "dara_sc"));
});
test("Parser de días y validación de esquemas", () => {
  assert.deepEqual(parseDays("1-3, 8,15"), [1, 2, 3, 8, 15]); assert.equal(daysToString([1, 2, 3, 8, 15]), "1-3,8,15"); assert.throws(() => parseDays("x"));
  const bad = { name: "x", segs: [{ id: "a", name: "a", cycles: 1, len: 21, comps: [{ drug: "bort", basis: "mgm2", dose: -1, days: [30] }] }] };
  assert.ok(validateScheme(bad, ["bort"]).length >= 2);
});
test("Todos los esquemas importados son válidos y calculables", () => {
  const drugs = [...new Set(CATALOG_INITIAL.map((c) => c.drug))];
  for (const s of SCHEMES_ALL) { assert.deepEqual(validateScheme(s, drugs), [], s.id); const r = computeScheme(s, CATALOG_INITIAL, P88, {}); assert.ok(r.totals.eff > 0, s.id); }
});
test("Topes de financiación opcionales (Bela, 50.000 €/año)", () => {
  const s = S("2-BELAPD");
  const sin = computeScheme(s, CATALOG_INITIAL, { ...P88, scOverride: 1.83 }, { applyCaps: false, horizon: 365 });
  const con = computeScheme(s, CATALOG_INITIAL, { ...P88, scOverride: 1.83 }, { applyCaps: true, horizon: 365 });
  const bela = (r) => r.lines.filter((l) => l.drug === "bela").reduce((a, l) => a + l.eff, 0);
  assert.ok(bela(sin) > 50000); near(bela(con), 50000, 0.01);
});
