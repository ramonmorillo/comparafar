import test from "node:test";
import assert from "node:assert/strict";
import { eurosToUnits, divRound, unitsToCents } from "../src/money.js";
import { addPriceVersion, resolvePrice, versionsFor, legacyVersions, unitPrice, costPerMg, validateVersion, findOverlap, PriceError } from "../src/pricing.js";
import { CATALOG_INITIAL } from "../src/data.js";
import { currentPrice } from "../src/engine.js";

const base = (o = {}) => ({ presId: "C03", price: 20, purchaseUnit: "vial", contentPerUnit: 1, vat: { mode: "sin_iva" }, source: "Contrato X", from: "2026-12-01", ...o });
const st = () => ({ catalog: JSON.parse(JSON.stringify(CATALOG_INITIAL)), priceVersions: [] });

test("dinero: texto es-ES, redondeo half-up simétrico y sin errores de coma flotante", () => {
  assert.equal(eurosToUnits("1.234,5678"), 12345678);
  assert.equal(eurosToUnits(0.1 + 0.2), 3000); // 0.30000000000000004
  assert.equal(eurosToUnits("abc"), null);
  assert.equal(unitsToCents(1250), 13); // 0,125 € -> 0,13 €
  assert.equal(unitsToCents(1249), 12);
  assert.equal(unitsToCents(-1250), -13);
  assert.equal(divRound(7, 2), 4);
});

test("validación: precio, unidad de compra, IVA, fuente y fecha son obligatorios", () => {
  assert.equal(validateVersion(base()).length, 0);
  assert.ok(validateVersion(base({ source: " " })).some((m) => /fuente/i.test(m)));
  assert.ok(validateVersion(base({ price: 0 })).some((m) => /precio/i.test(m)));
  assert.ok(validateVersion(base({ vat: { mode: "iva_incluido" } })).some((m) => /tipo/i.test(m)));
  assert.ok(validateVersion(base({ from: "" })).some((m) => /vigor/i.test(m)));
  assert.ok(validateVersion(base({ to: "2026-01-01" })).some((m) => /anterior/i.test(m)));
  assert.ok(validateVersion(base({ currency: "USD" })).some((m) => /EUR/.test(m)));
});

test("historial heredado: cada entrada vale hasta el día anterior a la siguiente", () => {
  const item = { id: "X", oral: false, history: [{ price: 10, from: "2026-01-01", source: "a" }, { price: 12, from: "2026-06-01", source: "b" }] };
  const [a, b] = legacyVersions(item);
  assert.equal(a.to, "2026-05-31");
  assert.equal(b.to, null);
  assert.equal(resolvePrice([a, b], "2026-05-31").price, 10);
  assert.equal(resolvePrice([a, b], "2026-06-01").price, 12);
  assert.equal(resolvePrice([a, b], "2025-12-31"), null);
});

test("alta: copia el historial heredado, cierra la vigencia previa si se pide y refleja el precio en el catálogo heredado", () => {
  const s = st();
  const before = s.catalog.find((c) => c.id === "C03").history.length;
  assert.throws(() => addPriceVersion(s, base({ from: "2026-12-01" })), (e) => e instanceof PriceError && e.code === "overlap");
  const r = addPriceVersion(s, base({ from: "2026-12-01" }), { closePrevious: true, user: "ana@h.es" });
  const vs = r.priceVersions.filter((v) => v.presId === "C03");
  assert.equal(vs.length, 2);
  assert.equal(vs[0].to, "2026-11-30");
  assert.equal(vs[1].by, "ana@h.es");
  assert.equal(r.catalog.find((c) => c.id === "C03").history.length, before + 1, "se añade (no se sobrescribe) al historial heredado");
  assert.equal(s.catalog.find((c) => c.id === "C03").history.length, before, "el estado de entrada no se muta");
  // el motor heredado ve el mismo precio nuevo
  assert.equal(resolvePrice(versionsFor({ ...s, ...r }, "C03"), "2026-12-15").price, 20);
});

