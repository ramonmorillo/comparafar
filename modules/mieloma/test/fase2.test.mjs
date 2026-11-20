import test from "node:test";
import assert from "node:assert/strict";
import { emptyRef, addIngredient, addMedicine, addPresentation, editMedicine, editPresentation, setArchived, archiveImpact, allPresentations, CatalogError } from "../src/refcatalog.js";
import { saveAgreement, voidAgreement, activeAgreements, evaluateAgreements, AgreementError } from "../src/agreements.js";
import { ecoSection } from "../src/exportsEco.js";
import { agreementToRow, rowToAgreement, diffEco, medicineToRow, rowToMedicine } from "../src/cloudEco.js";

const mk = () => {
  let ref = emptyRef();
  ({ ref } = addIngredient(ref, { name: "Principio de prueba XYZ" }));
  const ing = ref.ingredients[0];
  let r = addMedicine(ref, { name: "Imnovid", ingredients: [{ ingredientId: ing.id, amount: "4", unit: "mg" }] }); ref = r.ref; const med = r.medicine;
  r = addMedicine(ref, { name: "Otro", ingredients: [{ ingredientId: ing.id }] }); ref = r.ref;
  let p = addPresentation(ref, { medicineId: med.id, label: "Caja 21 cápsulas", cn: "700001" }); ref = p.ref; const pres = p.presentation;
  p = addPresentation(ref, { medicineId: med.id, label: "Caja 14 cápsulas", cn: "700002" }); ref = p.ref;
  return { ref, med, pres, ing };
};

test("editar medicamento: cambia datos, evita duplicados y no toca la composición", () => {
  const { ref, med } = mk();
  const r = editMedicine(ref, med.id, { name: "Imnovid 4 mg", labtitular: "BMS" }, { user: "u@x" });
  const m = r.medicines.find((x) => x.id === med.id);
  assert.equal(m.name, "Imnovid 4 mg"); assert.equal(m.labtitular, "BMS"); assert.deepEqual(m.ingredients, med.ingredients); assert.equal(m.source.editedBy, "u@x");
  assert.throws(() => editMedicine(ref, med.id, { name: "otro" }), (e) => e instanceof CatalogError && e.code === "duplicate");
  assert.throws(() => editMedicine(ref, med.id, { name: "  " }), (e) => e.code === "invalid");
  assert.doesNotThrow(() => editMedicine(ref, med.id, { name: "Imnovid" }));                   // conservar el propio nombre no es duplicado
});

test("editar presentación: valida CN (texto de 6-7 dígitos) y duplicados", () => {
  const { ref, pres } = mk();
  const r = editPresentation(ref, pres.id, { label: "Caja 21 cáps. (EFG)", cn: "0123456" });
  assert.equal(r.presentations.find((x) => x.id === pres.id).cn, "0123456");
  assert.throws(() => editPresentation(ref, pres.id, { cn: "12" }), (e) => e.code === "invalid");
  assert.throws(() => editPresentation(ref, pres.id, { cn: "700002" }), (e) => e.code === "duplicate");
  assert.throws(() => editPresentation(ref, pres.id, { label: "caja 14 cápsulas" }), (e) => e.code === "duplicate");
  assert.equal(editPresentation(ref, pres.id, { cn: "" }).presentations.find((x) => x.id === pres.id).cn, null);
});

test("archivar es reversible y oculta la presentación (y las del medicamento archivado) sin borrar nada", () => {
  const { ref, med, pres } = mk(); const S = (r) => ({ catalog: [], ref: r });
  assert.equal(allPresentations(S(ref)).length, 2);
  const a = setArchived(ref, "presentation", pres.id, true);
  assert.equal(allPresentations(S(a)).length, 1); assert.equal(allPresentations(S(a), { includeArchived: true }).length, 2);
  assert.equal(a.presentations.length, ref.presentations.length);
  const b = setArchived(ref, "medicine", med.id, true);
  assert.equal(allPresentations(S(b)).length, 0); assert.equal(b.medicines.length, ref.medicines.length);
  assert.equal(allPresentations(S(setArchived(b, "medicine", med.id, false))).length, 2);   // restaurar
  assert.throws(() => setArchived(ref, "medicine", "NO", true), (e) => e.code === "invalid");
});

