import test from "node:test";
import assert from "node:assert/strict";
import { versionToRow, rowToVersion, agreementToRow, rowToAgreement, spendToRow, rowToSpend, presentationToRow, rowToPresentation, medicineToRow, rowToMedicine,
  ingredientToRow, rowToIngredient, aliasToRow, rowToAlias, diffEco, ecoDiffEmpty, ecoFromRows, isMissingTable, keepLocalMeta } from "../src/cloudEco.js";
import { saveAgreement } from "../src/agreements.js";
import { addPriceVersion } from "../src/pricing.js";

const ver = { id: "V1", presId: "C1", center: "", condition: "general", price: 12.3456, priceUnits: 123456, currency: "EUR", purchaseUnit: "vial", contentPerUnit: 2,
  vat: { mode: "iva_incluido", rate: 0.1 }, source: "Contrato", from: "2026-01-01", to: null, priceType: "contrato", note: "", origin: "manual" };
const ag = { id: "A1", version: 1, type: "techo", title: "Techo", scope: { level: "principio_activo", targetId: "legacy:bort" }, period: { kind: "natural", year: 2026 },
  effective: { from: "2026-01-01" }, threshold: { amountCents: 100000 }, source: "Acta", owner: "Jefe", createdAt: "x", history: [] };

test("versión de precio: ida y vuelta conserva importes enteros e IVA", () => {
  const row = versionToRow(ver);
  assert.equal(row.price_units, 123456); assert.equal(row.vat_mode, "iva_incluido"); assert.equal(row.vat_rate, 0.1);
  const back = rowToVersion({ ...row, price_units: "123456", created_at: "t" });
  assert.equal(back.priceUnits, 123456); assert.equal(back.price, 12.3456); assert.deepEqual(back.vat, { mode: "iva_incluido", rate: 0.1 }); assert.equal(back.to, null);
});

test("acuerdo: ida y vuelta, con histórico reconstruido desde agreement_versions", () => {
  const row = agreementToRow({ ...ag, version: 3 });
  assert.equal(row.scope_level, "principio_activo"); assert.equal(row.scope_target, "legacy:bort");
  assert.equal("history" in row.data, false); assert.deepEqual(row.data.scope, ag.scope);
  const back = rowToAgreement({ ...row, created_at: "c", updated_at: "u" }, [
    { agreement_id: "A1", version: 1, data: { ...row.data, title: "v1" }, changed_at: "t1" },
    { agreement_id: "A1", version: 2, data: { ...row.data, title: "v2" }, changed_at: "t2" },
    { agreement_id: "A1", version: 3, data: row.data, changed_at: "t3" },
    { agreement_id: "OTRO", version: 1, data: {}, changed_at: "tx" }]);
  assert.equal(back.version, 3); assert.deepEqual(back.history.map((h) => h.title), ["v1", "v2"]); assert.equal(back.history[0].replacedAt, "t2");
  assert.deepEqual(back.scope, ag.scope); assert.equal(back.threshold.amountCents, 100000);
});

test("gasto registrado: ida y vuelta (importe en céntimos enteros)", () => {
  const e = { id: "SE1", kind: "realizado", agreementId: null, scope: { level: "principio_activo", targetId: "x" }, from: "2026-01-01", to: "2026-06-30", asOf: "2026-07-01", amountCents: 123456, source: "Contabilidad", by: "a@b", at: "t" };
  const row = spendToRow(e); assert.equal(row.amount_cents, 123456); assert.equal("by" in row, false);
  const back = rowToSpend({ ...row, amount_cents: "123456", created_at: "c" });
  assert.equal(back.amountCents, 123456); assert.equal(back.by, null);
});