test("no se admiten vigencias solapadas por presentación+centro+condición; otra condición o centro sí", () => {
  let s = st();
  s = { ...s, ...addPriceVersion(s, base({ from: "2026-12-01", to: "2026-12-31" }), { closePrevious: true }) };
  assert.throws(() => addPriceVersion(s, base({ from: "2026-12-15", to: "2027-01-10" })), /solapa/);
  // condición distinta: permitido
  const r = addPriceVersion(s, base({ from: "2026-12-15", condition: "acuerdo-precio-volumen", price: 17 }));
  assert.ok(r.version);
  assert.equal(r.mirrored, false, "condiciones diferenciadas no se reflejan en el historial general heredado");
  // la condición diferenciada no se mezcla con la general
  const vs = versionsFor({ ...s, ...r }, "C03");
  assert.equal(resolvePrice(vs, "2026-12-20").price, 20);
  assert.equal(resolvePrice(vs, "2026-12-20", { condition: "acuerdo-precio-volumen" }).price, 17);
  // centro: usa el específico si existe y el general si no
  const r2 = addPriceVersion({ ...s, ...r }, base({ from: "2026-12-01", center: "Hospital B", price: 18 }));
  const all = versionsFor({ ...s, ...r, ...r2 }, "C03");
  assert.equal(resolvePrice(all, "2026-12-20", { center: "Hospital B" }).price, 18);
  assert.equal(resolvePrice(all, "2026-12-20", { center: "Hospital C" }).price, 20);
  assert.ok(findOverlap(all, base({ from: "2026-12-05", to: "2026-12-06", center: "Hospital B" })));
});

test("IVA y contenido por unidad de compra: precio por vial con regla explícita", () => {
  const v = { priceUnits: 1100000, price: 110, contentPerUnit: 1, purchaseUnit: "vial", vat: { mode: "iva_incluido", rate: 0.1 } };
  assert.equal(unitPrice(v, { vat: "sin_iva" }).units, 1000000); // 110 / 1,10 = 100,00 €
  const pack = { priceUnits: 1000000, price: 100, contentPerUnit: 3, purchaseUnit: "envase", vat: { mode: "sin_iva", rate: 0.1 } };
  assert.equal(unitPrice(pack).units, 333333); // 100/3 = 33,3333 € (0,0001 €)
  assert.equal(unitPrice(pack, { vat: "con_iva" }).units, 366667);
  assert.ok(unitPrice({ ...v, vat: { mode: "iva_incluido", rate: null } }).error);
  assert.ok(unitPrice({ ...v, vat: { mode: "no_especificado" } }).warnings.length);
});

test("coste por mg solo con conversión explícita y comprobada", () => {
  assert.equal(costPerMg({ conversion: { mgPerUnit: 3.5, verified: true } }, 154900), 15.49 / 3.5);
  assert.equal(costPerMg({ conversion: { mgPerUnit: 3.5, verified: false } }, 154900), null);
  assert.equal(costPerMg({}, 154900), null);
});

test("un precio añadido después por la pantalla antigua «Precios» también lo ve Costes (sin divergencia con el motor heredado)", () => {
  let s = st();
  s = { ...s, ...addPriceVersion(s, base({ from: "2026-12-01" }), { closePrevious: true }) }; // ya hay versiones propias para C03
  s = { ...s, catalog: s.catalog.map((c) => (c.id === "C03" ? { ...c, history: [...c.history, { price: 25, from: "2027-03-01", source: "Alta desde Precios", type: "x", note: "" }] } : c)) };
  const vs = versionsFor(s, "C03");
  assert.equal(resolvePrice(vs, "2026-12-15").price, 20);
  assert.equal(resolvePrice(vs, "2027-03-02").price, 25, "la entrada heredada posterior se resuelve");
  assert.equal(vs.filter((v) => v.price === 20).length, 1, "las entradas ya reflejadas no se duplican");
  // coincide con lo que calcula el motor heredado
  assert.equal(currentPrice(s.catalog.find((c) => c.id === "C03"), "2027-03-02"), 25);
});
