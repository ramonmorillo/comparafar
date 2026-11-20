import test from "node:test";
import assert from "node:assert/strict";
import { makePdf } from "./helpers/makepdf.mjs";
import { oncofarPages, SAMPLE_SINGLE, twoPhaseDoc } from "./helpers/oncofarDoc.mjs";
import { extractPdf, hashBytes } from "../src/pdftext.js";
import { parseOncofar, parseDose, parseDaysLiteral, classifyRow } from "../src/oncofar.js";
import { buildDraft, manualDraft, findExisting, reviewIssues, blockers, confirmDraft, reviseFromPlan, currentPlans, setField, planCalendar, reestimate, ImportError } from "../src/importflow.js";
import { emptyRef, addIngredient, addMedicine, addPresentation } from "../src/refcatalog.js";
import { addPriceVersion } from "../src/pricing.js";
import { CATALOG_INITIAL } from "../src/data.js";

const apply = (S, patch) => ({ ...S, ...patch });
const baseState = () => ({ catalog: JSON.parse(JSON.stringify(CATALOG_INITIAL)), ref: emptyRef(), priceVersions: [], importDrafts: [], importedPlans: [], estimates: [], log: [], patients: [{ code: "P-1", weight: 80, height: 1.75, scMethod: "mosteller", scOverride: 0 }] });
function addDrug(S, name, mg, price) {
  let r = addIngredient(S.ref, { name }); S = { ...S, ref: r.ref };
  const m = addMedicine(S.ref, { name: name + " (med)", ingredients: [{ ingredientId: r.ingredient.id }] }); S = { ...S, ref: m.ref };
  const p = addPresentation(S.ref, { medicineId: m.medicine.id, label: `${name} ${mg} mg vial`, conversion: { mgPerUnit: mg, basis: "manual", verified: true } }); S = { ...S, ref: p.ref };
  return { S: { ...S, ...addPriceVersion(S, { presId: p.presentation.id, price, purchaseUnit: "vial", contentPerUnit: 1, vat: { mode: "sin_iva" }, source: "Test", from: "2026-01-01" }) }, id: r.ingredient.id };
}
const parse = async (doc, o) => { const ex = await extractPdf(makePdf(oncofarPages(doc, o))); assert.equal(ex.ok, true); const r = parseOncofar(ex); assert.equal(r.ok, true, r.message); return { ex, r }; };
// Revisión del usuario: confirma fases y filas incluidas
function reviewAll(d) { return { ...d, phases: d.phases.map((p) => ({ ...p, reviewed: true, lines: p.lines.map((l) => ({ ...l, reviewed: true })) })) }; }

test("parsers de dosis, días y clasificación (literal y unidad conservados)", () => {
  assert.deepEqual(parseDose("1000 mg/ m²"), { value: 1000, unit: "mg/m2", basis: "mgm2", literal: "1000 mg/ m²" });
  assert.equal(parseDose("5 mg/kg").basis, "mgkg");
  assert.equal(parseDose("0,5 g").value, 500);
  assert.equal(parseDose("50 ml").basis, "volume");
  assert.equal(parseDose("20 UI").basis, null);
  assert.equal(parseDose("según pauta").value, null);
  assert.deepEqual(parseDaysLiteral("1, 8, 15"), [1, 8, 15]);
  assert.deepEqual(parseDaysLiteral("1 a 5"), [1, 2, 3, 4, 5]);
  assert.equal(parseDaysLiteral("cada 3 días"), null);
  assert.equal(classifyRow("Antineoplásico").explicit, true);
  assert.equal(classifyRow("Pauta antiemética alternativa").category, "soporte");
  assert.equal(classifyRow("Otros", "Completado 1 h ANTES de X").category, "ambiguo");
});

test("hoja de ejemplo (una página): clasificación explícita, ambiguas por revisar, diluyentes fuera, mg/m² conservado", async () => {
  const { r } = await parse(SAMPLE_SINGLE);
  assert.equal(r.header.name.value, "GLOFI- GEMOX ciclo2");
  assert.equal(r.header.interval.value, 21); assert.equal(r.header.cycles.value, 1);
  assert.deepEqual(r.header.cycleHint, { cycle: 2, day: 1 });
  const L = r.phases[0].lines;
  assert.deepEqual(L.map((l) => l.category), ["ambiguo", "ambiguo", "soporte", "soporte", "soporte", "principal", "principal", "principal"]);
  assert.deepEqual(L.map((l) => l.included), [null, null, false, false, false, true, true, true]);
  assert.ok(L[0].categoryHint.length > 0);
  assert.equal(L[0].type.value, "Otros");
  assert.equal(L[2].type.value, "Pauta antiemética primera elección", "tipo multilínea reconstruido");
  assert.deepEqual(L[6].components.map((c) => [c.nameLiteral, c.doseValue, c.basis, c.role]), [["GEMCITABINA", 1000, "mgm2", "farmaco"], ["CLORURO SODICO 0.9 %", 500, "volume", "diluyente"]]);
  assert.equal(L[5].components[0].doseLiteral, "30 mg");
  assert.equal(L[5].adminMinutes, 240);
  assert.equal(L[0].page, 1);
});