test("impacto de archivar: precios vigentes y acuerdos activos afectados (informativo)", () => {
  const { ref, med, pres } = mk();
  const ag = { id: "A", type: "descuento", scope: { level: "presentacion", targetId: pres.id }, voided: null };
  const S = { ref, priceVersions: [{ id: "V1", presId: pres.id, to: null }, { id: "V2", presId: pres.id, to: "2026-01-01" }, { id: "V3", presId: pres.id, to: null, voided: { reason: "x" } }],
    agreements: [ag, { ...ag, id: "B", voided: { reason: "x" } }, { id: "C", scope: { level: "medicamento", targetId: med.id } }] };
  assert.deepEqual(archiveImpact(S, "presentation", pres.id), { presentations: 0, prices: 1, agreements: 1 });
  assert.deepEqual(archiveImpact(S, "medicine", med.id), { presentations: 2, prices: 1, agreements: 2 });
});

const input = { type: "techo", title: "Techo", scope: { level: "principio_activo", targetId: "legacy:bort" }, period: { kind: "natural", year: 2026 }, effective: { from: "2026-01-01" }, threshold: { amountCents: 100000 }, source: "Acta", owner: "Jefe" };

test("anular un acuerdo: nueva versión, histórico, motivo obligatorio, irreversible; no computa ni se exporta", () => {
  let list = saveAgreement([], input, { user: "ed@x" }); const id = list[0].id;
  assert.throws(() => voidAgreement(list, id, "  "), AgreementError);
  const v = voidAgreement(list, id, "Contrato resuelto", { user: "rev@x", now: "2026-12-01T00:00:00Z" });
  const a = v[0];
  assert.equal(a.version, 2); assert.equal(a.status, "anulado"); assert.deepEqual(a.voided, { at: "2026-12-01T00:00:00Z", by: "rev@x", reason: "Contrato resuelto" });
  assert.equal(a.history.length, 1); assert.equal(a.history[0].version, 1); assert.equal(a.history[0].voided, undefined);
  assert.throws(() => voidAgreement(v, id, "otra"), (e) => /ya está anulado/.test(e.message));
  assert.throws(() => saveAgreement(v, { ...input, id, title: "Cambio" }), (e) => /anulado/.test(e.message));
  const S = { catalog: [], agreements: v, spendEntries: [] };
  assert.equal(activeAgreements(S).length, 0); assert.equal(evaluateAgreements(S, { items: [], asOf: "2026-06-30" }).length, 0);
  assert.equal(JSON.stringify(ecoSection({ ...S, plans: [], estimates: [] }, [], { access: { view: true, edit: true } })).includes("Techo"), false);
});

test("nube: el acuerdo anulado y el medicamento archivado hacen ida y vuelta y generan la actualización con versión esperada", () => {
  const list = saveAgreement([], input, { user: "ed@x" }); const a1 = list[0];
  const a2 = voidAgreement(list, a1.id, "Error")[0];
  const row = agreementToRow(a2); assert.equal(row.data.status, "anulado"); assert.equal(row.data.voided.reason, "Error");
  const back = rowToAgreement({ ...row, created_at: "c", updated_at: "u" }); assert.equal(back.status, "anulado"); assert.equal(back.voided.reason, "Error");
  const d = diffEco({ ref: {}, agreements: [{ ...a2, version: 9 }] }, { ref: {}, agreements: [a1] });
  assert.equal(d.agUpdates.length, 1); assert.equal(d.agUpdates[0].expected, 1); assert.equal(d.agUpdates[0].row.version, 2); assert.equal(d.agUpdates[0].row.data.status, "anulado");
  const { ref, med } = mk(); const arch = setArchived(ref, "medicine", med.id, true).medicines.find((x) => x.id === med.id);
  assert.equal(medicineToRow(arch).archived, true); assert.equal(rowToMedicine(medicineToRow(arch)).archived, true);
  assert.equal(diffEco({ ref: { medicines: [arch] } }, { ref: { medicines: [med] } }).medicines.length, 1);
});
