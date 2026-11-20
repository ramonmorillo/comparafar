import test from "node:test";
import assert from "node:assert/strict";
import { addPriceVersion, voidPriceVersion, voidSpendEntry, versionsFor, resolvePrice, VoidError } from "../src/pricing.js";
import { currentPrice } from "../src/engine.js";
import { evaluateAgreements } from "../src/agreements.js";
import { commercialAccess } from "../src/access.js";
import { rowsToCatalog, diffHistoryVoids, diffCatalog } from "../src/cloudMap.js";
import { rowToVersion, rowToSpend, diffEco, ecoDiffEmpty, mergeEco } from "../src/cloudEco.js";

const item = { id: "C1", drug: "x", label: "Vial", mg: 1, unit: "vial", oral: false, status: "pendiente", history: [{ price: 5, from: "2026-01-01", source: "Excel", type: "excel", note: "" }] };
const input = (o = {}) => ({ presId: "C1", price: "10", purchaseUnit: "vial", contentPerUnit: 1, vat: { mode: "sin_iva" }, source: "Contrato", from: "2026-06-01", ...o });
const build = () => { const s0 = { catalog: [item], priceVersions: [] }; const r = addPriceVersion(s0, input(), { user: "ed@x", closePrevious: true }); return { ...s0, priceVersions: r.priceVersions, catalog: r.catalog, v: r.version }; };

test("anular una versión general: deja de resolverse y se anula también su entrada del historial heredado (Calculadora)", () => {
  const s = build();
  assert.equal(currentPrice(s.catalog[0], "2026-07-01"), 10);                      // antes: el motor heredado ve 10 €
  const r = voidPriceVersion(s, s.v.id, "Precio mal transcrito", { user: "rev@x", now: "2026-07-02T00:00:00Z" });
  assert.equal(r.mirrored, true);
  const s2 = { ...s, priceVersions: r.priceVersions, catalog: r.catalog };
  assert.equal(currentPrice(s2.catalog[0], "2026-07-01"), 5);                       // después: vuelve al precio anterior
  // la versión anterior seguía cerrada (la base no permite reabrir vigencias): Costes no devuelve precio hasta registrar la correcta, y se avisa
  assert.equal(resolvePrice(versionsFor(s2, "C1"), "2026-07-01"), null);
  assert.match(r.warning, /seguirá cerrada/);
  assert.equal(versionsFor(s2, "C1", { includeVoided: true }).filter((v) => v.voided).length, 1);
  const v = r.version; assert.deepEqual(v.voided, { at: "2026-07-02T00:00:00Z", by: "rev@x", reason: "Precio mal transcrito" });
  assert.equal(s2.priceVersions.length, s.priceVersions.length);                    // no se borra nada
});

test("una versión anulada no reaparece desde el historial heredado ni bloquea la corrección", () => {
  const s = build(); const r = voidPriceVersion(s, s.v.id, "x");
  const s2 = { ...s, priceVersions: r.priceVersions, catalog: r.catalog };
  assert.equal(versionsFor(s2, "C1").some((v) => v.price === 10), false);
  const fix = addPriceVersion(s2, input({ price: "12" }), { user: "ed@x", closePrevious: true });        // misma vigencia: la anulada no cuenta como solape
  assert.equal(resolvePrice(versionsFor({ ...s2, priceVersions: fix.priceVersions, catalog: fix.catalog }, "C1"), "2026-07-01").price, 12);
});

test("anular exige motivo y no se repite", () => {
  const s = build();
  assert.throws(() => voidPriceVersion(s, s.v.id, "   "), (e) => e instanceof VoidError && e.code === "reason");
  assert.throws(() => voidPriceVersion(s, "NO", "x"), (e) => e.code === "missing");
  const r = voidPriceVersion(s, s.v.id, "x");
  assert.throws(() => voidPriceVersion({ ...s, priceVersions: r.priceVersions }, s.v.id, "y"), (e) => e.code === "already");
});

test("anular la versión que cerró a la anterior avisa de que la anterior sigue cerrada", () => {
  const s0 = { catalog: [{ ...item, history: [] }], priceVersions: [] };
  const a = addPriceVersion(s0, input({ from: "2026-01-01" }), { user: "u" });
  const b = addPriceVersion({ ...s0, priceVersions: a.priceVersions, catalog: a.catalog }, input({ from: "2026-07-01", price: "20" }), { closePrevious: true, user: "u" });
  const r = voidPriceVersion({ ...s0, priceVersions: b.priceVersions, catalog: b.catalog }, b.version.id, "error");
  assert.match(r.warning, /seguirá cerrada/);
});