test("ESCENARIO 1 · PDF de varias páginas con dos fármacos en días distintos y dos fases: se conserva el calendario y la confirmación crea un solo plan", async () => {
  const doc = twoPhaseDoc(34);
  const { ex, r } = await parse(doc);
  assert.ok(ex.pages.length >= 2, "ocupa varias páginas");
  assert.equal(r.phases.length, 2);
  assert.equal(r.phases[0].lines.filter((l) => l.category === "principal").length, 2);
  assert.ok(r.phases[0].lines.some((l) => l.page === 2), "hay filas en la segunda página");
  // los encabezados repetidos no se confunden con filas ni con datos
  assert.ok(!JSON.stringify(r.phases).includes("Hospital Universitario"));
  assert.ok(!JSON.stringify(r.phases).includes("Farmis"));
  let S = baseState(); let a, b;
  ({ S, id: a } = addDrug(S, "Farmaco Alfa", 2, 100)); ({ S, id: b } = addDrug(S, "Farmaco Beta", 100, 50));
  const hash = await hashBytes(makePdf(oncofarPages(doc)));
  let d = buildDraft({ parsed: r, hash, context: "P-1", S });
  // correspondencia automática por nombre normalizado, pendiente de confirmar
  const alfa = d.phases[0].lines[0].components[0];
  assert.equal(alfa.ingredientId, a); assert.equal(alfa.match.status, "nombre");
  // sin confirmar no se puede guardar
  S = { ...S, importDrafts: [d] };
  assert.ok(blockers(d).some((i) => i.code === "CICLOS_SIN_CONFIRMAR"));
  assert.throws(() => confirmDraft(S, d.id), (e) => e instanceof ImportError && e.code === "bloqueado");
  // el usuario revisa y fija la fecha inicial explícita; solo las filas principales entran
  d = { ...reviewAll(d), startDate: "2026-12-01" };
  d = { ...d, phases: d.phases.map((p) => ({ ...p, lines: p.lines.map((l) => (l.category === "soporte" ? { ...l, included: false } : l)) })) };
  S = { ...S, importDrafts: [d] };
  assert.equal(blockers(d).length, 0, JSON.stringify(blockers(d)));
  const res = confirmDraft(S, d.id, { user: "ana@h.es", now: "2026-11-20T09:00:00Z", est: { patient: S.patients[0] } });
  S = apply(S, res.patch);
  assert.equal(S.importedPlans.length, 1); assert.equal(S.importDrafts.length, 0); assert.equal(S.estimates.length, 1);
  // calendario: ALFA días 1 y 8 en 4 ciclos de 21 días (fase 1), BETA día 1; fase 2 empieza a los 84 días con ciclos de 56
  const cal = planCalendar(S.importedPlans[0]);
  const alfaDates = cal.filter((c) => c.drugs.includes("FARMACO ALFA")).map((c) => c.date);
  assert.deepEqual(alfaDates, ["2026-12-01", "2026-12-08", "2026-12-22", "2026-12-29", "2027-01-12", "2027-01-19", "2027-02-02", "2027-02-09"]);
  const mant = cal.filter((c) => c.phaseId === "F2").map((c) => c.date);
  assert.deepEqual(mant.slice(0, 3), ["2027-02-23", "2027-04-20", "2027-06-15"]);
  const est = S.estimates[0];
  assert.equal(est.administrations.filter((a) => a.phaseId === "F1" && /ALFA/.test(a.label)).length, 8);
  assert.ok(est.administrations.every((x) => x.status === "ok"), JSON.stringify(est.administrations.filter((x) => x.status !== "ok").map((x) => x.reasons)));
  assert.equal(est.total.incomplete, false);
  // no se persisten ni el PDF ni observaciones ni nombre de fichero
  const stored = JSON.stringify({ p: S.importedPlans, e: S.estimates });
  assert.ok(!/\.pdf|Hospital Universitario|Referencia sintética|%PDF/i.test(stored));
  // doble clic en «Confirmar»: ya no hay borrador, no se duplica nada
  assert.throws(() => confirmDraft(S, d.id), (e) => e.code === "no_encontrado");
  assert.equal(S.importedPlans.length, 1);
});

