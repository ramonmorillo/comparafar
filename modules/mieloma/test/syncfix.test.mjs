import test from "node:test";
import assert from "node:assert/strict";
import { diffCatalog, mergeCatalog, mergeSchemes, diffSchemes } from "../src/cloudMap.js";
import { makeStore, KEY, keyFor } from "../src/localStore.js";
import { commercialAccess } from "../src/access.js";

const base = { id: "C1", drug: "d", label: "l", mg: 1, unit: "vial", oral: false, route: "IV", center: null, excelCell: "B1", status: "pendiente", archived: false };
const h = (price, rid) => ({ price, from: "2026-01-01", source: "s", type: "t", note: null, ...(rid != null ? { rid } : {}) });

test("A: el precio propio se sube aunque otra persona haya subido antes (no se pierde por posición)", () => {
  const local = [{ ...base, history: [h(1, 1), h(2, 2), h(99)] }];
  const remote = [{ ...base, history: [h(1, 1), h(2, 2), h(3, 3)] }];
  assert.deepEqual(diffCatalog(local, remote).prices.map((p) => p.price), [99]);
});
test("A: entradas semilla sin rid que ya están en la nube no se duplican; alta nueva sube todo", () => {
  assert.equal(diffCatalog([{ ...base, history: [h(1), h(2)] }], [{ ...base, history: [h(1, 1), h(2, 2)] }]).prices.length, 0);
  assert.equal(diffCatalog([{ ...base, id: "N", history: [h(1), h(2)] }], []).prices.length, 2);
});
test("B: bajar de la nube conserva el precio local pendiente y las altas locales", () => {
  const local = [{ ...base, history: [h(1, 1), h(99)] }, { ...base, id: "U1", history: [] }];
  const remote = [{ ...base, history: [h(1, 1), h(3, 3)] }];
  const { catalog } = mergeCatalog(local, remote, remote);
  assert.deepEqual(catalog.find((c) => c.id === "C1").history.map((x) => x.price), [1, 3, 99]);
  assert.ok(catalog.some((c) => c.id === "U1"));
});
test("B: edición local de la fila se conserva si la nube no cambió; si cambiaron ambos gana la nube y se avisa", () => {
  const prev = [{ ...base, history: [] }];
  const edited = [{ ...base, label: "mío", history: [] }];
  assert.equal(mergeCatalog(edited, prev, prev).catalog[0].label, "mío");
  const theirs = [{ ...base, label: "suyo", history: [] }];
  const m = mergeCatalog(edited, theirs, prev);
  assert.equal(m.catalog[0].label, "suyo"); assert.equal(m.conflicts.length, 1);
});
test("B: una anulación local pendiente no se pierde al bajar", () => {
  const v = { at: "x", by: null, reason: "r" };
  const m = mergeCatalog([{ ...base, history: [{ ...h(1, 1), voided: v }] }], [{ ...base, history: [h(1, 1)] }], null);
  assert.ok(m.catalog[0].history[0].voided);
});
test("B: esquemas — cambio local pendiente se conserva con la versión de la nube; ambos cambian = conflicto", () => {
  const s = (name, version) => ({ id: "S", name, line: "1N", version, status: "borrador", archived: false, verified: null });
  const prev = { S: s("a", 2) };
  const m1 = mergeSchemes([s("mío", 2)], [s("a", 2)], prev);
  assert.equal(m1.schemes[0].name, "mío"); assert.equal(m1.schemes[0].version, 2);
  assert.equal(diffSchemes(m1.schemes, { S: s("a", 2) }).updates[0].expected, 2);
  const m2 = mergeSchemes([s("mío", 2)], [s("suyo", 3)], prev);
  assert.equal(m2.schemes[0].name, "suyo"); assert.equal(m2.conflicts.length, 1);
});
test("C: tras trabajar sin conexión, esquemas nuevos y precios nuevos sobreviven al primer acceso (sin instantánea previa)", () => {
  const m = mergeCatalog([{ ...base, history: [h(1), h(50)] }], [{ ...base, history: [h(1, 1)] }], null);
  assert.deepEqual(m.catalog[0].history.map((x) => x.price), [1, 50]);
  assert.equal(mergeSchemes([{ id: "N", name: "n", line: "1N" }], [], null).schemes.length, 1);
});

function fakeLS() { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; }
const fresh = () => ({ v: 1, catalog: [], userSchemes: [], agreements: [] });
test("G: el segundo usuario del mismo navegador no hereda los datos locales del primero", () => {
  const ls = fakeLS();
  ls.setItem(KEY, JSON.stringify({ v: 1, catalog: [], userSchemes: [], agreements: [{ id: "A1" }] }));   // datos anteriores al cambio
  const st = makeStore(() => ls, { normalize: (s) => s, fresh });
  const a = st.enter("uA", null);
  assert.equal(a.agreements.length, 1);                              // el primero adopta lo anterior
  assert.equal(ls.getItem(KEY), null);                               // y ya no queda en la clave común
  st.leave("uA", { ...a, agreements: [{ id: "A1" }, { id: "A2" }] });
  const b = st.enter("uB", null);
  assert.equal(b.agreements.length, 0);                              // B parte limpio
  assert.equal(st.enter("uA", null).agreements.length, 2);           // A recupera lo suyo
});
test("C/G: al entrar desde el modo sin conexión se conservan catálogo y esquemas locales", () => {
  const ls = fakeLS(); const st = makeStore(() => ls, { normalize: (s) => s, fresh });
  const out = st.enter("uA", { catalog: [{ id: "X" }], userSchemes: [{ id: "S" }] });
  assert.equal(out.catalog[0].id, "X"); assert.equal(out.userSchemes[0].id, "S");
});
test("F: en modo compartido con la sincronización económica apagada no se puede anular", () => {
  assert.equal(commercialAccess({ status: "ready", role: "revisor", ecoSync: false }).void, false);
  assert.equal(commercialAccess({ status: "ready", role: "revisor", ecoSync: true }).void, true);
  assert.equal(commercialAccess({ status: "local" }).void, true);
});
