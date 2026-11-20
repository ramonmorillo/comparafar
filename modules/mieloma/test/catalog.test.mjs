import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createCima, classifyTerm, normalizeDetail, parseContent, proposeConversion, CimaError } from "../src/cima.js";
import { emptyRef, addIngredient, addMedicine, addPresentation, confirmAlias, matchIngredient, incorporateCima, allPresentations, allIngredients, CatalogError, setConversion } from "../src/refcatalog.js";
import { CATALOG_INITIAL } from "../src/data.js";

const fx = (n) => JSON.parse(fs.readFileSync(new URL("./fixtures/" + n, import.meta.url), "utf8"));
const resp = (status, body) => ({ status, ok: status >= 200 && status < 300, text: async () => (body == null ? "" : typeof body === "string" ? body : JSON.stringify(body)) });
const S0 = () => ({ catalog: JSON.parse(JSON.stringify(CATALOG_INITIAL)), ref: emptyRef() });

test("clasificación del término: CN de 6-7 dígitos, nº de registro alfanumérico y nombre", () => {
  assert.equal(classifyTerm("723656").kind, "cn_or_nregistro");
  assert.equal(classifyTerm("1161101004ip").value, "1161101004IP");
  assert.equal(classifyTerm("glofitamab").kind, "name");
  assert.equal(classifyTerm("  ").kind, "empty");
});

test("CIMA sin resultados: 200 vacío y 204 sin cuerpo; busca también por principio activo", async () => {
  const calls = [];
  const fetchImpl = async (url) => { calls.push(url); const u = new URL(url);
    if (u.pathname.endsWith("/medicamentos") && u.searchParams.get("nombre") === "glofitamab") return resp(200, { totalFilas: 0, pagina: 1, tamanioPagina: 200, resultados: [] });
    if (u.searchParams.get("practiv1") === "glofitamab") return resp(200, { totalFilas: 1, pagina: 1, tamanioPagina: 200, resultados: [{ nregistro: "1231742002", nombre: "COLUMVI 10 MG", comerc: true, vtm: { nombre: "glofitamab" } }] });
    if (u.pathname.endsWith("/medicamento")) return resp(204, null);
    return resp(200, { totalFilas: 0, pagina: 1, tamanioPagina: 200, resultados: [] }); };
  const c = createCima({ fetchImpl });
  const r = await c.search("glofitamab");
  assert.equal(r.via, "principio activo"); assert.equal(r.results[0].vtm, "glofitamab");
  assert.equal((await c.search("zzzz")).total, 0);
  assert.equal(await c.detail({ cn: "0000000" }), null, "204 sin cuerpo = no encontrado, no es un error");
  assert.ok(calls.every((u) => !/paciente|pdf/i.test(u)), "solo términos de catálogo");
});

test("CIMA con varias coincidencias: paginación y normalización (CN como texto)", async () => {
  const body = fx("cima-search-bortezomib.json");
  const fetchImpl = async () => resp(200, { ...body, totalFilas: 38 });
  const r = await createCima({ fetchImpl }).list({ nombre: "bortezomib" }, 1);
  assert.equal(r.total, 38); assert.equal(r.pages, 1); assert.ok(r.results.length > 1);
  assert.ok(r.results.every((x) => typeof x.nregistro === "string" && x.nombre));
});

test("CIMA caída: red, HTTP 500 y respuesta ilegible producen CimaError y no rompen el catálogo local", async () => {
  await assert.rejects(createCima({ fetchImpl: async () => { throw new TypeError("fetch failed"); } }).search("bortezomib"), (e) => e instanceof CimaError && e.kind === "network");
  await assert.rejects(createCima({ fetchImpl: async () => resp(500, "boom") }).search("bortezomib"), (e) => e.kind === "http" && e.status === 500);
  await assert.rejects(createCima({ fetchImpl: async () => resp(200, "<html>") }).search("bortezomib"), (e) => e.kind === "parse");
  // El alta manual no depende de CIMA
  let S = S0();
  const a = addIngredient(S.ref, { name: "Glofitamab" }); S = { ...S, ref: a.ref };
  const m = addMedicine(S.ref, { name: "Columvi 10 mg", ingredients: [{ ingredientId: a.ingredient.id }] }); S = { ...S, ref: m.ref };
  const p = addPresentation(S.ref, { medicineId: m.medicine.id, label: "Columvi 10 mg vial", cn: "762973", conversion: { mgPerUnit: 10, basis: "manual", verified: true } });
  assert.equal(p.presentation.source.kind, "manual");
  assert.equal(allPresentations({ ...S, ref: p.ref }).find((x) => x.cn === "762973").ingredientIds[0], a.ingredient.id);
});

test("normalizeDetail: principios activos, CN texto, contenido y conversión propuesta solo en patrones comprobados", () => {
  const polvo = normalizeDetail(fx("cima-med-83444.json"));
  assert.equal(polvo.presentations[0].cn, "723656");
  assert.equal(polvo.presentations[0].content.count, 1);
  assert.equal(polvo.presentations[0].conversion.mgPerUnit, 3.5);
  assert.equal(polvo.presentations[0].conversion.verified, false);
  // Solución: «2,50 mg» en principiosActivos es CONCENTRACIÓN; los mg/vial salen de 2,5 mg/ml × 1,4 ml
  const sol = normalizeDetail(fx("cima-med-82911.json"));
  assert.equal(sol.ingredients[0].cantidad, "2,50");
  assert.equal(sol.presentations.find((p) => p.cn === "720889").conversion.mgPerUnit, 3.5);
  assert.equal(sol.presentations.find((p) => p.cn === "762305").conversion.mgPerUnit, 7);
  const gem = normalizeDetail(fx("cima-med-76166.json")); // «100 mg/ ml» × 10 ml
  assert.equal(gem.presentations[0].conversion.mgPerUnit, 1000);
  const col = normalizeDetail(fx("cima-med-1231742002.json"));
  assert.equal(col.presentations[0].conversion.mgPerUnit, 10);
  assert.equal(proposeConversion("sin patrón conocido", null), null);
  assert.equal(parseContent("X 5 mg, 30 comprimidos").count, 30);
});

