import test from "node:test";
import assert from "node:assert/strict";
import { rowsToCatalog, itemToRow, priceToRow, schemeToRow, rowToScheme, isConflict } from "../src/cloudMap.js";

test("rowsToCatalog une precios al ítem en orden cronológico", () => {
  const items = [{ id: "C1", drug: "bort", label: "Bortezomib 3,5 mg", mg: 3.5, unit: "vial", oral: false, route: "SC", center: null, excel_cell: "B4", status: "pendiente", archived: false }];
  const prices = [
    { id: 2, item_id: "C1", price: 20, price_type: "contrato", valid_from: "2026-12-01", source: "B", note: null, added_at: "2026-11-02T00:00:00Z" },
    { id: 1, item_id: "C1", price: 10, price_type: "excel", valid_from: "2026-01-01", source: "A", note: "n", added_at: "2026-11-01T00:00:00Z" },
  ];
  const [c] = rowsToCatalog(items, prices);
  assert.equal(c.excelCell, "B4");
  assert.deepEqual(c.history.map(h => h.price), [10, 20]);
  assert.deepEqual(c.history[0], { price: 10, from: "2026-01-01", source: "A", type: "excel", note: "n" });
});

test("itemToRow es inverso de rowsToCatalog (sin historial)", () => {
  const item = { id: "C1", drug: "bort", label: "x", mg: 1, unit: "vial", oral: true, route: "VO", center: "Valme", excelCell: "B4", status: "verificado", archived: true, history: [] };
  const row = itemToRow(item);
  assert.equal(row.excel_cell, "B4");
  assert.equal("history" in row, false);
  const [back] = rowsToCatalog([row], []);
  assert.deepEqual({ ...back, history: [] }, item);
});

test("priceToRow exige fuente y precio positivo", () => {
  assert.throws(() => priceToRow("C1", { price: 5, source: "  " }), /fuente/i);
  assert.throws(() => priceToRow("C1", { price: 0, source: "x" }), /precio/i);
  assert.deepEqual(priceToRow("C1", { price: 5, source: "x", from: "2026-01-01", type: "t", note: "n" }),
    { item_id: "C1", price: 5, price_type: "t", valid_from: "2026-01-01", source: "x", note: "n" });
});

test("schemeToRow/rowToScheme conservan el esquema y la versión", () => {
  const s = { id: "S1", name: "N", line: "1N", version: 3, status: "borrador", archived: false, verified: null, custom: true, cycles: [1, 2] };
  const row = schemeToRow(s);
  assert.equal(row.version, 3);
  assert.equal(row.data.cycles.length, 2);
  const back = rowToScheme({ ...row, version: 4, status: "verificado" });
  assert.equal(back.version, 4);
  assert.equal(back.status, "verificado");
  assert.deepEqual(back.cycles, [1, 2]);
});

test("schemeToRow sin versión parte de 1", () => {
  assert.equal(schemeToRow({ id: "S", name: "n", line: "1N" }).version, 1);
});

test("isConflict reconoce el error 40001 de versión", () => {
  assert.equal(isConflict({ code: "40001" }), true);
  assert.equal(isConflict({ message: "Conflicto de versión: x" }), true);
  assert.equal(isConflict({ code: "42501" }), false);
  assert.equal(isConflict(null), false);
});

import { stableStringify, diffCatalog, diffSchemes } from "../src/cloudMap.js";

test("stableStringify ignora el orden de claves", () => {
  assert.equal(stableStringify({ a: 1, b: { d: 1, c: [2, { y: 1, x: 2 }] } }), stableStringify({ b: { c: [2, { x: 2, y: 1 }], d: 1 }, a: 1 }));
});

test("diffCatalog detecta ítems nuevos/cambiados y solo los precios añadidos", () => {
  const base = { id: "C1", drug: "d", label: "l", mg: 1, unit: "vial", oral: false, route: "IV", center: null, excelCell: "B1", status: "pendiente", archived: false, history: [{ price: 1, from: null, source: "s", type: "t", note: null }] };
  const remote = [base];
  const same = diffCatalog([{ ...base }], remote);
  assert.deepEqual(same, { upserts: [], prices: [] });
  const added = { ...base, history: [...base.history, { price: 2, from: "2026-12-01", source: "c", type: "t", note: null }] };
  const nuevo = { ...base, id: "U1", history: [] };
  const renamed = { ...base, label: "otro" };
  assert.equal(diffCatalog([added], remote).prices.length, 1);
  assert.equal(diffCatalog([added], remote).prices[0].price, 2);
  assert.equal(diffCatalog([added], remote).upserts.length, 0);
  assert.equal(diffCatalog([base, nuevo], remote).upserts[0].id, "U1");
  assert.equal(diffCatalog([renamed], remote).upserts[0].label, "otro");
});

test("diffSchemes separa altas, cambios y versión esperada; ignora version", () => {
  const remote = { A: { id: "A", name: "a", line: "1N", version: 2, status: "borrador" }, B: { id: "B", name: "b", line: "1N", version: 1, status: "borrador" } };
  const local = [{ id: "A", name: "a", line: "1N", version: 7, status: "borrador" }, { id: "B", name: "b2", line: "1N", version: 1, status: "borrador" }, { id: "N", name: "n", line: "2", status: "borrador" }];
  const d = diffSchemes(local, remote);
  assert.deepEqual(d.inserts.map(s => s.id), ["N"]);
  assert.deepEqual(d.updates.map(u => [u.scheme.id, u.expected]), [["B", 1]]);
});