test("catálogo de referencia: ida y vuelta; CN siempre como texto y nulo si vacío", () => {
  const p = { id: "PR1", medicineId: "M1", cn: "0123456", label: "l", content: { count: 1 }, conversion: { mgPerUnit: 3.5, verified: true }, oral: false, source: { kind: "cima" }, archived: false };
  assert.equal(presentationToRow(p).cn, "0123456"); assert.equal(presentationToRow({ ...p, cn: "" }).cn, null);
  assert.deepEqual(rowToPresentation(presentationToRow(p)), p);
  const m = { id: "M1", name: "n", nregistro: "1161101004IP", labtitular: "L", forma: "f", atc: null, ingredients: [{ ingredientId: "PA1", amount: "1", unit: "mg" }], source: { kind: "cima" }, archived: false };
  assert.deepEqual(rowToMedicine(medicineToRow(m)), m);
  const i = { id: "PA1", name: "x", nameNorm: "x", source: { kind: "manual" }, cima: { id: 1, codigo: "9" } };
  assert.deepEqual(rowToIngredient(ingredientToRow(i)), i);
  assert.equal(rowToAlias({ ...aliasToRow({ id: "AL1", alias: "A", aliasNorm: "a", ingredientId: "PA1" }) }).ingredientId, "PA1");
});

const empty = { ref: { ingredients: [], medicines: [], presentations: [], aliases: [] }, priceVersions: [], agreements: [], spendEntries: [] };

test("diffEco: sin cambios no envía nada", () => {
  const s = { ...empty, priceVersions: [ver], agreements: [ag] };
  assert.equal(ecoDiffEmpty(diffEco(s, JSON.parse(JSON.stringify(s)))), true);
});

test("diffEco: altas de versiones y cierre de vigencia (único cambio admitido)", () => {
  const remote = { ...empty, priceVersions: [ver] };
  const nuevo = { ...ver, id: "V2", from: "2026-07-01" };
  const d = diffEco({ ...empty, priceVersions: [{ ...ver, to: "2026-06-30" }, nuevo] }, remote);
  assert.deepEqual(d.closures, [{ id: "V1", valid_to: "2026-06-30" }]);
  assert.equal(d.newVersions.length, 1); assert.equal(d.newVersions[0].id, "V2");
  // una versión ya cerrada en la nube no se vuelve a cerrar ni se modifica
  const d2 = diffEco({ ...empty, priceVersions: [{ ...ver, to: "2026-12-31" }] }, { ...empty, priceVersions: [{ ...ver, to: "2026-06-30" }] });
  assert.equal(d2.closures.length, 0); assert.equal(d2.newVersions.length, 0);
});

test("diffEco: acuerdos nuevos, modificados con versión esperada, y sin cambios", () => {
  const remote = { ...empty, agreements: [{ ...ag, version: 4 }] };
  const d = diffEco({ ...empty, agreements: [{ ...ag, version: 9, title: "Otro", id: "A1" }, { ...ag, id: "A2" }] }, remote);
  assert.equal(d.agInserts.length, 1); assert.equal(d.agInserts[0].id, "A2");
  assert.equal(d.agUpdates.length, 1); assert.equal(d.agUpdates[0].expected, 4); assert.equal(d.agUpdates[0].row.version, 5); assert.equal(d.agUpdates[0].row.title, "Otro");
});

test("diffEco: gasto, alias e ingredientes solo se añaden; medicamentos se actualizan", () => {
  const m = { id: "M1", name: "n", nregistro: null, labtitular: "", forma: "", atc: null, ingredients: [{ ingredientId: "PA1" }], source: {} };
  const remote = { ...empty, ref: { ...empty.ref, medicines: [m] }, spendEntries: [{ id: "SE1", kind: "realizado", scope: {}, asOf: "2026-01-01", amountCents: 100, source: "s" }] };
  const local = { ...empty, ref: { ...empty.ref, medicines: [{ ...m, name: "cambiado" }], ingredients: [{ id: "PA2", name: "y", nameNorm: "y", source: {} }] },
    spendEntries: [{ id: "SE1", kind: "realizado", scope: {}, asOf: "2026-01-01", amountCents: 999, source: "s" }, { id: "SE2", kind: "ajuste", scope: {}, asOf: "2026-02-01", amountCents: 5, source: "s" }] };
  const d = diffEco(local, remote);
  assert.equal(d.medicines.length, 1); assert.equal(d.ingredients.length, 1);
  assert.deepEqual(d.spend.map((x) => x.id), ["SE2"]);   // SE1 ya existe: no se reescribe (la base es de solo inserción)
});