test("incorporar ficha CIMA: identificadores, fuente y fecha; deduplica; no pisa alias ni conversión confirmada", () => {
  const d = normalizeDetail(fx("cima-med-1231742002.json")); // glofitamab: no existe en el catálogo heredado
  let r = incorporateCima(emptyRef(), d, ["762973"], { user: "ana@h.es", now: "2026-11-20T08:00:00.000Z" });
  assert.deepEqual(r.report.ingredientsCreated, ["GLOFITAMAB"]);
  assert.equal(r.report.presentationsAdded[0], "762973");
  const pres = r.ref.presentations[0];
  assert.equal(pres.cn, "762973"); assert.equal(typeof pres.cn, "string");
  assert.equal(pres.source.consultedAt, "2026-11-20T08:00:00.000Z"); assert.equal(pres.source.nregistro, "1231742002");
  assert.equal(r.ref.ingredients[0].cima.codigo, "51086A");
  assert.equal(pres.conversion.verified, false, "la equivalencia propuesta queda sin comprobar");
  // el usuario confirma alias y equivalencia
  let ref = confirmAlias(r.ref, "GLOFITAMAB", r.ref.ingredients[0].id, { user: "ana@h.es" });
  ref = setConversion(ref, pres.id, { mgPerUnit: 10, verified: true, basis: "manual" }, { user: "ana@h.es" });
  // reconsulta de CIMA: no duplica y no sobrescribe alias ni conversión
  const again = incorporateCima(ref, { ...d, nombre: "COLUMVI 10 MG (actualizado)" }, ["762973"], { now: "2026-12-01T00:00:00.000Z" });
  assert.equal(again.ref.presentations.length, 1); assert.equal(again.ref.medicines.length, 1);
  assert.equal(again.report.medicineUpdated, true);
  assert.equal(again.ref.medicines[0].name, "COLUMVI 10 MG (actualizado)");
  assert.equal(again.ref.aliases.length, 1);
  assert.equal(again.ref.presentations[0].conversion.verified, true);
  assert.equal(again.ref.presentations[0].source.consultedAt, "2026-12-01T00:00:00.000Z");
});

test("ficha CIMA de un principio activo ya presente en el catálogo heredado: se enlaza, no se duplica", () => {
  const r = incorporateCima(emptyRef(), normalizeDetail(fx("cima-med-83444.json")), ["723656"]);
  assert.deepEqual(r.report.ingredientsLinked, ["Bortezomib"]);
  assert.equal(r.ref.ingredients.length, 0);
  assert.equal(r.ref.medicines[0].ingredients[0].ingredientId, "legacy:bort");
});

test("medicamento con varios principios activos; deduplicación e identificación del origen", () => {
  let ref = emptyRef();
  const a = addIngredient(ref, { name: "Lopinavir" }); ref = a.ref;
  const b = addIngredient(ref, { name: "Ritonavir" }); ref = b.ref;
  const m = addMedicine(ref, { name: "Kaletra", ingredients: [{ ingredientId: a.ingredient.id, amount: 200, unit: "mg" }, { ingredientId: b.ingredient.id, amount: 50, unit: "mg" }] });
  assert.equal(m.medicine.ingredients.length, 2);
  assert.throws(() => addIngredient(m.ref, { name: " lopinavir " }), (e) => e instanceof CatalogError && e.code === "duplicate");
  assert.throws(() => addIngredient(m.ref, { name: "Bortezomib" }), /Ya existe/, "también contra el catálogo heredado");
  const p = addPresentation(m.ref, { medicineId: m.medicine.id, label: "Kaletra 200/50 60 comprimidos", cn: "6543210" });
  assert.throws(() => addPresentation(p.ref, { medicineId: m.medicine.id, label: "otra", cn: "6543210" }), /Ya existe/);
  assert.throws(() => addPresentation(p.ref, { medicineId: m.medicine.id, label: "x", cn: "12" }), /6 o 7 dígitos/);
  assert.equal(p.presentation.cn, "6543210");
});

test("correspondencia con el catálogo: nombre normalizado, alias confirmado y varias opciones sin elegir", () => {
  let S = S0();
  assert.equal(matchIngredient(S, "BORTEZOMIB").status, "nombre");
  assert.equal(matchIngredient(S, "Daratumumab").status, "varias", "IV y SC: el usuario decide");
  assert.equal(matchIngredient(S, "GLOFITAMAB").status, "ninguna");
  const g = addIngredient(S.ref, { name: "Glofitamab" }); S = { ...S, ref: g.ref };
  assert.equal(matchIngredient(S, "GLOFITAMAB").status, "nombre");
  S = { ...S, ref: confirmAlias(S.ref, "GLOFITAMAB 2,5 mg", g.ingredient.id) };
  assert.equal(matchIngredient(S, "glofitamab 2,5 MG").status, "alias");
  assert.equal(matchIngredient(S, "x", g.ingredient.id).status, "id");
  assert.ok(allIngredients(S).some((i) => i.legacy) && allPresentations(S).some((p) => p.legacy));
});