test("ESCENARIO 2 · PDF escaneado: motivo visible y borrador manual; dato ambiguo y reimportación sin duplicados", async () => {
  const scan = await extractPdf(makePdf([{ image: true }]));
  assert.equal(scan.ok, false); assert.equal(scan.reason, "escaneado"); assert.match(scan.message, /escaneado/);
  const noLayout = await extractPdf(makePdf([{ items: [{ x: 50, y: 700, text: "Documento de texto cualquiera que no es una hoja de Oncofar ni tiene tabla" }] }]));
  assert.equal(noLayout.ok, true);
  const bad = parseOncofar(noLayout); assert.equal(bad.ok, false); assert.equal(bad.reason, "diseno");
  // se completa a mano
  let S = baseState(); let g; ({ S, id: g } = addDrug(S, "Glofitamab", 10, 1500));
  let d = manualDraft({ context: "P-1", reason: scan.message, hash: "sha256:abc" });
  assert.ok(blockers(d).some((i) => i.code === "SIN_LINEAS"));
  d.name = setField(d.name, "Esquema manual");
  d.phases[0].cycles = setField(d.phases[0].cycles, 1); d.phases[0].interval = setField(d.phases[0].interval, 21);
  d.phases[0].lines = [{ id: "M1", order: 1, page: null, type: { value: "Antineoplásico", literal: "Antineoplásico", status: "corregido" }, category: "principal", categoryExplicit: false, included: true, route: setField({}, "PIV"), days: setField({}, [1]), adminMinutes: null, reviewed: true, obsFlags: {},
    components: [{ id: "c1", nameLiteral: "Glofitamab", doseLiteral: "30 mg", doseValue: 30, unit: "mg", basis: "fixed", role: "farmaco", ingredientId: g, match: { status: "nombre", options: [] } }] }];
  d.phases[0].reviewed = true;
  S = { ...S, importDrafts: [d] };
  assert.equal(blockers(d).length, 0, JSON.stringify(blockers(d)));
  // dato ambiguo en la hoja de ejemplo: bloquea hasta que el usuario decide
  const { r } = await parse(SAMPLE_SINGLE);
  const amb = buildDraft({ parsed: r, hash: "sha256:xyz", context: "P-1", S });
  assert.equal(blockers(reviewAll(amb)).filter((i) => i.code === "FILA_AMBIGUA").length, 2);
  // reimportación: el mismo hash y contexto se detecta; el borrador se recupera sin duplicar
  assert.equal(findExisting(S, "sha256:abc", "P-1").drafts.length, 1);
  assert.equal(findExisting(S, "sha256:abc", "P-2").drafts.length, 0, "otro contexto: no es la misma importación");
  // confirmar → plan; reimportar → detecta plan confirmado; crear revisión explícita sin tocar el plan
  const c1 = confirmDraft(S, d.id, { est: { patient: S.patients[0] } }); S = apply(S, c1.patch);
  const confirmedJson = JSON.stringify(S.importedPlans[0]);
  assert.equal(findExisting(S, "sha256:abc", "P-1").plans.length, 1);
  const rev = reviseFromPlan(S, S.importedPlans[0].id, { user: "ana@h.es" });
  assert.equal(rev.revision, 2); assert.equal(rev.revisionOf, S.importedPlans[0].id);
  assert.ok(blockers(rev).length > 0, "una revisión exige volver a confirmar");
  S = { ...S, importDrafts: [rev] };
  assert.throws(() => confirmDraft(S, rev.id), (e) => e.code === "bloqueado", "la revisión no se confirma sin volver a revisarla");
  const rev2 = { ...reviewAll(rev), phases: reviewAll(rev).phases.map((p) => ({ ...p, cycles: setField(p.cycles, 2) })) };
  S = { ...S, importDrafts: [rev2] };
  const c2 = confirmDraft(S, rev2.id, { est: { patient: S.patients[0] } }); S = apply(S, c2.patch);
  assert.equal(S.importedPlans.length, 2);
  assert.equal(JSON.stringify(S.importedPlans[0]), confirmedJson, "el plan confirmado previo no se modifica");
  assert.deepEqual(currentPlans(S).map((p) => p.revision), [2], "solo la última revisión está vigente");
  // misma revisión del mismo fichero no se puede confirmar dos veces
  const dupDraft = { ...d, id: "DX", revision: 1 };
  assert.throws(() => confirmDraft({ ...S, importDrafts: [dupDraft] }, "DX"), (e) => e.code === "duplicado");
  assert.equal(S.importedPlans.length, 2);
});

test("fases con distinto intervalo y confirmación de ciclos ausentes (tramo documentado o horizonte)", async () => {
  const doc = twoPhaseDoc(0); doc.phases[0].cycles = null; doc.cycles = null;
  const { r } = await parse(doc);
  assert.equal(r.phases[0].cycles.status, "sin_resolver");
  let S = baseState(); ({ S } = addDrug(S, "Farmaco Alfa", 2, 100)); ({ S } = addDrug(S, "Farmaco Beta", 100, 50));
  let d = reviewAll(buildDraft({ parsed: r, hash: "h", context: "", S }));
  assert.ok(blockers(d).some((i) => i.code === "CICLOS_SIN_RESOLVER"));
  d.phases[0].cyclesMode = "tramo"; assert.ok(!blockers(d).some((i) => i.code === "CICLOS_SIN_RESOLVER" && i.where === "fase:F1"));
  d.phases[0].cyclesMode = null; d.phases[0].horizonCycles = 3;
  assert.ok(!blockers(d).some((i) => i.where === "fase:F1" && /CICLOS/.test(i.code)));
});