test("ecoFromRows: un lector no recibe condiciones comerciales", () => {
  const rows = { ingredients: [], medicines: [], presentations: [], aliases: [], priceVersions: [versionToRow(ver)], agreements: [], spend: [] };
  const lector = ecoFromRows(rows, { canSeeCommercial: false });
  assert.equal("priceVersions" in lector, false); assert.equal("agreements" in lector, false); assert.equal("spendEntries" in lector, false);
  assert.equal(ecoFromRows(rows, { canSeeCommercial: true }).priceVersions.length, 1);
});

test("keepLocalMeta conserva quién/cuándo local", () => {
  assert.deepEqual(keepLocalMeta([{ id: "1", by: null, at: "r" }, { id: "2", by: null }], [{ id: "1", by: "a@b", at: "l" }]), [{ id: "1", by: "a@b", at: "l" }, { id: "2", by: null }]);
});

test("isMissingTable reconoce 003 sin aplicar", () => {
  assert.equal(isMissingTable({ code: "42P01" }), true); assert.equal(isMissingTable({ code: "PGRST205" }), true);
  assert.equal(isMissingTable({ message: "Could not find the table 'public.agreements' in the schema cache" }), true);
  assert.equal(isMissingTable({ code: "42501" }), false); assert.equal(isMissingTable(null), false);
});

test("integración con el motor: acuerdo y versión generados por la app pasan por los mapeos sin perder datos", () => {
  const list = saveAgreement([], { type: "descuento", title: "Dto", scope: { level: "principio_activo", targetId: "legacy:bort" }, period: { kind: "natural", year: 2026 }, effective: { from: "2026-01-01" },
    formula: { kind: "pct", pct: 0.1 }, settlement: "abono", source: "Contrato", owner: "Yo" }, { user: "u@x" });
  const back = rowToAgreement({ ...agreementToRow(list[0]), created_at: "c", updated_at: "u" });
  assert.deepEqual(back.formula, { kind: "pct", pct: 0.1 }); assert.equal(back.settlement, "abono");
  const r = addPriceVersion({ catalog: [{ id: "C1", label: "x", history: [] }], priceVersions: [] }, { presId: "C1", price: "10,50", purchaseUnit: "vial", contentPerUnit: 1, vat: { mode: "sin_iva" }, source: "s", from: "2026-01-01" });
  const pv = rowToVersion({ ...versionToRow(r.version), created_at: "c" });
  assert.equal(pv.priceUnits, 105000); assert.equal(pv.vat.mode, "sin_iva");
});

import { mergeEco } from "../src/cloudEco.js";
test("mergeEco: nunca pierde lo pendiente de subir; gana la nube salvo cambio local pendiente", () => {
  const local = { ref: { ingredients: [{ id: "L", name: "local" }], aliases: [], medicines: [], presentations: [] },
    priceVersions: [{ id: "V1", to: "2026-06-30", by: "a@b" }, { id: "VL" }], agreements: [{ id: "A1", version: 3, title: "local" }, { id: "A2", version: 1, title: "viejo" }], spendEntries: [{ id: "S1", by: "a@b" }, { id: "SL" }] };
  const remote = { ref: { ingredients: [{ id: "R", name: "remoto" }], aliases: [], medicines: [], presentations: [] },
    priceVersions: [{ id: "V1", to: null }], agreements: [{ id: "A1", version: 2, title: "nube" }, { id: "A2", version: 2, title: "nube2" }], spendEntries: [{ id: "S1", by: null }] };
  const m = mergeEco(local, remote);
  assert.deepEqual(m.ref.ingredients.map((x) => x.id), ["R", "L"]);
  assert.equal(m.priceVersions.find((v) => v.id === "V1").to, "2026-06-30"); assert.ok(m.priceVersions.some((v) => v.id === "VL"));
  assert.equal(m.agreements.find((a) => a.id === "A1").title, "local"); assert.equal(m.agreements.find((a) => a.id === "A2").title, "nube2");
  assert.equal(m.spendEntries.find((s) => s.id === "S1").by, "a@b"); assert.ok(m.spendEntries.some((s) => s.id === "SL"));
  // un lector (sin partes comerciales) no toca sus colecciones locales
  const l = mergeEco(local, { ref: remote.ref });
  assert.equal("agreements" in l, false);
});