test("gasto anulado: no computa en la evaluación de acuerdos y se conserva en el registro", () => {
  const list = [{ id: "E1", kind: "realizado", scope: {}, asOf: "2026-06-30", amountCents: 500, source: "s" }];
  const out = voidSpendEntry(list, "E1", "Otro periodo", { user: "rev@x" });
  assert.equal(out.length, 1); assert.equal(out[0].voided.reason, "Otro periodo");
  assert.throws(() => voidSpendEntry(out, "E1", "x"), (e) => e.code === "already");
  assert.throws(() => voidSpendEntry(list, "E1", ""), (e) => e.code === "reason");
  const ag = { id: "A", version: 1, type: "techo", title: "t", scope: { level: "principio_activo", targetId: "legacy:x" }, period: { kind: "natural", year: 2026 }, effective: { from: "2026-01-01" }, threshold: { amountCents: 1000 }, source: "s", owner: "o", history: [] };
  const ev = (entries) => evaluateAgreements({ catalog: [], agreements: [ag], spendEntries: entries }, { items: [], asOf: "2026-12-31" }).evals?.[0] ?? evaluateAgreements({ catalog: [], agreements: [ag], spendEntries: entries }, { items: [], asOf: "2026-12-31" })[0];
  assert.doesNotThrow(() => ev(list)); assert.doesNotThrow(() => ev(out));
});

test("permisos de anulación: solo revisor y admin (o modo sin conexión)", () => {
  assert.equal(commercialAccess({ status: "ready", role: "editor" }).void, false);
  assert.equal(commercialAccess({ status: "ready", role: "revisor" }).void, true);
  assert.equal(commercialAccess({ status: "ready", role: "admin" }).void, true);
  assert.equal(commercialAccess({ status: "ready", role: "lector" }).void, false);
  assert.equal(commercialAccess({ status: "local" }).void, true);
});

test("nube: price_history conserva rid y anulación; solo se envían las anulaciones pendientes", () => {
  const items = [{ id: "C1", drug: "d", label: "l", mg: 1, unit: "vial", oral: false, route: null, center: null, excel_cell: "B1", status: "pendiente", archived: false }];
  const prices = [{ id: 7, item_id: "C1", price: 5, price_type: "t", valid_from: "2026-01-01", source: "s", note: null, added_at: "2026-01-01T00:00:00Z" },
    { id: 8, item_id: "C1", price: 9, price_type: "t", valid_from: "2026-05-01", source: "s", note: null, added_at: "2026-02-01T00:00:00Z", voided_at: "2026-03-01T00:00:00Z", void_reason: "dup" }];
  const remote = rowsToCatalog(items, prices);
  assert.equal(remote[0].history[1].voided.reason, "dup"); assert.equal(remote[0].history[0].voided, undefined);
  const local = JSON.parse(JSON.stringify(remote)); local[0].history[0].voided = { at: "x", by: "me", reason: "mal" };
  assert.deepEqual(diffHistoryVoids(local, remote), [{ id: 7, reason: "mal" }]);        // la 8 ya está anulada en la nube
  assert.equal(diffCatalog(local, remote).prices.length, 0);                              // anular no crea entradas nuevas
});

test("nube: versiones y gasto anulados se mapean, se envían una vez y no se pierden al bajar", () => {
  const base = { id: "V1", presentation_id: "C1", price_units: 100000, purchase_unit: "vial", content_per_unit: 1, vat_mode: "sin_iva", source: "s", valid_from: "2026-01-01" };
  assert.equal(rowToVersion({ ...base, voided_at: "t", void_reason: "r" }).voided.reason, "r");
  assert.equal(rowToVersion(base).voided, undefined);
  assert.equal(rowToSpend({ id: "E", kind: "realizado", as_of: "2026-01-01", amount_cents: 1, source: "s", voided_at: "t", void_reason: "r" }).voided.reason, "r");
  const rv = rowToVersion(base), rs = rowToSpend({ id: "E1", kind: "realizado", as_of: "2026-01-01", amount_cents: 1, source: "s" });
  const remote = { ref: {}, priceVersions: [rv], agreements: [], spendEntries: [rs] };
  const local = { ref: {}, priceVersions: [{ ...rv, voided: { at: "t", by: "me", reason: "a" } }], agreements: [], spendEntries: [{ ...rs, voided: { at: "t", by: "me", reason: "b" } }] };
  const d = diffEco(local, remote);
  assert.deepEqual(d.voidVersions, [{ id: "V1", reason: "a" }]); assert.deepEqual(d.voidSpend, [{ id: "E1", reason: "b" }]);
  assert.equal(d.newVersions.length, 0); assert.equal(ecoDiffEmpty(d), false);
  // ya anuladas en la nube: nada que enviar
  const done = { ...remote, priceVersions: [{ ...rv, voided: { at: "t", by: null, reason: "a" } }], spendEntries: [{ ...rs, voided: { at: "t", by: null, reason: "b" } }] };
  assert.equal(ecoDiffEmpty(diffEco(local, done)), true);
  // al bajar de la nube, una anulación local pendiente gana; una ya sincronizada conserva el autor local
  const rm = { ref: { ingredients: [], aliases: [], medicines: [], presentations: [] }, priceVersions: remote.priceVersions, spendEntries: remote.spendEntries };
  assert.ok(mergeEco({ ref: {}, ...local }, rm).priceVersions[0].voided);
  const rm2 = { ...rm, priceVersions: done.priceVersions, spendEntries: done.spendEntries };
  assert.equal(mergeEco({ ref: {}, ...local }, rm2).priceVersions[0].voided.by, "me");
});
